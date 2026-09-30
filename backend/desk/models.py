from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        MACHINIST = "machinist", "操作员"
        AUDITOR = "auditor", "复核员"

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.MACHINIST,
    )

    @property
    def can_write(self) -> bool:
        return self.role == self.Role.MACHINIST


class OffsetSubmission(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "待复核"
        PROCESSING = "processing", "复核中"
        DONE = "done", "已完成"

    class Verdict(models.TextChoices):
        PASS = "合格", "合格"
        FAIL = "超差", "超差"

    tool_code = models.CharField(max_length=32, db_index=True)
    offset_um = models.IntegerField()
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    verdict = models.CharField(
        max_length=8,
        choices=Verdict.choices,
        blank=True,
        default="",
    )
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="submissions",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        # 总览表与在线轨迹共用同一排序：时间倒序（新在上），同刻再按 id 倒序
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.tool_code} {self.offset_um}µm"


class Checkout(models.Model):
    """签出只读副本：冻住签出时刻的近次结清点集与所选两点后台差值。

    点集/差值以 JSON 快照存库，之后新提交、新判定、再次签出都不改变既有副本。
    """

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="checkouts",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    point_count = models.PositiveIntegerField()
    # 点表快照（时间倒序）：id/刀具/刀补/结论/时间，连同曲线点位一并冻结
    points = models.JSONField(default=list)
    # 所选两点及后台算出的差值；未选点时为 null
    pair = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        who = self.created_by.username if self.created_by else "—"
        return f"副本#{self.id}（{self.point_count}点·{who}）"
