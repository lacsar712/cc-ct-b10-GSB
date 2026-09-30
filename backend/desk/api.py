from datetime import datetime
from typing import Optional

from django.http import HttpRequest
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from desk.auth_utils import bearer_auth, create_access_token, verify_password
from desk.models import Checkout, OffsetSubmission, User
from desk import services

api = NinjaAPI(title="数控刀补复核台", version="1.1")


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


class PointOut(Schema):
    """近次结清点（在线轨迹与签出副本同一结构）。"""

    id: int
    tool_code: str
    offset_um: int
    verdict: str
    status: str
    created_at: datetime
    reviewed_at: Optional[datetime]


class TrackOut(Schema):
    points: list[PointOut]


class PairDiffIn(Schema):
    first_id: int
    second_id: int


class PairDiffOut(Schema):
    a: PointOut
    b: PointOut
    delta_um: int
    abs_delta_um: int
    within_tolerance: bool
    verdict: str
    tolerance_um: int


class CheckoutIn(Schema):
    limit: int = services.DEFAULT_TRACK_LIMIT
    first_id: Optional[int] = None
    second_id: Optional[int] = None


class CheckoutOut(Schema):
    id: int
    created_at: datetime
    point_count: int
    created_by: Optional[str]
    points: list[PointOut]
    pair: Optional[PairDiffOut]


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
# 在线连线台：近次结清点、两点后台差值、可签出只读副本
# ---------------------------------------------------------------------------


def _clamp_limit(value: int) -> int:
    try:
        value = int(value)
    except (TypeError, ValueError):
        value = services.DEFAULT_TRACK_LIMIT
    if value < 1:
        return 1
    return min(value, 200)


@api.get("/track/points", response=TrackOut, auth=bearer_auth)
def track_points(request: HttpRequest, limit: int = services.DEFAULT_TRACK_LIMIT):
    rows = services.recent_settled(_clamp_limit(limit))
    return {"points": [services.point_payload(r) for r in rows]}


@api.post("/track/diff", response=PairDiffOut, auth=bearer_auth)
def track_diff(request: HttpRequest, body: PairDiffIn):
    # 差值一律由后台计算，页面只负责挑两个点
    a = services._settled_or_404(body.first_id)
    b = services._settled_or_404(body.second_id)
    return services.compute_pair_diff(a, b)


@api.get("/checkouts", response=list[CheckoutOut], auth=bearer_auth)
def list_checkouts(request: HttpRequest):
    # 两边（操作员/复核员）都可看；列表只给摘要，点集与差值取冻结 JSON
    return [services.checkout_payload(co) for co in Checkout.objects.all()[:100]]


@api.get("/checkouts/{checkout_id}", response=CheckoutOut, auth=bearer_auth)
def get_checkout(request: HttpRequest, checkout_id: int):
    try:
        co = Checkout.objects.get(pk=checkout_id)
    except Checkout.DoesNotExist:
        raise HttpError(404, "签出副本不存在")
    return services.checkout_payload(co)


@api.post("/checkouts", response=CheckoutOut, auth=bearer_auth)
def create_checkout(request: HttpRequest, body: CheckoutIn):
    # 仅操作员可签出；副本为只读快照，一经生成不再改变
    user: User = request.auth
    if not user.can_write:
        raise HttpError(403, "当前账号只读，不能签出副本")
    limit = _clamp_limit(body.limit)

    first_id, second_id = body.first_id, body.second_id
    if (first_id is None) != (second_id is None):
        raise HttpError(400, "请挑选两个点（甲、乙）后再签出差值")

    co = services.create_checkout(user, limit, first_id, second_id)
    return services.checkout_payload(co)
