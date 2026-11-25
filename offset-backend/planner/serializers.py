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
    """
    One row of the Job plans table. Every column can be edited (PATCH) except the
    calculated ones (balance, impressions, total impressions, total clicks) and
    the bookkeeping ones (who planned it, dates).

    Order details (SO number, customer, FG ...) belong to the order, so a change
    to them is seen in every sheet that contains that order.
    """
    created_by = serializers.StringRelatedField(read_only=True)
    order_id = serializers.IntegerField(source="sales_order_id", read_only=True)
    # empty when the sheet of this plan was deleted
    batch_id = serializers.IntegerField(
        source="sales_order.batch_id", read_only=True, allow_null=True)
    batch_name = serializers.CharField(
        source="sales_order.batch.filename", read_only=True, allow_null=True)

    # ---- the order's own details (editable) ----
    so_number = serializers.CharField(source="sales_order.so_number", max_length=50)
    order_type = serializers.CharField(source="sales_order.order_type", max_length=100)
    customer = serializers.CharField(source="sales_order.customer", max_length=255)
    order_place_date = serializers.DateField(
        source="sales_order.order_place_date", required=False, allow_null=True)
    noc = serializers.IntegerField(source="sales_order.noc", min_value=0, max_value=MAX_DB_INT)
    value = serializers.DecimalField(
        source="sales_order.value", max_digits=14, decimal_places=2,
        min_value=0, coerce_to_string=False)
    current_stage = serializers.CharField(
        source="sales_order.current_stage", max_length=100, required=False, allow_blank=True)
    docket_stage = serializers.CharField(
        source="sales_order.docket_stage", max_length=100, required=False, allow_blank=True)
    hold_status = serializers.CharField(
        source="sales_order.hold_status", max_length=100, required=False, allow_blank=True)
    fg = serializers.IntegerField(
        source="sales_order.fg", min_value=0, max_value=MAX_DB_INT,
        required=False, allow_null=True)
    balance = serializers.SerializerMethodField()  # quantity - fg (null when FG is unknown)

    # ---- the plan's own details (editable) ----
    reference_name = serializers.CharField(max_length=255)
    quantity = serializers.IntegerField(min_value=1, max_value=MAX_DB_INT)
    machine = serializers.ChoiceField(choices=MACHINES)
    ups = serializers.IntegerField(min_value=1, max_value=100000)
    colours = serializers.IntegerField(min_value=1, max_value=1000)
    sides = serializers.IntegerField(min_value=1, max_value=1000)

    class Meta:
        model = Job
        fields = ["id", "order_id", "so_number", "order_type", "customer",
                  "order_place_date", "noc", "value", "batch_id", "batch_name",
                  "current_stage", "docket_stage", "hold_status", "fg", "balance",
                  "reference_name", "quantity", "machine", "ups", "colours", "sides",
                  "impressions", "total_impressions", "total_clicks",
                  "created_by", "created_at", "updated_at"]
        read_only_fields = ["impressions", "total_impressions", "total_clicks",
                            "created_at", "updated_at"]

    def get_balance(self, obj):
        fg = obj.sales_order.fg
        return None if fg is None else obj.quantity - fg

    def validate_so_number(self, value):
        value = " ".join(value.split())
        same = SalesOrder.objects.filter(so_number=value)
        if self.instance:
            same = same.exclude(pk=self.instance.sales_order_id)
        if same.exists():
            raise serializers.ValidationError("Another order already has this SO number.")
        return value

    def validate_reference_name(self, value):
        value = " ".join(value.split())
        if not Reference.objects.filter(name__iexact=value).exists():
            raise serializers.ValidationError(
                f"'{value}' is not in the Main sheet. Add it there first.")
        return value

    def validate(self, attrs):
        job = self.instance
        check_overflow(
            attrs.get("quantity", job.quantity), attrs.get("ups", job.ups),
            attrs.get("sides", job.sides), attrs.get("colours", job.colours),
        )
        return attrs

    def update(self, job, validated_data):
        order = job.sales_order
        for field, value in validated_data.pop("sales_order", {}).items():
            setattr(order, field, value)

        if "quantity" in validated_data:  # the order and its plan share the quantity
            order.quantity = validated_data["quantity"]
        if "reference_name" in validated_data:
            ref = Reference.objects.filter(name__iexact=validated_data["reference_name"]).first()
            job.reference = ref
            validated_data["reference_name"] = ref.name
            order.reference_name = ref.name

        for field, value in validated_data.items():
            setattr(job, field, value)
        order.save()
        job.save()  # recalculates impressions, total impressions and total clicks
        return job


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