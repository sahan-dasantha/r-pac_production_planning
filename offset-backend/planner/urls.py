from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import JobViewSet, ReferenceUploadView, ReferenceViewSet

router = DefaultRouter()
router.register("references", ReferenceViewSet)
router.register("jobs", JobViewSet)

urlpatterns = router.urls + [
    path("reference-upload/", ReferenceUploadView.as_view()),
]