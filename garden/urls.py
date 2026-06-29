from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    VegEntryViewSet, PlotViewSet, CellViewSet, PlantViewSet, FeatureViewSet,
    JobViewSet, SeedlingViewSet, PhotoViewSet, WeatherView, CalendarView,
    IndexView, ServiceWorkerView, BackupView, RestoreView,
)


router = DefaultRouter()
router.register(r'veg', VegEntryViewSet, basename='veg')
router.register(r'plots', PlotViewSet, basename='plots')
router.register(r'cells', CellViewSet, basename='cells')
router.register(r'plants', PlantViewSet, basename='plants')
router.register(r'features', FeatureViewSet, basename='features')
router.register(r'jobs', JobViewSet, basename='jobs')
router.register(r'seedlings', SeedlingViewSet, basename='seedlings')
router.register(r'photos', PhotoViewSet, basename='photos')


urlpatterns = [
    path('', IndexView.as_view(), name='index'),
    path('sw.js', ServiceWorkerView.as_view(), name='sw'),
    path('api/', include(router.urls)),
    path('api/weather/', WeatherView.as_view(), name='weather'),
    path('api/calendar.ics', CalendarView.as_view(), name='calendar'),
    path('api/backup/', BackupView.as_view(), name='backup'),
    path('api/backup/restore/', RestoreView.as_view(), name='restore'),
]
