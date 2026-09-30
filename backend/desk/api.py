from datetime import datetime
from typing import Optional

from django.http import HttpRequest
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from desk.auth_utils import bearer_auth, create_access_token, verify_password
from desk.models import OffsetSubmission, TrendSnapshot, User
from desk.services import (
    compare_points,
    normalize_limit,
    recent_settled_points,
)

api = NinjaAPI(title="数控刀补复核台", version="1.0")


class HealthOut(Schema):
    status: str


class LoginIn(Schema):
    username: str
    password: str


class LoginOut(Schema):
    token: str
    username: str
    role: str
    can_write: bool


class SubmissionIn(Schema):
    tool_code: str
    offset_um: int


class SubmissionOut(Schema):
    id: int
    tool_code: str
    offset_um: int
    status: str
    verdict: str
    created_at: datetime
    reviewed_at: Optional[datetime]


def _to_out(row: OffsetSubmission) -> SubmissionOut:
    return SubmissionOut(
        id=row.id,
        tool_code=row.tool_code,
        offset_um=row.offset_um,
        status=row.status,
        verdict=row.verdict or "",
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
    )


@api.get("/health", response=HealthOut)
def health(request: HttpRequest):
    return {"status": "ok"}


@api.post("/auth/login", response=LoginOut)
def login(request: HttpRequest, body: LoginIn):
    try:
        user = User.objects.get(username=body.username)
    except User.DoesNotExist:
        raise HttpError(401, "用户名或密码错误")
    if not verify_password(body.password, user.password):
        raise HttpError(401, "用户名或密码错误")
    token = create_access_token(user)
    return {
        "token": token,
        "username": user.username,
        "role": user.role,
        "can_write": user.can_write,
    }


@api.get("/submissions", response=list[SubmissionOut], auth=bearer_auth)
def list_submissions(request: HttpRequest):
    rows = OffsetSubmission.objects.all()[:200]
    return [_to_out(r) for r in rows]


@api.get("/submissions/{submission_id}", response=SubmissionOut, auth=bearer_auth)
def get_submission(request: HttpRequest, submission_id: int):
    try:
        row = OffsetSubmission.objects.get(pk=submission_id)
    except OffsetSubmission.DoesNotExist:
        raise HttpError(404, "刀补记录不存在")
    return _to_out(row)


@api.post("/submissions", response=SubmissionOut, auth=bearer_auth)
def create_submission(request: HttpRequest, body: SubmissionIn):
    user: User = request.auth
    if not user.can_write:
        raise HttpError(403, "当前账号只读，不能提交刀补")
    tool_code = body.tool_code.strip()
    if not tool_code:
        raise HttpError(400, "刀具编号不能为空")
    row = OffsetSubmission.objects.create(
        tool_code=tool_code,
        offset_um=body.offset_um,
        submitted_by=user,
        status=OffsetSubmission.Status.PENDING,
    )
    return _to_out(row)


# ---------------------------------------------------------------------------
# 刀补连线台
# ---------------------------------------------------------------------------


class TrendPointsOut(Schema):
    limit: int
    points: list


class CompareIn(Schema):
    limit: Optional[int] = None
    first_id: int
    second_id: int


class CompareOut(Schema):
    first_id: int
    second_id: int
    first_tool_code: str
    second_tool_code: str
    first_offset_um: int
    second_offset_um: int
    diff_um: int
    abs_diff_um: int


class CheckoutIn(Schema):
    limit: Optional[int] = None
    first_id: Optional[int] = None
    second_id: Optional[int] = None


class SnapshotOut(Schema):
    id: int
    limit: int
    points: list
    pair: Optional[dict]
    checked_out_by: Optional[str]
    checked_out_at: datetime


def _snapshot_out(row: TrendSnapshot) -> SnapshotOut:
    return SnapshotOut(
        id=row.id,
        limit=row.limit,
        points=row.points,
        pair=row.pair,
        checked_out_by=row.checked_out_by.username if row.checked_out_by else None,
        checked_out_at=row.checked_out_at,
    )


@api.get("/trend/points", response=TrendPointsOut, auth=bearer_auth)
def trend_points(request: HttpRequest, limit: Optional[int] = None):
    """近次结清点，顺序与首页复核列表（-created_at）一致。"""
    lim = normalize_limit(limit)
    return {"limit": lim, "points": recent_settled_points(lim)}


@api.post("/trend/compare", response=CompareOut, auth=bearer_auth)
def trend_compare(request: HttpRequest, body: CompareIn):
    """挑两个点交给后台算差值；页面不得自行相减。"""
    lim = normalize_limit(body.limit)
    points = recent_settled_points(lim)
    try:
        return compare_points(points, body.first_id, body.second_id)
    except ValueError as exc:
        raise HttpError(400, str(exc))


@api.post("/trend/checkout", response=SnapshotOut, auth=bearer_auth)
def trend_checkout(request: HttpRequest, body: CheckoutIn):
    """操作员签出只读副本：冻住当前点集连同差值。复核员无权签出。"""
    user: User = request.auth
    if not user.can_write:
        raise HttpError(403, "仅操作员可签出连线台副本")
    lim = normalize_limit(body.limit)
    points = recent_settled_points(lim)
    pair = None
    if body.first_id is not None and body.second_id is not None:
        try:
            pair = compare_points(points, body.first_id, body.second_id)
        except ValueError as exc:
            raise HttpError(400, str(exc))
    snapshot = TrendSnapshot.objects.create(
        limit=lim,
        points=points,
        pair=pair,
        checked_out_by=user,
    )
    return _snapshot_out(snapshot)


@api.get("/trend/snapshots", response=list[SnapshotOut], auth=bearer_auth)
def list_snapshots(request: HttpRequest):
    """已签出区：在线轨迹与既有副本两边都可看。"""
    rows = TrendSnapshot.objects.select_related("checked_out_by").all()[:50]
    return [_snapshot_out(r) for r in rows]


@api.get("/trend/snapshots/{snapshot_id}", response=SnapshotOut, auth=bearer_auth)
def get_snapshot(request: HttpRequest, snapshot_id: int):
    try:
        row = TrendSnapshot.objects.select_related("checked_out_by").get(pk=snapshot_id)
    except TrendSnapshot.DoesNotExist:
        raise HttpError(404, "签出副本不存在")
    return _snapshot_out(row)
