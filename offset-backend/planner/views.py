from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Reference, ReferenceHistory, Job, MACHINES
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
    mixins.CreateModelMixin,    # POST /api/jobs/       -> save a new job
    mixins.ListModelMixin,      # GET  /api/jobs/       -> list all jobs
    mixins.RetrieveModelMixin,  # GET  /api/jobs/<id>/  -> one job
    viewsets.GenericViewSet,
):
    """
    Deliberately no update or delete: a saved job is a record.
    (If you want to delete mistaken jobs later, we can add it.)
    """
    queryset = Job.objects.select_related("created_by")
    serializer_class = JobSerializer

    def perform_create(self, serializer):
        # Record which logged-in user saved the job.
        serializer.save(created_by=self.request.user)
# Create your views here.
