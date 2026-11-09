from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

MACHINES = [
    "7 - K", "RANPATH", "SM - B", "SM - C",
    "FROM BULK", "SCREEN", "PRINT CARE", "GUILLOTINE",
]


class Reference(models.Model):
    name = models.CharField(max_length=255, unique=True)
    ups = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    colours = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    sides = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    default_machine = models.CharField(max_length=50, blank=True, choices=[(m,m) for m in MACHINES])
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

class Job(models.Model):
    """
    One saved job from the Home form.
    Think of it as one row in the 'Job plans' table.
    """

    # ---- 1) What the user chooses/types on the Home form ----------------
    # PROTECT = a reference that has jobs can never be deleted by accident.
    reference = models.ForeignKey(
        Reference, on_delete=models.PROTECT, related_name="jobs"
    )
    date = models.DateField()
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    machine = models.CharField(
        max_length=50, choices=[(m, m) for m in MACHINES]
    )

    # ---- 2) Snapshot: copied from the reference when the job is first saved
    # Why copy? If someone edits a reference later (e.g. changes its UPs),
    # jobs that were already planned must keep the numbers they were saved with.
    reference_name = models.CharField(max_length=255)
    ups = models.PositiveIntegerField()
    colours = models.PositiveSmallIntegerField()
    sides = models.PositiveSmallIntegerField()

    # ---- 3) Calculated values (always whole numbers, rounded up) -------
    # editable=False means nobody can type these in: the model fills them.
    impressions = models.PositiveIntegerField(editable=False)
    total_impressions = models.PositiveIntegerField(editable=False)
    total_clicks = models.PositiveIntegerField(editable=False)

    # ---- 4) Bookkeeping ------------------------------------------------
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]  # newest job first

    def calculate(self):
        """
        The three formulas from the Excel sheet, with impressions rounded UP:
            impressions       = ROUNDUP(quantity / ups)
            total impressions = impressions * sides
            total clicks      = total impressions * colours
        """
        # Ceiling division using whole numbers only.
        # (q + u - 1) // u  is the same as ROUNDUP(q / u), but it avoids
        # floating-point surprises with big quantities.
        self.impressions = (self.quantity + self.ups - 1) // self.ups
        self.total_impressions = self.impressions * self.sides
        self.total_clicks = self.total_impressions * self.colours

    def save(self, *args, **kwargs):
        # _state.adding is True only the very first time the job is saved.
        if self._state.adding:
            # Copy the reference's current values into this job (the snapshot).
            self.reference_name = self.reference.name
            self.ups = self.reference.ups
            self.colours = self.reference.colours
            self.sides = self.reference.sides

        # Always recalculate before writing to the database.
        self.calculate()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.reference_name} ({self.date})"

class ReferenceUpload(models.Model):
    """
    One uploaded Excel sheet. The NEWEST upload is the one that feeds the
    Home dropdown; older uploads are kept but not shown.
    """
    filename = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]  # newest first, so .first() = current upload

    def __str__(self):
        return f"{self.filename} ({self.uploaded_at:%Y-%m-%d %H:%M})"


class UploadedReference(models.Model):
    """
    One reference name taken from an uploaded sheet.
    Only the NAME is stored here. UPs, colours and sides always come from
    the Reference table (the Main sheet data).
    """
    upload = models.ForeignKey(
        ReferenceUpload, on_delete=models.CASCADE, related_name="items"
    )
    name = models.CharField(max_length=255)
    position = models.PositiveIntegerField()  # keeps the order of the sheet

    class Meta:
        ordering = ["position"]

    def __str__(self):
        return self.name 

class JobLog(models.Model):
    """
    One line in the audit trail: a job was edited or deleted.
    job_id is a plain number (not a ForeignKey) on purpose, so the log
    survives after the job itself is deleted.
    """
    ACTIONS = [("edited", "Edited"), ("deleted", "Deleted")]

    job_id = models.PositiveIntegerField()
    reference_name = models.CharField(max_length=255)
    action = models.CharField(max_length=10, choices=ACTIONS)
    # edited  -> {"quantity": ["50000", "60000"], ...}  (old, new)
    # deleted -> the job's full details at the moment it was deleted
    details = models.JSONField()
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-at"]  # newest first

    def __str__(self):
        return f"{self.action} job {self.job_id} ({self.reference_name})"       
# Create your models here.
