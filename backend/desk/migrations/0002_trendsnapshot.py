import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("desk", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="TrendSnapshot",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("limit", models.IntegerField()),
                ("points", models.JSONField(default=list)),
                ("pair", models.JSONField(blank=True, null=True)),
                ("checked_out_at", models.DateTimeField(auto_now_add=True)),
                (
                    "checked_out_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="trend_snapshots",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-checked_out_at"],
            },
        ),
        migrations.AlterModelOptions(
            name="offsetsubmission",
            options={"ordering": ["-created_at", "-id"]},
        ),
    ]
