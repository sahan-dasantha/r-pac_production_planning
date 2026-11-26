import re
from datetime import date

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, OuterRef, ProtectedError, Q, Subquery
from django.http import HttpResponse
from django.utils.dateparse import parse_datetime
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
    MACHINES, BatchOrder, Job, JobLog, Reference, ReferenceHistory, SalesOrder,
    UploadBatch,
)
from .serializers import (
    BatchSerializer, ChangePasswordSerializer, JobSerializer, MeSerializer,
    PlanSerializer, ReferenceHistorySerializer, ReferenceSerializer,
    SalesOrderSerializer, check_overflow,
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # reject files over 10 MB
TRACKED = ["ups", "colours", "sides", "default_machine"]
TRACKED_JOB_FIELDS = ["machine", "ups", "colours", "sides", "total_clicks"]
# Optional sheet columns that are stored on the order when the sheet has them.
OPTIONAL_ORDER_FIELDS = ["current_stage", "docket_stage", "fg", "hold_status"]


# ------------------------------------------------------------------ helpers
def reference_lookup():
    """Every Main Sheet reference, keyed by normalised name (one query)."""
    return {normalize_name(r.name): r for r in Reference.objects.all()}


def backfill_entries():
    """
    Orders saved before sheets could share orders have no BatchOrder row yet.
    Create it from the sheet the order was saved in. Safe to call any time.
    """
    missing = (SalesOrder.objects.filter(entries__isnull=True, batch__isnull=False)
               .only("id", "batch_id", "position"))
    rows = [BatchOrder(batch_id=o.batch_id, order_id=o.id, position=o.position) for o in missing]
    if rows:
        BatchOrder.objects.bulk_create(rows, batch_size=500, ignore_conflicts=True)


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


def edit_snapshot(job):
    """Every value a planner can change on a job plan, as text (for the edit log)."""
    o = job.sales_order
    values = {
        "so_number": o.so_number, "order_type": o.order_type, "customer": o.customer,
        "order_place_date": o.order_place_date, "noc": o.noc, "value": o.value,
        "current_stage": o.current_stage, "docket_stage": o.docket_stage,
        "hold_status": o.hold_status, "fg": o.fg,
        "reference_name": job.reference_name, "quantity": job.quantity,
        "machine": job.machine, "ups": job.ups, "colours": job.colours,
        "sides": job.sides, "total_clicks": job.total_clicks,
    }
    return {k: str(x) for k, x in values.items()}


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
    A SO number that already exists is UPDATED with the new details and is
    added to this batch. It also STAYS in the earlier sheets that had it, so
    uploading a bigger sheet never empties the smaller ones. Its saved plan is
    kept, unless the quantity or reference changed, in which case the plan is
    no longer valid: it is deleted (and logged) and the order becomes pending again.
    """
    refs = reference_lookup()
    fields = ["reference_name", "order_type", "customer", "noc",
              "order_place_date", "quantity", "value"]
    # Only the optional columns that this sheet actually has: a sheet without
    # them must not wipe the values saved by an earlier upload.
    fields += [f for f in OPTIONAL_ORDER_FIELDS if rows and f in rows[0]]
    so_numbers = [r["so_number"] for r in rows]

    with transaction.atomic():
        backfill_entries()  # keep the earlier sheets complete before anything changes
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

        # Record which orders are in THIS sheet. Orders that are also in older
        # sheets stay in those sheets too: nothing is taken away from them.
        ids = {}
        for i in range(0, len(so_numbers), 500):
            chunk = so_numbers[i:i + 500]
            ids.update(SalesOrder.objects.filter(so_number__in=chunk).values_list("so_number", "id"))
        BatchOrder.objects.bulk_create(
            [BatchOrder(batch=batch, order_id=ids[r["so_number"]], position=position)
             for position, r in enumerate(rows, start=1)],
            batch_size=500,
        )

    missing = {normalize_name(r["reference_name"]) for r in rows} - set(refs)
    return batch, {
        "created": len(to_create),
        "overwritten": len(to_update),
        "plans_reset": plans_reset,
        "missing_references": len(missing),
    }


class BatchViewSet(
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,  # DELETE /api/batches/<id>/ : remove one uploaded sheet
    viewsets.GenericViewSet,
):
    serializer_class = BatchSerializer
    pagination_class = None  # a handful of batches: send them all

    def get_queryset(self):
        backfill_entries()
        return (
            UploadBatch.objects.select_related("uploaded_by")
            .annotate(
                # counted from the sheet's own list of orders (BatchOrder)
                total=Count("entries"),
                planned=Count("entries", filter=Q(entries__order__status=SalesOrder.PLANNED)),
                skipped=Count("entries", filter=Q(entries__order__status=SalesOrder.SKIPPED)),
                pending=Count("entries", filter=Q(entries__order__status=SalesOrder.PENDING)),
            )
            .filter(total__gt=0)
        )

    def destroy(self, request, *args, **kwargs):
        batch = self.get_object()
        try:
            kept = self.perform_destroy(batch)
        except ProtectedError:
            return Response(
                {"detail": "This sheet is in use and cannot be removed."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"kept_plans": kept})

    def perform_destroy(self, instance):
        """
        Delete one sheet. Saved job plans are NEVER deleted:
          - an order that is also in another sheet simply stays in that sheet;
          - an order with a saved plan that was only in this sheet is kept too
            (its plan stays in the Job plans tab, under "Plans of deleted sheets");
          - an order with no plan was only a row of this sheet, so it is deleted.
        Returns how many saved plans were kept without a sheet. All or nothing.
        """
        kept = 0
        with transaction.atomic():
            entries = list(instance.entries.select_related("order__job"))
            instance.entries.all().delete()  # the orders leave this sheet
            for entry in entries:
                order = entry.order
                newest = BatchOrder.objects.filter(order=order).order_by("-batch_id").first()
                if newest is not None:
                    if order.batch_id == instance.id:
                        # still in another sheet: point it at the newest one
                        order.batch_id, order.position = newest.batch_id, newest.position
                        order.save(update_fields=["batch", "position"])
                elif getattr(order, "job", None) is not None:
                    kept += 1  # keeps its plan; its sheet becomes empty (SET_NULL)
                else:
                    order.delete()  # a plain row of this sheet, nothing to keep
            instance.delete()
        return kept

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
        orders = []
        for entry in batch.entries.select_related("order__job").order_by("position"):
            entry.order.position = entry.position  # the row number in THIS sheet
            orders.append(entry.order)
        data = SalesOrderSerializer(orders, many=True, context={"refs": reference_lookup()}).data
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
        """POST /api/orders/<id>/plan/  {machine, ups, colours, sides}  = the Next button."""
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
        # The planner may have edited the colours and sides in the Job breakdown
        # panel: use their values, and the Main sheet values only when none were sent.
        colours = form.validated_data.get("colours", ref.colours)
        sides = form.validated_data.get("sides", ref.sides)
        check_overflow(order.quantity, ups, sides, colours)

        with transaction.atomic():
            job = Job.objects.filter(sales_order=order).select_related("sales_order").first()
            if job is None:
                Job.objects.create(sales_order=order, reference=ref, machine=machine,
                                   ups=ups, colours=colours, sides=sides,
                                   created_by=request.user)
            else:  # re-planning (the planner used Previous or clicked the SO)
                old = {f: str(getattr(job, f)) for f in TRACKED_JOB_FIELDS}
                job.reference, job.machine, job.ups = ref, machine, ups
                job.colours, job.sides = colours, sides
                job.reference_name = ref.name  # pick up any Main sheet name change
                job.quantity = order.quantity
                job.save()  # recalculates impressions, total impressions, total clicks
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
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]  # POST only for jobs/restore/; plans are created by orders/<id>/plan/

    def get_queryset(self):
        backfill_entries()
        qs = Job.objects.select_related("sales_order__batch", "created_by")
        batch = self.request.query_params.get("batch")  # ?batch=<id>, "none", or all batches
        if batch == "none":  # plans whose Excel sheet was deleted
            return qs.filter(sales_order__entries__isnull=True).order_by("-updated_at")
        if batch and batch.isdigit():
            batch_id = int(batch)
            # every job of an order that is in this sheet, in the sheet's own order
            row_in_sheet = BatchOrder.objects.filter(
                batch_id=batch_id, order_id=OuterRef("sales_order_id")
            ).values("position")[:1]
            return (qs.filter(sales_order__entries__batch_id=batch_id)
                      .annotate(sheet_position=Subquery(row_in_sheet))
                      .order_by("sheet_position"))
        return qs.order_by("-sales_order__batch__uploaded_at",
                           "sales_order__batch_id", "sales_order__position")

    def perform_update(self, serializer):
        old = edit_snapshot(serializer.instance)  # taken BEFORE the save
        with transaction.atomic():
            job = serializer.save()  # Job.save() recalculates everything
            new = edit_snapshot(job)
            changes = {f: [old[f], new[f]] for f in new if old[f] != new[f]}
            if changes:
                log_job(job, "edited", changes, self.request.user)

    def perform_destroy(self, instance):
        with transaction.atomic():
            order = instance.sales_order
            remove_job(instance, self.request.user, "deleted from Job plans")
            order.status = SalesOrder.PENDING  # so it can be planned again
            order.save(update_fields=["status"])

    @action(detail=False, methods=["post"])
    def restore(self, request):
        """
        POST /api/jobs/restore/  {"ids": [12, 13]}  = the Undo button.
        Brings deleted job plans back from the audit log. A plan is skipped
        (with a reason) when it can no longer be restored safely.
        """
        ids = request.data.get("ids")
        if (not isinstance(ids, list) or not ids or len(ids) > 500
                or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids)):
            return Response({"detail": "Send a list of job ids to restore."}, status=400)

        User = get_user_model()
        refs = reference_lookup()
        restored, skipped = [], []

        with transaction.atomic():
            for old_id in ids:
                log = (JobLog.objects.filter(job_id=old_id, action="deleted")
                       .order_by("-at").first())
                if log is None:
                    skipped.append({"id": old_id, "reason": "No deleted plan was found."})
                    continue
                d = log.details
                order = SalesOrder.objects.filter(so_number=d.get("so_number")).first()
                ref = refs.get(normalize_name(log.reference_name))

                if order is None:
                    reason = "The order no longer exists."
                elif Job.objects.filter(sales_order=order).exists():
                    reason = "The order already has a job plan."
                elif ref is None:
                    reason = f"'{log.reference_name}' is no longer in the Main sheet."
                elif (order.quantity != d.get("quantity")
                      or normalize_name(order.reference_name) != normalize_name(log.reference_name)):
                    reason = "The order was changed by a newer upload."
                else:
                    reason = None

                if reason:
                    skipped.append({"id": old_id, "reason": reason})
                    continue

                owner = None
                if d.get("saved_by"):
                    owner = User.objects.filter(username=d["saved_by"]).first()
                job = Job.objects.create(
                    sales_order=order, reference=ref, machine=d["machine"], ups=d["ups"],
                    colours=d["colours"], sides=d["sides"],
                    created_by=owner or request.user,
                )
                saved_at = parse_datetime(d["saved_at"]) if d.get("saved_at") else None
                if saved_at:  # keep the original "planned on" time
                    Job.objects.filter(pk=job.pk).update(created_at=saved_at)
                order.status = SalesOrder.PLANNED
                order.save(update_fields=["status"])
                log_job(job, "restored", {"so_number": order.so_number,
                                          "restored_from_job_id": old_id}, request.user)
                restored.append(job.id)

        return Response({"restored": restored, "skipped": skipped})

    @action(detail=False, methods=["get"])
    def export(self, request):
        """GET /api/jobs/export/?batch=<id>  -> Excel file (all batches if no id)."""
        jobs = self.get_queryset()  # not paged, not searched: the whole batch
        content = build_jobs_workbook(jobs)
        batch = request.query_params.get("batch")
        label = "deleted-sheets" if batch == "none" else "all"
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