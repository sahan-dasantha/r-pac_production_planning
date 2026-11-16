from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .excel import normalize_name
from .models import MACHINES, MAX_DB_INT, Job, Reference, ReferenceHistory, SalesOrder, UploadBatch, compute


# ---------------------------------------------------------------- Main Sheet
class ReferenceSerializer(serializers.ModelSerializer):
    updated_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = Reference
        fields = ["id", "name", "ups", "colours", "sides",
                  "default_machine", "updated_at", "updated_by"]

    def validate_name(self, value):
        value = " ".join(value.split())  # trim and collapse extra spaces
        # Orders are matched to references ignoring capitals, so two names
        # that differ only by case would be ambiguous.
        same = Reference.objects.filter(name__iexact=value)
        if self.instance:
            same = same.exclude(pk=self.instance.pk)
        if same.exists():
            raise serializers.ValidationError("A reference with this name already exists.")
        return value


class ReferenceHistorySerializer(serializers.ModelSerializer):
    changed_by = serializers.StringRelatedField()

    class Meta:
        model = ReferenceHistory
        fields = ["changes", "changed_by", "changed_at"]


# ------------------------------------------------------------------- Batches
class BatchSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.StringRelatedField()
    # These four come from annotations added in BatchViewSet.get_queryset.
    total = serializers.IntegerField(read_only=True)
    planned = serializers.IntegerField(read_only=True)
    skipped = serializers.IntegerField(read_only=True)
    pending = serializers.IntegerField(read_only=True)

    class Meta:
        model = UploadBatch
        fields = ["id", "filename", "uploaded_at", "uploaded_by",
                  "total", "planned", "skipped", "pending"]


# -------------------------------------------------------------------- Orders
class SalesOrderSerializer(serializers.ModelSerializer):
    """
    One SO for the Home page. Includes its Main Sheet values (reference) and
    its saved plan (job), so the page needs a single request for the whole list.
    The view passes context["refs"] = {normalised name: Reference}.
    """
    value = serializers.DecimalField(max_digits=14, decimal_places=2,
                                     coerce_to_string=False, read_only=True)
    reference = serializers.SerializerMethodField()
    job = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrder
        fields = ["id", "position", "so_number", "reference_name", "order_type",
                  "customer", "noc", "order_place_date", "quantity", "value",
                  "status", "reference", "job"]

    def get_reference(self, obj):
        ref = self.context.get("refs", {}).get(normalize_name(obj.reference_name))
        if ref is None:
            return None  # not in the Main Sheet -> the page offers "Add reference"
        return {"id": ref.id, "name": ref.name, "ups": ref.ups, "colours": ref.colours,
                "sides": ref.sides, "default_machine": ref.default_machine}

    def get_job(self, obj):
        job = getattr(obj, "job", None)
        if job is None:
            return None
        return {"id": job.id, "machine": job.machine, "ups": job.ups,
                "impressions": job.impressions,
                "total_impressions": job.total_impressions,
                "total_clicks": job.total_clicks}


class PlanSerializer(serializers.Serializer):
    """What the planner sends when clicking Next."""
    machine = serializers.ChoiceField(choices=MACHINES)
    ups = serializers.IntegerField(min_value=1, max_value=100000)


def check_overflow(quantity, ups, sides, colours):
    if compute(quantity, ups, sides, colours)[2] > MAX_DB_INT:
        raise serializers.ValidationError(
            {"ups": "Total clicks would be too large. Check the UPs value."}
        )


# ---------------------------------------------------------------- Job plans
class JobSerializer(serializers.ModelSerializer):
    created_by = serializers.StringRelatedField(read_only=True)
    order_id = serializers.IntegerField(source="sales_order_id", read_only=True)
    so_number = serializers.CharField(source="sales_order.so_number", read_only=True)
    order_type = serializers.CharField(source="sales_order.order_type", read_only=True)
    customer = serializers.CharField(source="sales_order.customer", read_only=True)
    order_place_date = serializers.DateField(source="sales_order.order_place_date", read_only=True)
    noc = serializers.IntegerField(source="sales_order.noc", read_only=True)
    value = serializers.DecimalField(source="sales_order.value", max_digits=14, decimal_places=2,
                                     coerce_to_string=False, read_only=True)
    batch_id = serializers.IntegerField(source="sales_order.batch_id", read_only=True)
    batch_name = serializers.CharField(source="sales_order.batch.filename", read_only=True)
    # The only two things a planner may change on a saved plan:
    machine = serializers.ChoiceField(choices=MACHINES)
    ups = serializers.IntegerField(min_value=1, max_value=100000)

    class Meta:
        model = Job
        fields = ["id", "order_id", "so_number", "order_type", "customer",
                  "order_place_date", "noc", "value", "batch_id", "batch_name",
                  "reference_name", "quantity", "machine", "ups", "colours", "sides",
                  "impressions", "total_impressions", "total_clicks",
                  "created_by", "created_at", "updated_at"]
        read_only_fields = ["reference_name", "quantity", "colours", "sides",
                            "impressions", "total_impressions", "total_clicks",
                            "created_at", "updated_at"]

    def validate(self, attrs):
        job = self.instance
        check_overflow(job.quantity, attrs.get("ups", job.ups), job.sides, job.colours)
        return attrs


# ------------------------------------------------------------------- Account
class MeSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = ["username", "first_name", "last_name", "email"]


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        validate_password(value, user=self.context["request"].user)
        return value