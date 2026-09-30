from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from desk.auth_utils import hash_password
from desk.models import OffsetSubmission, User


class Command(BaseCommand):
    help = "创建默认账号与种子刀补记录"

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

        # （刀具，刀补 µm，结论，距今年前分钟数）——近次结清点供连线台成线
        seeds = [
            ("T01", 5, OffsetSubmission.Verdict.PASS, 90),
            ("T09", 20, OffsetSubmission.Verdict.FAIL, 80),
            ("T02", -4, OffsetSubmission.Verdict.PASS, 70),
            ("T03", 15, OffsetSubmission.Verdict.FAIL, 60),
            ("T04", 8, OffsetSubmission.Verdict.PASS, 50),
            ("T05", -22, OffsetSubmission.Verdict.FAIL, 40),
            ("T06", 3, OffsetSubmission.Verdict.PASS, 30),
            ("T07", 11, OffsetSubmission.Verdict.PASS, 20),
            ("T08", -9, OffsetSubmission.Verdict.PASS, 10),
            ("T10", -6, OffsetSubmission.Verdict.PASS, 5),
        ]
        now = timezone.now()
        for tool_code, offset_um, verdict, minutes_ago in seeds:
            row, created = OffsetSubmission.objects.get_or_create(
                tool_code=tool_code,
                offset_um=offset_um,
                defaults={
                    "status": OffsetSubmission.Status.DONE,
                    "verdict": verdict,
                    "submitted_by": machinist,
                },
            )
            if created:
                stamped = now - timedelta(minutes=minutes_ago)
                OffsetSubmission.objects.filter(pk=row.pk).update(
                    created_at=stamped,
                    reviewed_at=stamped + timedelta(seconds=2),
                )

        self.stdout.write(self.style.SUCCESS("seed_offset_desk 完成"))
