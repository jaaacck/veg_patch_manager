from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    VegEntryViewSet, PlotViewSet, CellViewSet, IndexView, BackupView, RestoreView,
)


router = DefaultRouter()
router.register(r'veg', VegEntryViewSet, basename='veg')
router.register(r'plots', PlotViewSet, basename='plots')
router.register(r'cells', CellViewSet, basename='cells')


urlpatterns = [
    path('', IndexView.as_view(), name='index'),
    path('api/', include(router.urls)),
    path('api/backup/', BackupView.as_view(), name='backup'),
    path('api/backup/restore/', RestoreView.as_view(), name='restore'),
]
