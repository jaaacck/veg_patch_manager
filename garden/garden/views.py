from datetime import date as date_cls
from django.utils.text import slugify
from django.utils import timezone
from django.db import transaction
from django.views.generic import TemplateView
from django.shortcuts import get_object_or_404

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from .models import VegEntry, Plot, HistoryEntry
from .serializers import VegEntrySerializer, PlotSerializer, HistoryEntrySerializer


# Sow categories used by the UI / sow chart.
SOW_WHERE_CHOICES = {
    'Sow indoors',
    'Sow outdoors',
    'Sow outdoors (covered)',
    'Plant out seedlings',
}

# Legacy "where to sow" value -> new sow category (for restoring old backups).
LEGACY_SOW_WHERE_MAP = {
    'Indoors': 'Sow indoors',
    'Indoors/Outdoors': 'Sow indoors',
    'Outdoors': 'Sow outdoors',
    'In ground': 'Sow outdoors',
    'Under cover': 'Sow outdoors (covered)',
}


def normalize_sow_where(value):
    """Map any incoming sow_where to one of the four canonical categories."""
    current = (value or '').strip()
    if current in SOW_WHERE_CHOICES:
        return current
    return LEGACY_SOW_WHERE_MAP.get(current, 'Sow outdoors')


class IndexView(TemplateView):
    template_name = 'garden/index.html'


class VegEntryViewSet(viewsets.ModelViewSet):
    queryset = VegEntry.objects.all()
    serializer_class = VegEntrySerializer
    lookup_field = 'key'
    lookup_value_regex = '[^/]+'

    def perform_create(self, serializer):
        data = serializer.validated_data
        if not data.get('key'):
            data['key'] = slugify(data.get('name', ''))[:80] or 'veg'
        serializer.save(**data)

    @action(detail=True, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def upload_image(self, request, key=None):
        veg = self.get_object()
        img = request.FILES.get('image')
        if not img:
            return Response({'error': 'No image uploaded'}, status=400)
        veg.image = img
        veg.save()
        return Response(self.get_serializer(veg).data)

    @action(detail=True, methods=['post'])
    def remove_image(self, request, key=None):
        veg = self.get_object()
        if veg.image:
            veg.image.delete(save=False)
            veg.image = None
            veg.save()
        return Response(self.get_serializer(veg).data)


class PlotViewSet(viewsets.ModelViewSet):
    queryset = Plot.objects.all().select_related('veg').prefetch_related('history')
    serializer_class = PlotSerializer
    lookup_field = 'index'

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        veg_key = request.data.get('veg_key', None)
        # Accept the new 'date_sown' key; fall back to the legacy 'date_sewed'.
        has_date = ('date_sown' in request.data) or ('date_sewed' in request.data)
        date_sown = request.data.get('date_sown', request.data.get('date_sewed', None))
        seeds_planted = request.data.get('seeds_planted', None)

        old_veg_key = instance.veg.key if instance.veg else None
        old_date = instance.date_sown
        old_seeds = instance.seeds_planted

        if 'veg_key' in request.data:
            if veg_key:
                try:
                    instance.veg = VegEntry.objects.get(key=veg_key)
                except VegEntry.DoesNotExist:
                    return Response({'error': f'Unknown veg key: {veg_key}'}, status=400)
            else:
                instance.veg = None

        if has_date:
            instance.date_sown = date_sown if date_sown else None
        if 'seeds_planted' in request.data:
            try:
                instance.seeds_planted = int(seeds_planted or 0)
            except (TypeError, ValueError):
                instance.seeds_planted = 0
        if 'notes' in request.data:
            instance.notes = request.data.get('notes') or ''

        instance.save()

        # Auto-log a "planted" history entry if a new planting was registered
        is_planting = (
            instance.veg
            and instance.date_sown
            and (
                (instance.veg.key != old_veg_key)
                or (instance.date_sown != old_date)
                or (instance.seeds_planted != old_seeds)
            )
        )
        if is_planting:
            HistoryEntry.objects.create(
                plot=instance,
                event_type=HistoryEntry.PLANTED,
                date=instance.date_sown or date_cls.today(),
                veg_name=instance.veg.name if instance.veg else '',
                count=instance.seeds_planted,
            )

        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=['post'])
    def record_harvest(self, request, index=None):
        plot = self.get_object()
        try:
            count = int(request.data.get('count', 1))
        except (TypeError, ValueError):
            return Response({'error': 'Invalid count'}, status=400)
        if count <= 0:
            return Response({'error': 'Count must be positive'}, status=400)
        plot.total_harvested += count
        plot.save()
        HistoryEntry.objects.create(
            plot=plot,
            event_type=HistoryEntry.HARVESTED,
            date=date_cls.today(),
            veg_name=plot.veg.name if plot.veg else '',
            count=count,
        )
        return Response(self.get_serializer(plot).data)

    @action(detail=True, methods=['post'])
    def record_failure(self, request, index=None):
        plot = self.get_object()
        try:
            count = int(request.data.get('count', 1))
        except (TypeError, ValueError):
            return Response({'error': 'Invalid count'}, status=400)
        if count <= 0:
            return Response({'error': 'Count must be positive'}, status=400)
        plot.total_failed += count
        plot.save()
        HistoryEntry.objects.create(
            plot=plot,
            event_type=HistoryEntry.FAILED,
            date=date_cls.today(),
            veg_name=plot.veg.name if plot.veg else '',
            count=count,
        )
        return Response(self.get_serializer(plot).data)

    @action(detail=True, methods=['post'])
    def clear_plot(self, request, index=None):
        plot = self.get_object()
        if plot.veg or plot.date_sown or plot.seeds_planted:
            HistoryEntry.objects.create(
                plot=plot,
                event_type=HistoryEntry.CLEARED,
                date=date_cls.today(),
                veg_name=plot.veg.name if plot.veg else '',
                count=0,
            )
        plot.veg = None
        plot.date_sown = None
        plot.seeds_planted = 0
        plot.notes = ''
        plot.save()
        return Response(self.get_serializer(plot).data)

    @action(detail=True, methods=['post'])
    def reset_totals(self, request, index=None):
        plot = self.get_object()
        plot.total_harvested = 0
        plot.total_failed = 0
        plot.save()
        plot.history.all().delete()
        return Response(self.get_serializer(plot).data)

    @action(detail=False, methods=['post'])
    def reset_all(self, request):
        with transaction.atomic():
            HistoryEntry.objects.all().delete()
            Plot.objects.update(
                veg=None,
                date_sown=None,
                seeds_planted=0,
                total_harvested=0,
                total_failed=0,
                notes='',
            )
        plots = Plot.objects.all()
        return Response(PlotSerializer(plots, many=True, context={'request': request}).data)


