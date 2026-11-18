from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

MACHINES = [
    "7 - K", "RANPATH", "SM - A", "SM - B", "SM - C",
    "FROM BULK", "SCREEN", "PRINT CARE", "GUILLOTINE",
]
MACHINE_CHOICES = [(m, m) for m in MACHINES]

# Largest value a 32-bit integer column can hold (used by serializers for validation)
MAX_DB_INT = 2147483647


def compute(quantity, ups, sides, colours):
    """
    Same as your Excel sheet (IMPRESSION =E/P, TOTAL IMPRESSION =N*R, TOTAL CLICKS =O*Q):
        impressions       = ROUNDUP(quantity / ups)
        total impressions = impressions * sides
        total clicks      = total impressions * colours

    Returns (impressions, total_impressions, total_clicks) as whole numbers.
    """
    impressions = (2 * quantity + ups) // (2 * ups)
    total_impressions = impressions * sides
    total_clicks = total_impressions * colours
    return impressions, total_impressions, total_clicks


# ---------------------------------------------------------------------------
# Main Sheet data (KEPT from your version, unchanged)
# ---------------------------------------------------------------------------
class Reference(models.Model):
    name = models.CharField(max_length=255, unique=True)
    ups = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    colours = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    sides = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    default_machine = models.CharField(max_length=50, blank=True, choices=MACHINE_CHOICES)
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
    reference = models.ForeignKey(Reference, on_delete=models.CASCADE, related_name="history")
    changes = models.JSONField()  # e.g. {"ups": [30, 32]}
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at"]


# ---------------------------------------------------------------------------
# NEW: one upload = one batch. Replaces ReferenceUpload / UploadedReference.
# ---------------------------------------------------------------------------
class UploadBatch(models.Model):
    filename = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self):
        return f"{self.filename} ({self.uploaded_at:%Y-%m-%d %H:%M})"


class SalesOrder(models.Model):
    """One row of an uploaded sheet. Identified by the SO number (e.g. 26021008_0)."""
    PENDING, PLANNED, SKIPPED = "pending", "planned", "skipped"
    STATUSES = [(PENDING, "Pending"), (PLANNED, "Planned"), (SKIPPED, "Skipped")]

    # Re-uploading the same SO overwrites this row (update_or_create on so_number).
    so_number = models.CharField(max_length=50, unique=True)
    batch = models.ForeignKey(UploadBatch, on_delete=models.CASCADE, related_name="orders")
    position = models.PositiveIntegerField()  # 1, 2, 3 ... order in the sheet

    reference_name = models.CharField(max_length=255)  # text, because it may not exist yet
    order_type = models.CharField(max_length=100)
    customer = models.CharField(max_length=255)
    noc = models.PositiveIntegerField(default=0)       # Number of Changes
    order_place_date = models.DateField(null=True, blank=True)
    quantity = models.PositiveIntegerField()
    value = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    status = models.CharField(max_length=10, choices=STATUSES, default=PENDING, db_index=True)

    class Meta:
        ordering = ["batch", "position"]

    @property
    def reference(self):
        """The Main Sheet row for this order, or None -> UI shows 'Add reference'."""
        return Reference.objects.filter(name=self.reference_name).first()

    def __str__(self):
        return self.so_number


# ---------------------------------------------------------------------------
# Job plan: one per sales order (the Job Plans table row)
# ---------------------------------------------------------------------------
class Job(models.Model):
    sales_order = models.OneToOneField(SalesOrder, on_delete=models.CASCADE, related_name="job")
    # PROTECT: a reference that has jobs can never be deleted by accident.
    reference = models.ForeignKey(Reference, on_delete=models.PROTECT, related_name="jobs")

    # What the planner chooses / edits on the details panel
    machine = models.CharField(max_length=50, choices=MACHINE_CHOICES)
    ups = models.PositiveIntegerField(validators=[MinValueValidator(1)])  # editable per job

    # Snapshot, so later edits to the Main Sheet never change saved plans
    reference_name = models.CharField(max_length=255)
    quantity = models.PositiveIntegerField()
    colours = models.PositiveSmallIntegerField()
    sides = models.PositiveSmallIntegerField()

    # Calculated (whole numbers)
    impressions = models.PositiveIntegerField(editable=False)
    total_impressions = models.PositiveIntegerField(editable=False)
    total_clicks = models.PositiveIntegerField(editable=False)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sales_order__batch", "sales_order__position"]

    def calculate(self):
        """Fill in the calculated fields using the shared compute() function."""
        self.impressions, self.total_impressions, self.total_clicks = compute(
            self.quantity, self.ups, self.sides, self.colours
        )

    def save(self, *args, **kwargs):
        if self._state.adding:
            self.reference_name = self.reference.name
            self.quantity = self.sales_order.quantity
            self.colours = self.reference.colours
            self.sides = self.reference.sides
            if not self.ups:                      # planner didn't edit UPs
                self.ups = self.reference.ups     # <- your old code always overwrote this
        self.calculate()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.sales_order.so_number} / {self.reference_name}"


# ---------------------------------------------------------------------------
# Audit trail (KEPT from your version)
# ---------------------------------------------------------------------------
class JobLog(models.Model):
    ACTIONS = [("edited", "Edited"), ("deleted", "Deleted")]

    job_id = models.PositiveIntegerField()  # plain number so the log survives deletion
    reference_name = models.CharField(max_length=255)
    action = models.CharField(max_length=10, choices=ACTIONS)
    details = models.JSONField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-at"]

    def __str__(self):
        return f"{self.action} job {self.job_id} ({self.reference_name})"