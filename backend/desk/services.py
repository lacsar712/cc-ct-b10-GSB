from django.conf import settings
from django.utils import timezone

from desk.models import OffsetSubmission


def evaluate_verdict(offset_um: int) -> str:
    if abs(offset_um) <= settings.OFFSET_TOLERANCE_UM:
        return OffsetSubmission.Verdict.PASS
    return OffsetSubmission.Verdict.FAIL


def apply_verdict(submission: OffsetSubmission) -> None:
    submission.verdict = evaluate_verdict(submission.offset_um)
    submission.status = OffsetSubmission.Status.DONE
    submission.reviewed_at = timezone.now()
    submission.save(
        update_fields=["verdict", "status", "reviewed_at"],
    )


TREND_LIMITS = (5, 10, 20)
TREND_LIMIT_DEFAULT = 10


def normalize_limit(raw) -> int:
    try:
        limit = int(raw)
    except (TypeError, ValueError):
        limit = TREND_LIMIT_DEFAULT
    return limit if limit in TREND_LIMITS else TREND_LIMIT_DEFAULT


def trend_point(row: OffsetSubmission) -> dict:
    return {
        "id": row.id,
        "tool_code": row.tool_code,
        "offset_um": row.offset_um,
        "verdict": row.verdict or "",
        "created_at": row.created_at.isoformat(),
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
    }


def recent_settled_points(limit: int) -> list[dict]:
    """近次已结清点，按 -created_at 排列——与首页复核列表同序，
    使在线轨迹与总览结清顺序严格一致。"""
    rows = (
        OffsetSubmission.objects.filter(status=OffsetSubmission.Status.DONE)
        .order_by("-created_at", "-id")[:limit]
    )
    return [trend_point(r) for r in rows]


def compare_points(points: list[dict], first_id: int, second_id: int) -> dict:
    """由后台对两个已结清点做差值。前端只提交两个点 id，禁止页面自行相减。"""
    by_id = {p["id"]: p for p in points}
    first = by_id.get(first_id)
    second = by_id.get(second_id)
    if first is None or second is None:
        raise ValueError("选中的点不在当前近次结清点集内")
    if first_id == second_id:
        raise ValueError("请挑两个不同的点比对")
    return {
        "first_id": first_id,
        "second_id": second_id,
        "first_tool_code": first["tool_code"],
        "second_tool_code": second["tool_code"],
        "first_offset_um": first["offset_um"],
        "second_offset_um": second["offset_um"],
        "diff_um": second["offset_um"] - first["offset_um"],
        "abs_diff_um": abs(second["offset_um"] - first["offset_um"]),
    }
