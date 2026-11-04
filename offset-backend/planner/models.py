from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class Reference(models.Model):
    name = models.CharField(max_length=255, unique=True)
    ups = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    colours = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    sides = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    default_machine = models.CharField(max_length=50, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ReferenceHistory(models.Model):
    reference = models.ForeignKey(
        Reference, on_delete=models.CASCADE, related_name="history"
    )
    changes = models.JSONField()  # e.g. {"ups": [30, 32]}
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at"]

# Create your models here.
