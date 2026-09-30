from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from desk.auth_utils import hash_password
from desk.models import OffsetSubmission, User
from desk.services import evaluate_verdict

# 近次结清历史（旧 → 新）；最新的两条仍是 T01=5（合格）与 T09=20（超差）
HISTORY = [
    ("T11", -3),
    ("T12", 8),
    ("T03", 15),
    ("T04", -14),
    ("T05", 2),
    ("T06", 11),
    ("T07", -9),
    ("T08", 18),
    ("T02", 4),
    ("T10", -6),
]


class Command(BaseCommand):
    help = "创建默认账号与种子刀补记录（含近次结清历史，供在线连线台演示）"

    def handle(self, *args, **options):
        machinist, _ = User.objects.update_or_create(
            username="machinist",
            defaults={
                "role": User.Role.MACHINIST,
                "password": hash_password("machine123456"),
                "is_active": True,
            },
        )
        User.objects.update_or_create(
            username="auditor",
            defaults={
                "role": User.Role.AUDITOR,
                "password": hash_password("audit123456"),
                "is_active": True,
            },
        )

        now = timezone.now()
        seeds = [
            ("T01", 5, OffsetSubmission.Verdict.PASS),
            ("T09", 20, OffsetSubmission.Verdict.FAIL),
        ]
        for tool_code, offset_um, verdict in seeds:
            OffsetSubmission.objects.update_or_create(
                tool_code=tool_code,
                offset_um=offset_um,
                defaults={
                    "status": OffsetSubmission.Status.DONE,
                    "verdict": verdict,
                    "submitted_by": machinist,
                    "reviewed_at": now,
                },
            )

        # 历史批次只在仅有上述两条锚点记录时补入，避免重复 seed 产生重复点，
        # 也不覆盖运行期新提交的刀补。
        if OffsetSubmission.objects.count() <= len(seeds):
            total = len(HISTORY)
            for idx, (tool_code, offset_um) in enumerate(HISTORY):
                created = now - timedelta(hours=total - idx)
                reviewed = created + timedelta(minutes=2)
                row = OffsetSubmission.objects.create(
                    tool_code=tool_code,
                    offset_um=offset_um,
                    status=OffsetSubmission.Status.DONE,
                    verdict=evaluate_verdict(offset_um),
                    submitted_by=machinist,
                    reviewed_at=reviewed,
                )
                # auto_now_add 需在插入后回写，才能得到严格按时间排列的历史
                OffsetSubmission.objects.filter(pk=row.pk).update(created_at=created)

        self.stdout.write(self.style.SUCCESS("seed_offset_desk 完成"))
