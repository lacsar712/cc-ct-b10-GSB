from __future__ import annotations

from typing import Optional

from django.conf import settings
from django.utils import timezone
from ninja.errors import HttpError

from desk.models import Checkout, OffsetSubmission

# 在线台可选条数档位
TRACK_LIMITS = (5, 10, 20)
DEFAULT_TRACK_LIMIT = 10


def recent_settled(limit: int = DEFAULT_TRACK_LIMIT) -> list[OffsetSubmission]:
    """近次结清点：已完成、有结论，按总览表同序（时间倒序、id 倒序）。"""
    return list(
        OffsetSubmission.objects.filter(
            status=OffsetSubmission.Status.DONE
        ).exclude(verdict="")[: max(1, int(limit))]
    )


def point_payload(row: OffsetSubmission) -> dict:
    """一条结清点的快照字段（在线与签出副本共用同一结构）。"""
    return {
        "id": row.id,
        "tool_code": row.tool_code,
        "offset_um": row.offset_um,
        "verdict": row.verdict,
        "status": row.status,
        "created_at": row.created_at.isoformat(),
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
    }


def points_payload(rows: list[OffsetSubmission]) -> list[dict]:
    return [point_payload(r) for r in rows]


def compute_pair_diff(a: OffsetSubmission, b: OffsetSubmission) -> dict:
    """后台计算两点差值——页面禁止自行相减，一切以本函数结果为准。"""
    delta = b.offset_um - a.offset_um
    within = abs(delta) <= settings.OFFSET_TOLERANCE_UM
    return {
        "a": point_payload(a),
        "b": point_payload(b),
        "delta_um": delta,
        "abs_delta_um": abs(delta),
        "within_tolerance": within,
        "verdict": OffsetSubmission.Verdict.PASS if within else OffsetSubmission.Verdict.FAIL,
        "tolerance_um": settings.OFFSET_TOLERANCE_UM,
    }


def _settled_or_404(submission_id: int) -> OffsetSubmission:
    try:
        row = OffsetSubmission.objects.get(pk=submission_id)
    except OffsetSubmission.DoesNotExist:
        raise HttpError(404, "刀补点不存在")
    if row.status != OffsetSubmission.Status.DONE or not row.verdict:
        raise HttpError(400, "所选点尚未结清，无法计算差值")
    return row


def create_checkout(
    user,
    limit: int,
    first_id: Optional[int] = None,
    second_id: Optional[int] = None,
) -> Checkout:
    """生成只读副本：冻住当前近次结清点集，以及所选两点的后台差值。

    只允许操作员调用（在 API 层强制 can_write）。
    """
    rows = recent_settled(limit)
    points = points_payload(rows)

    pair = None
    if first_id is not None and second_id is not None:
        a = _settled_or_404(first_id)
        b = _settled_or_404(second_id)
        pair = compute_pair_diff(a, b)

    return Checkout.objects.create(
        created_by=user,
        point_count=len(points),
        points=points,
        pair=pair,
    )


def checkout_payload(co: Checkout) -> dict:
    """签出副本只读视图：点集与差值取自冻住的 JSON，不回查业务表。"""
    return {
        "id": co.id,
        "created_at": co.created_at.isoformat(),
        "point_count": co.point_count,
        "created_by": co.created_by.username if co.created_by else None,
        "points": co.points,
        "pair": co.pair,
    }


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
