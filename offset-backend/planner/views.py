import re
from datetime import date

from django.db import transaction
from django.db.models import Count, ProtectedError, Q
from django.http import HttpResponse
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .excel import (
    ExcelReadError, SheetValidationError, build_jobs_workbook,
    normalize_name, parse_sales_orders,
)
from .models import (
    MACHINES, Job, JobLog, Reference, ReferenceHistory, SalesOrder, UploadBatch,
)
from .serializers import (
    BatchSerializer, ChangePasswordSerializer, JobSerializer, MeSerializer,
    PlanSerializer, ReferenceHistorySerializer, ReferenceSerializer,
    SalesOrderSerializer, check_overflow,
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # reject files over 10 MB
TRACKED = ["ups", "colours", "sides", "default_machine"]
TRACKED_JOB_FIELDS = ["machine", "ups", "total_clicks"]


# ------------------------------------------------------------------ helpers
def reference_lookup():
    """Every Main Sheet reference, keyed by normalised name (one query)."""
    return {normalize_name(r.name): r for r in Reference.objects.all()}


def job_snapshot(job):
    """A job's full details, for the audit log."""
    return {
        "so_number": job.sales_order.so_number,
        "machine": job.machine,
        "quantity": job.quantity,
        "ups": job.ups,
        "colours": job.colours,
        "sides": job.sides,
        "impressions": job.impressions,
        "total_impressions": job.total_impressions,
        "total_clicks": job.total_clicks,
        "saved_by": job.created_by.username if job.created_by else None,
        "saved_at": job.created_at.isoformat(),
    }


def log_job(job, action_name, details, user):
    JobLog.objects.create(
        job_id=job.id, reference_name=job.reference_name,
        action=action_name, details=details, user=user,
    )


def remove_job(job, user, reason):
    """Delete a job and write the log line first (the id is gone afterwards)."""
    log_job(job, "deleted", {**job_snapshot(job), "reason": reason}, user)
    job.delete()


# --------------------------------------------------------------- Main Sheet
class ReferenceViewSet(viewsets.ModelViewSet):
    queryset = Reference.objects.all()
    serializer_class = ReferenceSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["name"]
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def perform_create(self, serializer):
        ref = serializer.save(updated_by=self.request.user)
        ReferenceHistory.objects.create(
            reference=ref, changes={"created": True}, changed_by=self.request.user
        )

    def perform_update(self, serializer):
        old = {f: getattr(serializer.instance, f) for f in TRACKED}
        ref = serializer.save(updated_by=self.request.user)
        changes = {f: [old[f], getattr(ref, f)] for f in TRACKED if old[f] != getattr(ref, f)}
        if changes:
            ReferenceHistory.objects.create(
                reference=ref, changes=changes, changed_by=self.request.user
            )

    def destroy(self, request, *args, **kwargs):
        ref = self.get_object()
        count = ref.jobs.count()
        if count:
            return Response(
                {"detail": f"'{ref.name}' is used by {count} saved job plan"
                           f"{'s' if count != 1 else ''} and cannot be deleted. "
                           "Delete those job plans first."},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response({"detail": "This reference is in use and cannot be deleted."},
                            status=status.HTTP_409_CONFLICT)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        qs = self.get_object().history.all()[:50]
        return Response(ReferenceHistorySerializer(qs, many=True).data)

    @action(detail=False, methods=["get"])
    def machines(self, request):
        return Response(MACHINES)


# ------------------------------------------------------------------ Batches
def save_batch(filename, rows, user):
    """
    Store one uploaded sheet as a batch. All or nothing.
    A SO number that already exists is OVERWRITTEN with the new details and
    moves into this batch. Its saved plan is kept, unless the quantity or
    reference changed, in which case the plan is no longer valid: it is
    deleted (and logged) and the order becomes pending again.
    """
    refs = reference_lookup()
    fields = ["reference_name", "order_type", "customer", "noc",
              "order_place_date", "quantity", "value"]
    so_numbers = [r["so_number"] for r in rows]

    with transaction.atomic():
        batch = UploadBatch.objects.create(filename=filename, uploaded_by=user)

        existing = {}
        for i in range(0, len(so_numbers), 500):  # small chunks, safe for SQLite
            chunk = so_numbers[i:i + 500]
            for order in SalesOrder.objects.filter(so_number__in=chunk).select_related("job"):
                existing[order.so_number] = order

        to_create, to_update, plans_reset = [], [], 0
        for position, row in enumerate(rows, start=1):
            values = {f: row[f] for f in fields}
            order = existing.get(row["so_number"])
            if order is None:
                to_create.append(SalesOrder(
                    so_number=row["so_number"], batch=batch, position=position,
                    status=SalesOrder.PENDING, **values))
                continue

            job = getattr(order, "job", None)
            if job and (job.quantity != row["quantity"] or
                        normalize_name(job.reference_name) != normalize_name(row["reference_name"])):
                remove_job(job, user, "SO re-uploaded with a different quantity or reference")
                order.status = SalesOrder.PENDING
                plans_reset += 1
            for field, value in values.items():
                setattr(order, field, value)
            order.batch, order.position = batch, position
            to_update.append(order)

        SalesOrder.objects.bulk_create(to_create)
        SalesOrder.objects.bulk_update(to_update, fields + ["batch", "position", "status"])

    missing = {normalize_name(r["reference_name"]) for r in rows} - set(refs)
    return batch, {
        "created": len(to_create),
        "overwritten": len(to_update),
        "plans_reset": plans_reset,
        "missing_references": len(missing),
    }


class BatchViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = BatchSerializer
    pagination_class = None  # a handful of batches: send them all

    def get_queryset(self):
        return (
            UploadBatch.objects.select_related("uploaded_by")
            .annotate(
                total=Count("orders"),
                planned=Count("orders", filter=Q(orders__status=SalesOrder.PLANNED)),
                skipped=Count("orders", filter=Q(orders__status=SalesOrder.SKIPPED)),
                pending=Count("orders", filter=Q(orders__status=SalesOrder.PENDING)),
            )
            .filter(total__gt=0)  # a batch whose orders all moved to a newer upload is hidden
        )

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def upload(self, request):
        """POST /api/batches/upload/  (form field: "file")"""
        file = request.FILES.get("file")
        if file is None:
            return Response({"detail": "No file was uploaded."}, status=400)
        if not file.name.lower().endswith(".xlsx"):
            return Response({"detail": "Only .xlsx files are supported."}, status=400)
        if file.size > MAX_UPLOAD_BYTES:
            return Response({"detail": "File is too large (maximum 10 MB)."}, status=400)

        try:
            rows = parse_sales_orders(file)
        except SheetValidationError as e:  # must come before ExcelReadError
            return Response({"detail": str(e), "errors": e.errors, "error_count": e.total}, status=400)
        except ExcelReadError as e:
            return Response({"detail": str(e)}, status=400)

        batch, counts = save_batch(file.name, rows, request.user)
        batch = self.get_queryset().get(pk=batch.pk)
        return Response({"batch": BatchSerializer(batch).data, **counts},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def orders(self, request, pk=None):
        """GET /api/batches/<id>/orders/ -> EVERY order of the batch (not paged)."""
        batch = self.get_object()
        qs = batch.orders.select_related("job").order_by("position")
        data = SalesOrderSerializer(qs, many=True, context={"refs": reference_lookup()}).data
        return Response(data)


# ------------------------------------------------------------------- Orders
class SalesOrderViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = SalesOrder.objects.select_related("job")
    serializer_class = SalesOrderSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "refs": reference_lookup()}

    def respond(self, order):
        order = self.get_queryset().get(pk=order.pk)  # fresh, with its job
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def plan(self, request, pk=None):
        """POST /api/orders/<id>/plan/  {machine, ups}  = the Next button."""
        order = self.get_object()
        form = PlanSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        machine, ups = form.validated_data["machine"], form.validated_data["ups"]

        ref = reference_lookup().get(normalize_name(order.reference_name))
        if ref is None:
            return Response(
                {"detail": f"'{order.reference_name}' is not in the Main sheet. Add it first.",
                 "code": "missing_reference"},
                status=status.HTTP_409_CONFLICT,
            )
        check_overflow(order.quantity, ups, ref.sides, ref.colours)

        with transaction.atomic():
            job = Job.objects.filter(sales_order=order).select_related("sales_order").first()
            if job is None:
                Job.objects.create(sales_order=order, reference=ref, machine=machine,
                                   ups=ups, created_by=request.user)
            else:  # re-planning (the planner used Previous or clicked the SO)
                old = {f: str(getattr(job, f)) for f in TRACKED_JOB_FIELDS}
                job.reference, job.machine, job.ups = ref, machine, ups
                job.take_snapshot()  # pick up any Main sheet edits since
                job.save()
                changes = {f: [old[f], str(getattr(job, f))]
                           for f in TRACKED_JOB_FIELDS if old[f] != str(getattr(job, f))}
                if changes:
                    log_job(job, "edited", changes, request.user)
            order.status = SalesOrder.PLANNED
            order.save(update_fields=["status"])
        return self.respond(order)

    def change_status(self, request, new_status, reason):
        order = self.get_object()
        with transaction.atomic():
            job = Job.objects.filter(sales_order=order).select_related("sales_order").first()
            if job:
                remove_job(job, request.user, reason)
            order.status = new_status
            order.save(update_fields=["status"])
        return self.respond(order)

    @action(detail=True, methods=["post"])
    def skip(self, request, pk=None):
        """The order can't be planned now. Any saved plan for it is removed."""
        return self.change_status(request, SalesOrder.SKIPPED, "order skipped")

    @action(detail=True, methods=["post"])
    def reset(self, request, pk=None):
        """Back to pending (for example to un-skip an order)."""
        return self.change_status(request, SalesOrder.PENDING, "order reset to pending")


# ---------------------------------------------------------------- Job plans
class JobPagination(PageNumberPagination):
    page_size = 50


def safe_filename_part(text):
    stem = re.sub(r"\.xlsx$", "", text, flags=re.I)
    return re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("_")[:60] or "plans"


class JobViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,   # PATCH: change machine and UPs
    mixins.DestroyModelMixin,  # DELETE: the order goes back to pending
    viewsets.GenericViewSet,
):
    serializer_class = JobSerializer
    pagination_class = JobPagination
    filter_backends = [filters.SearchFilter]
    search_fields = ["sales_order__so_number", "reference_name",
                     "sales_order__customer", "machine"]
    http_method_names = ["get", "patch", "delete", "head", "options"]  # plans are created by orders/<id>/plan/

    def get_queryset(self):
        qs = Job.objects.select_related("sales_order__batch", "created_by")
        batch = self.request.query_params.get("batch")  # ?batch=<id>, or all batches
        if batch and batch.isdigit():
            qs = qs.filter(sales_order__batch_id=int(batch))
        return qs.order_by("-sales_order__batch__uploaded_at",
                           "sales_order__batch_id", "sales_order__position")

    def perform_update(self, serializer):
        old = {f: str(getattr(serializer.instance, f)) for f in TRACKED_JOB_FIELDS}
        with transaction.atomic():
            job = serializer.save()  # Job.save() recalculates everything
            changes = {f: [old[f], str(getattr(job, f))]
                       for f in TRACKED_JOB_FIELDS if old[f] != str(getattr(job, f))}
            if changes:
                log_job(job, "edited", changes, self.request.user)

    def perform_destroy(self, instance):
        with transaction.atomic():
            order = instance.sales_order
            remove_job(instance, self.request.user, "deleted from Job plans")
            order.status = SalesOrder.PENDING  # so it can be planned again
            order.save(update_fields=["status"])

    @action(detail=False, methods=["get"])
    def export(self, request):
        """GET /api/jobs/export/?batch=<id>  -> Excel file (all batches if no id)."""
        jobs = self.get_queryset()  # not paged, not searched: the whole batch
        content = build_jobs_workbook(jobs)
        batch = request.query_params.get("batch")
        label = "all"
        if batch and batch.isdigit():
            found = UploadBatch.objects.filter(pk=int(batch)).first()
            label = safe_filename_part(found.filename) if found else f"batch-{batch}"
        response = HttpResponse(
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = (
            f'attachment; filename="job-plans-{label}-{date.today():%Y-%m-%d}.xlsx"'
        )
        return response


# ------------------------------------------------------------------ Account
class MeView(APIView):
    """GET /api/me/ and PATCH /api/me/ : the three-line menu's profile."""

    def get(self, request):
        return Response(MeSerializer(request.user).data)

    def patch(self, request):
        serializer = MeSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    """POST /api/me/change-password/  {current_password, new_password}"""

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save()
        return Response({"detail": "Password changed."})