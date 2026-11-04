from rest_framework.routers import DefaultRouter
from .views import ReferenceViewSet

router = DefaultRouter()
router.register("references", ReferenceViewSet)
urlpatterns = router.urls