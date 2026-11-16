from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    BatchViewSet, ChangePasswordView, JobViewSet, MeView,
    ReferenceViewSet, SalesOrderViewSet,
)

router = DefaultRouter()
router.register("references", ReferenceViewSet)
router.register("batches", BatchViewSet, basename="batch")
router.register("orders", SalesOrderViewSet, basename="order")
router.register("jobs", JobViewSet, basename="job")

urlpatterns = router.urls + [
    path("me/", MeView.as_view()),
    path("me/change-password/", ChangePasswordView.as_view()),
]