class BackupView(APIView):
    def get(self, request):
        plots = Plot.objects.all().prefetch_related('history').select_related('veg')
        veg = VegEntry.objects.all()
        return Response({
            'exported_at': timezone.now().isoformat(),
            'plots': PlotSerializer(plots, many=True, context={'request': request}).data,
            'veg_db': VegEntrySerializer(veg, many=True, context={'request': request}).data,
        })


class RestoreView(APIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @transaction.atomic
    def post(self, request):
        data = request.data
        if 'plots' not in data or 'veg_db' not in data:
            return Response({'error': 'Backup must contain plots and veg_db'}, status=400)

        # Replace veg_db (preserve images on existing keys if not provided)
        VegEntry.objects.all().delete()
        for v in data['veg_db']:
            VegEntry.objects.create(
                key=v.get('key') or slugify(v.get('name', ''))[:80],
                name=v.get('name', ''),
                latin_name=v.get('latin_name', '') or '',
                emoji=v.get('emoji', '') or '',
                sow_where=normalize_sow_where(v.get('sow_where')),
                sow_start=v.get('sow_start') or 0,
                sow_end=v.get('sow_end') or 0,
                harvest_start=v.get('harvest_start') or 0,
                harvest_end=v.get('harvest_end') or 0,
                per_sq_ft=v.get('per_sq_ft') or 1,
                days_to_harvest=v.get('days_to_harvest') or 60,
                notes=v.get('notes', '') or '',
            )

        # Replace plots
        HistoryEntry.objects.all().delete()
        Plot.objects.all().delete()
        for p in data['plots']:
            veg_key = p.get('veg_key')
            veg_obj = None
            if veg_key:
                veg_obj = VegEntry.objects.filter(key=veg_key).first()
            plot = Plot.objects.create(
                index=p['index'],
                veg=veg_obj,
                date_sown=p.get('date_sown') or p.get('date_sewed') or None,
                seeds_planted=p.get('seeds_planted') or 0,
                total_harvested=p.get('total_harvested') or 0,
                total_failed=p.get('total_failed') or 0,
                notes=p.get('notes', '') or '',
            )
            for h in p.get('history', []):
                HistoryEntry.objects.create(
                    plot=plot,
                    event_type=h.get('event_type', HistoryEntry.PLANTED),
                    date=h.get('date') or date_cls.today(),
                    veg_name=h.get('veg_name', ''),
                    count=h.get('count', 0),
                )

        return Response({'restored': True})
