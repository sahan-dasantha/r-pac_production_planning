from rest_framework.routers import DefaultRouter
from .views import ReferenceViewSet, JobViewSet

router = DefaultRouter()
router.register("references", ReferenceViewSet)
router.register("jobs", JobViewSet)
urlpatterns = router.urls