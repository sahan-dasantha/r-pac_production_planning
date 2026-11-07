from datetime import date
from django.db import transaction
from django.http import HttpResponse
from rest_framework.parsers import MultiPartParser
from rest_framework.views import APIView
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .excel import (
    ExcelReadError, build_jobs_workbook, normalize_name, parse_reference_names,
)
from .models import Reference, ReferenceHistory, Job,  ReferenceUpload, UploadedReference, MACHINES
from .serializers import ReferenceSerializer, ReferenceHistorySerializer, JobSerializer

TRACKED = ["ups", "colours", "sides", "default_machine"]


class ReferenceViewSet(viewsets.ModelViewSet):
    queryset = Reference.objects.all()
    serializer_class = ReferenceSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["name"]
    # No DELETE: references will be linked to orders later
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def perform_create(self, serializer):
        ref = serializer.save(updated_by=self.request.user)
        ReferenceHistory.objects.create(
            reference=ref, changes={"created": True}, changed_by=self.request.user
        )

    def perform_update(self, serializer):
        old = {f: getattr(serializer.instance, f) for f in TRACKED}
        ref = serializer.save(updated_by=self.request.user)
        changes = {
            f: [old[f], getattr(ref, f)]
            for f in TRACKED if old[f] != getattr(ref, f)
        }
        if changes:
            ReferenceHistory.objects.create(
                reference=ref, changes=changes, changed_by=self.request.user
            )

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        qs = self.get_object().history.all()[:50]
        return Response(ReferenceHistorySerializer(qs, many=True).data)

    @action(detail=False, methods=["get"])
    def machines(self, request):
        return Response(MACHINES)

class JobViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Job.objects.select_related("created_by")
    serializer_class = JobSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=["get"])
    def export(self, request):
        """GET /api/jobs/export/ -> downloads ALL jobs as an Excel file."""
        # get_queryset() skips pagination, so every job is included.
        content = build_jobs_workbook(self.get_queryset())

        response = HttpResponse(
            content,
            content_type=(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
        )
        # "attachment" tells the browser to download instead of displaying.
        response["Content-Disposition"] = (
            f'attachment; filename="job-plans-{date.today():%Y-%m-%d}.xlsx"'
        )
        return response

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # reject files over 5 MB


def dropdown_payload(upload):
    """
    Build what the Home dropdown needs: every uploaded name, plus its values
    from the Main sheet (Reference table) when the name exists there.
    """
    if upload is None:
        return {"upload": None, "references": []}

    # One query: Main-sheet references keyed by their normalised name.
    lookup = {normalize_name(r.name): r for r in Reference.objects.all()}

    items = []
    for item in upload.items.all():                  # already in sheet order
        ref = lookup.get(normalize_name(item.name))  # None if not in Main sheet
        items.append({
            "name": item.name,
            "in_main_sheet": ref is not None,
            "reference_id": ref.id if ref else None,
            "ups": ref.ups if ref else None,
            "colours": ref.colours if ref else None,
            "sides": ref.sides if ref else None,
            "default_machine": ref.default_machine if ref else None,
        })

    matched = sum(1 for i in items if i["in_main_sheet"])
    return {
        "upload": {
            "id": upload.id,
            "filename": upload.filename,
            "uploaded_at": upload.uploaded_at.isoformat(),
            "uploaded_by": upload.uploaded_by.username if upload.uploaded_by else None,
            "total": len(items),
            "matched": matched,
            "missing": len(items) - matched,
        },
        "references": items,
    }


class ReferenceUploadView(APIView):
    """
    GET  /api/reference-upload/  -> the CURRENT dropdown list (newest upload)
    POST /api/reference-upload/  -> upload a new sheet (form field: "file")
    """
    parser_classes = [MultiPartParser]  # needed to receive file uploads

    def get(self, request):
        upload = ReferenceUpload.objects.select_related("uploaded_by").first()
        return Response(dropdown_payload(upload))

    def post(self, request):
        file = request.FILES.get("file")

        # --- basic checks on the file itself ---
        if file is None:
            return Response({"detail": "No file was uploaded."},
                            status=status.HTTP_400_BAD_REQUEST)
        if not file.name.lower().endswith(".xlsx"):
            return Response({"detail": "Only .xlsx files are supported."},
                            status=status.HTTP_400_BAD_REQUEST)
        if file.size > MAX_UPLOAD_BYTES:
            return Response({"detail": "File is too large (maximum 5 MB)."},
                            status=status.HTTP_400_BAD_REQUEST)

        # --- read the names; show the user a clear message if it fails ---
        try:
            names = parse_reference_names(file)
        except ExcelReadError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # --- save: all or nothing ---
        with transaction.atomic():
            upload = ReferenceUpload.objects.create(
                filename=file.name, uploaded_by=request.user
            )
            UploadedReference.objects.bulk_create([
                UploadedReference(upload=upload, name=name, position=i)
                for i, name in enumerate(names)
            ])

        return Response(dropdown_payload(upload), status=status.HTTP_201_CREATED)    
# Create your views here.
