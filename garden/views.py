from datetime import date as date_cls, timedelta
from django.utils.text import slugify
from django.utils import timezone
from django.db import transaction
from django.db.models import F
from django.views.generic import TemplateView

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

import json
import urllib.parse
import urllib.request

from django.http import HttpResponse

from .models import VegEntry, Plot, Cell, HistoryEntry, Plant, Feature, Job, Seedling, Photo
from .serializers import (
    VegEntrySerializer, PlotSerializer, CellSerializer, HistoryEntrySerializer,
    PlantSerializer, FeatureSerializer, JobSerializer, SeedlingSerializer, PhotoSerializer,
)


def veg_display(veg):
    """Full display name including variety, e.g. 'Radish — Green Luobo'."""
    if not veg:
        return ''
    return veg.display_name

MIN_DIM = 1
MAX_DIM = 20

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


SOW_WINDOW_FIELDS = [
    'sow_outdoors_start', 'sow_outdoors_end',
    'sow_covered_start', 'sow_covered_end',
    'sow_indoors_start', 'sow_indoors_end',
    'plant_out_start', 'plant_out_end',
]


def sow_windows_from_backup(v):
    """Resolve the eight per-method sow windows for a restored veg.

    New backups carry the per-method windows directly. Older backups have only
    the legacy sow_where + sow_start/sow_end, which we route into one window."""
    explicit = {f: (v.get(f) or 0) for f in SOW_WINDOW_FIELDS}
    if any(explicit.values()):
        return explicit

    windows = {f: 0 for f in SOW_WINDOW_FIELDS}
    ss, se = v.get('sow_start') or 0, v.get('sow_end') or 0
    if ss and se:
        sw = normalize_sow_where(v.get('sow_where'))
        if sw == 'Sow indoors':
            windows['sow_indoors_start'], windows['sow_indoors_end'] = ss, se
        elif sw == 'Sow outdoors (covered)':
            windows['sow_covered_start'], windows['sow_covered_end'] = ss, se
        elif sw == 'Plant out seedlings':
            windows['plant_out_start'], windows['plant_out_end'] = ss, se
        else:
            windows['sow_outdoors_start'], windows['sow_outdoors_end'] = ss, se
    return windows


def _clamp_dim(value, fallback):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(MIN_DIM, min(MAX_DIM, n))


class IndexView(TemplateView):
    template_name = 'garden/index.html'


class ServiceWorkerView(TemplateView):
    """Served at /sw.js so the service worker gets root scope."""
    template_name = 'garden/sw.js'
    content_type = 'application/javascript'


class VegEntryViewSet(viewsets.ModelViewSet):
    queryset = VegEntry.objects.all()
    serializer_class = VegEntrySerializer
    lookup_field = 'key'
    lookup_value_regex = '[^/]+'

    def perform_create(self, serializer):
        data = serializer.validated_data
        if not data.get('key'):
            base = data.get('name', '')
            if data.get('variety'):
                base = f"{base} {data['variety']}"
            stem = slugify(base)[:80] or 'veg'
            key = stem
            i = 2
            while VegEntry.objects.filter(key=key).exists():
                key = f"{stem[:76]}-{i}"
                i += 1
            data['key'] = key
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


# ---- stats helpers (kept module-level so they're easy to read and unit-test) ----

def _stats_by_square(cells, cols):
    out = []
    for c in cells:
        hist = sorted(c.history.all(), key=lambda h: (h.date, h.created_at))
        crops = []
        for h in hist:
            nm = h.veg_name or h.veg_key
            if nm and nm not in crops:
                crops.append(nm)
        outcomes = c.total_harvested + c.total_failed
        out.append({
            'position': c.position,
            'row': c.position // cols + 1,
            'col': c.position % cols + 1,
            'veg_key': c.veg.key if c.veg else None,
            'veg_name': veg_display(c.veg) or None,
            'date_sown': c.date_sown,
            'seeds_planted': c.seeds_planted,
            'total_harvested': c.total_harvested,
            'total_failed': c.total_failed,
            'total_weight_g': c.total_weight_g,
            'success_rate': (c.total_harvested / outcomes) if outcomes else None,
            'events': len(hist),
            'crops_grown': crops,
            'history': [
                {'date': h.date, 'event_type': h.event_type,
                 'veg_name': h.veg_name, 'count': h.count, 'note': h.note}
                for h in hist
            ],
        })
    out.sort(key=lambda q: q['position'])
    return out


def _stats_by_vegetable(history, cells, pos_by_cell):
    H, F, P = HistoryEntry.HARVESTED, HistoryEntry.FAILED, HistoryEntry.PLANTED
    veg_agg = {}
    veg_squares = {}
    for h in history:
        key = h.veg_key or h.veg_name or '—'
        d = veg_agg.setdefault(key, {
            'veg_key': h.veg_key, 'veg_name': h.veg_name or key,
            'seeds_planted': 0, 'total_harvested': 0, 'total_failed': 0,
            'weight_g': 0,
        })
        if not d['veg_name'] and h.veg_name:
            d['veg_name'] = h.veg_name
        if h.event_type == H:
            d['total_harvested'] += h.count
            d['weight_g'] += h.weight_g
        elif h.event_type == F:
            d['total_failed'] += h.count
        elif h.event_type == P:
            d['seeds_planted'] += h.count
        pos = pos_by_cell.get(h.cell_id)
        if pos is not None:
            veg_squares.setdefault(key, set()).add(pos)

    # actual days to first harvest, per vegetable (best effort)
    days_acc = {}
    for c in cells:
        planted_date = None
        planted_key = None
        for h in sorted(c.history.all(), key=lambda x: (x.date, x.created_at)):
            if h.event_type == P:
                planted_date = h.date
                planted_key = h.veg_key or h.veg_name
            elif h.event_type == H and planted_date:
                diff = (h.date - planted_date).days
                if diff >= 0:
                    k = planted_key or (h.veg_key or h.veg_name) or '—'
                    a = days_acc.setdefault(k, [0, 0])
                    a[0] += diff
                    a[1] += 1
                planted_date = None  # only first harvest counts toward days-to-harvest

    out = []
    for key, d in veg_agg.items():
        oc = d['total_harvested'] + d['total_failed']
        a = days_acc.get(key)
        out.append({
            **d,
            'success_rate': (d['total_harvested'] / oc) if oc else None,
            'squares_used': len(veg_squares.get(key, ())),
            'avg_days_to_harvest': round(a[0] / a[1]) if a and a[1] else None,
        })
    out.sort(key=lambda x: (-x['total_harvested'], -x['total_failed'], x['veg_name']))
    return out


def _stats_matrix(history, pos_by_cell):
    H, F = HistoryEntry.HARVESTED, HistoryEntry.FAILED
    matrix = {}
    for h in history:
        pos = pos_by_cell.get(h.cell_id)
        if pos is None or h.event_type not in (H, F):
            continue
        key = (h.veg_key or h.veg_name or '—', pos)
        m = matrix.setdefault(key, {
            'veg_key': h.veg_key, 'veg_name': h.veg_name or key[0],
            'position': pos, 'harvested': 0, 'failed': 0, 'weight_g': 0,
        })
        if h.event_type == H:
            m['harvested'] += h.count
            m['weight_g'] += h.weight_g
        else:
            m['failed'] += h.count
    return sorted(matrix.values(), key=lambda x: (-x['harvested'], x['position']))


def _stats_monthly(history):
    H, F, P = HistoryEntry.HARVESTED, HistoryEntry.FAILED, HistoryEntry.PLANTED
    monthly = {}
    for h in history:
        ym = h.date.strftime('%Y-%m')
        b = monthly.setdefault(ym, {'month': ym, 'harvested': 0, 'failed': 0, 'planted': 0})
        if h.event_type == H:
            b['harvested'] += h.count
        elif h.event_type == F:
            b['failed'] += h.count
        elif h.event_type == P:
            b['planted'] += h.count
    return sorted(monthly.values(), key=lambda x: x['month'])


def _stats_totals(cells, distinct_crops):
    total_h = sum(c.total_harvested for c in cells)
    total_f = sum(c.total_failed for c in cells)
    total_w = sum(c.total_weight_g for c in cells)
    oc = total_h + total_f
    return {
        'seeds_planted': sum(c.seeds_planted for c in cells),
        'total_harvested': total_h,
        'total_failed': total_f,
        'total_weight_g': total_w,
        'success_rate': (total_h / oc) if oc else None,
        'cells_used': sum(1 for c in cells if c.veg_id or c.date_sown or c.seeds_planted),
        'distinct_crops': distinct_crops,
    }


class PlotViewSet(viewsets.ModelViewSet):
    queryset = (
        Plot.objects.all()
        .prefetch_related('cells__veg', 'cells__plant', 'cells__history')
    )
    serializer_class = PlotSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        name = (data.get('name') or '').strip() or 'New bed'
        kind = Plot.PLANT if data.get('kind') == Plot.PLANT else Plot.VEG
        rows = _clamp_dim(data.get('rows'), 4)
        cols = _clamp_dim(data.get('cols'), 4)
        with transaction.atomic():
            plot = Plot.objects.create(name=name[:100], kind=kind, rows=rows, cols=cols)
            Cell.objects.bulk_create(
                [Cell(plot=plot, position=i) for i in range(rows * cols)]
            )
        plot = self.get_queryset().get(pk=plot.pk)
        return Response(self.get_serializer(plot).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        plot = self.get_object()
        data = request.data

        if 'name' in data:
            name = (data.get('name') or '').strip()
            if name:
                plot.name = name[:100]

        if 'notes' in data:
            plot.notes = (data.get('notes') or '')

        new_rows = _clamp_dim(data['rows'], plot.rows) if 'rows' in data else plot.rows
        new_cols = _clamp_dim(data['cols'], plot.cols) if 'cols' in data else plot.cols
        old_size = plot.rows * plot.cols
        new_size = new_rows * new_cols

        with transaction.atomic():
            if 'kind' in data:
                new_kind = Plot.PLANT if data.get('kind') == Plot.PLANT else Plot.VEG
                if new_kind != plot.kind:
                    # Switching type empties the bed's plantings for a clean change.
                    plant_ids = [c.plant_id for c in plot.cells.all() if c.plant_id]
                    Plant.objects.filter(id__in=plant_ids).delete()
                    plot.history.all().delete()
                    plot.cells.update(
                        veg=None, date_sown=None, seeds_planted=0,
                        total_harvested=0, total_failed=0, total_weight_g=0,
                    )
                    plot.kind = new_kind

            if new_size < old_size:
                doomed = list(plot.cells.filter(position__gte=new_size))
                occupied = [
                    c for c in doomed
                    if c.veg_id or c.date_sown or c.seeds_planted or c.plant_id
                ]
                if occupied:
                    return Response({
                        'error': 'Cannot shrink: clear the planted squares outside '
                                 'the new size first.',
                        'occupied_positions': sorted(c.position for c in occupied),
                    }, status=400)
                # Empty cells only; their plot-level history survives (cell set NULL).
                plot.cells.filter(position__gte=new_size).delete()

            plot.rows = new_rows
            plot.cols = new_cols
            plot.save()

            if new_size > old_size:
                existing = set(plot.cells.values_list('position', flat=True))
                Cell.objects.bulk_create(
                    [Cell(plot=plot, position=i)
                     for i in range(new_size) if i not in existing]
                )

        plot = self.get_queryset().get(pk=plot.pk)
        return Response(self.get_serializer(plot).data)

    @action(detail=True, methods=['post'])
    def reset(self, request, pk=None):
        """Clear every square in this bed and wipe its totals + history + plants."""
        plot = self.get_object()
        with transaction.atomic():
            plot.history.all().delete()
            plant_ids = [c.plant_id for c in plot.cells.all() if c.plant_id]
            Plant.objects.filter(id__in=plant_ids).delete()
            plot.cells.update(
                veg=None, date_sown=None, seeds_planted=0,
                total_harvested=0, total_failed=0, total_weight_g=0,
            )
        plot = self.get_queryset().get(pk=plot.pk)
        return Response(self.get_serializer(plot).data)

    @action(detail=True, methods=['post'])
    def fill(self, request, pk=None):
        """Plant a vegetable into every EMPTY square of this veg bed."""
        plot = self.get_object()
        if plot.kind == Plot.PLANT:
            return Response({'error': 'Fill is for vegetable beds only.'}, status=400)
        veg = VegEntry.objects.filter(key=request.data.get('veg_key')).first()
        if not veg:
            return Response({'error': 'Unknown vegetable.'}, status=400)
        raw = request.data.get('date_sown')
        try:
            ds = date_cls.fromisoformat(str(raw)) if raw else date_cls.today()
        except (TypeError, ValueError):
            ds = date_cls.today()
        try:
            seeds = max(1, int(request.data.get('seeds_planted', 1)))
        except (TypeError, ValueError):
            seeds = 1
        filled = 0
        with transaction.atomic():
            for cell in plot.cells.all():
                if cell.veg_id or cell.date_sown or cell.seeds_planted:
                    continue  # leave occupied squares untouched
                cell.veg = veg
                cell.date_sown = ds
                cell.seeds_planted = seeds
                cell.save()
                HistoryEntry.objects.create(
                    plot=plot, cell=cell, event_type=HistoryEntry.PLANTED,
                    date=ds, veg_name=veg_display(veg), veg_key=veg.key, count=seeds)
                filled += 1
        plot = self.get_queryset().get(pk=plot.pk)
        return Response({'filled': filled, 'plot': self.get_serializer(plot).data})

    @action(detail=False, methods=['post'])
    def save_layout(self, request):
        """Save bed positions for the garden Designer. Updates ONLY layout_x/layout_y
        (uses .update(), so the bed's contents and updated_at are untouched)."""
        saved = 0
        for item in (request.data.get('layouts') or []):
            try:
                pid = int(item.get('id'))
                x = max(0, int(item.get('x')))
                y = max(0, int(item.get('y')))
            except (TypeError, ValueError):
                continue
            saved += Plot.objects.filter(id=pid).update(layout_x=x, layout_y=y)
        return Response({'saved': saved})

    @action(detail=True, methods=['post'])
    def add_compost(self, request, pk=None):
        """Record that compost was added to this bed (defaults to today)."""
        plot = self.get_object()
        raw = request.data.get('date')
        if raw:
            try:
                when = date_cls.fromisoformat(str(raw))
            except (TypeError, ValueError):
                return Response({'error': 'Invalid date (use YYYY-MM-DD)'}, status=400)
        else:
            when = date_cls.today()
        # Keep the most recent date if an older one is submitted.
        if plot.last_composted is None or when > plot.last_composted:
            plot.last_composted = when
            plot.save()
        return Response(self.get_serializer(self.get_queryset().get(pk=plot.pk)).data)

    @action(detail=True, methods=['get'])
    def stats(self, request, pk=None):
        """Rich analytics payload powering the Data dashboard: per-square detail,
        per-vegetable performance, a plant×square matrix and a monthly timeline."""
        plot = self.get_object()
        cells = list(plot.cells.all())
        history = list(plot.history.all())
        cols = plot.cols or 1
        pos_by_cell = {c.id: c.position for c in cells}

        by_square = _stats_by_square(cells, cols)
        by_vegetable = _stats_by_vegetable(history, cells, pos_by_cell)
        plant_square_matrix = _stats_matrix(history, pos_by_cell)
        monthly = _stats_monthly(history)
        totals = _stats_totals(cells, len(by_vegetable))

        return Response({
            'plot': {'id': plot.id, 'name': plot.name,
                     'rows': plot.rows, 'cols': plot.cols,
                     'last_composted': plot.last_composted, 'notes': plot.notes},
            'totals': totals,
            'by_square': by_square,
            'by_vegetable': by_vegetable,
            'plant_square_matrix': plant_square_matrix,
            'monthly': monthly,
        })


class CellViewSet(viewsets.ModelViewSet):
    queryset = Cell.objects.all().select_related('veg', 'plot').prefetch_related('history')
    serializer_class = CellSerializer

    def update(self, request, *args, **kwargs):
        cell = self.get_object()

        veg_key = request.data.get('veg_key', None)
        # Accept the new 'date_sown' key; fall back to the legacy 'date_sewed'.
        has_date = ('date_sown' in request.data) or ('date_sewed' in request.data)
        date_sown = request.data.get('date_sown', request.data.get('date_sewed', None))
        seeds_planted = request.data.get('seeds_planted', None)

        old_veg_key = cell.veg.key if cell.veg else None
        old_date = cell.date_sown
        old_seeds = cell.seeds_planted

        if 'veg_key' in request.data:
            if veg_key:
                try:
                    cell.veg = VegEntry.objects.get(key=veg_key)
                except VegEntry.DoesNotExist:
                    return Response({'error': f'Unknown veg key: {veg_key}'}, status=400)
            else:
                cell.veg = None

        if has_date:
            cell.date_sown = date_sown if date_sown else None
        if 'seeds_planted' in request.data:
            try:
                cell.seeds_planted = int(seeds_planted or 0)
            except (TypeError, ValueError):
                cell.seeds_planted = 0

        # Planting a vegetable requires a sown date and a positive seed count.
        if veg_key:
            if not cell.date_sown:
                return Response({'error': 'A sown date is required when planting a vegetable.'}, status=400)
            if not cell.seeds_planted or cell.seeds_planted <= 0:
                return Response({'error': 'Seeds planted must be at least 1.'}, status=400)

        cell.save()

        # Log/refresh the "planted" activity when there's a planting.
        is_planting = (
            cell.veg
            and cell.date_sown
            and (
                (cell.veg.key != old_veg_key)
                or (cell.date_sown != old_date)
                or (cell.seeds_planted != old_seeds)
            )
        )
        if is_planting:
            # Same crop with only the date/seeds tweaked → update the existing
            # planted activity rather than logging a brand-new one. A changed
            # vegetable is treated as a fresh planting.
            same_crop = (old_veg_key is not None and cell.veg.key == old_veg_key)
            existing = (cell.history.filter(event_type=HistoryEntry.PLANTED)
                        .order_by('-date', '-created_at').first()) if same_crop else None
            if existing:
                existing.date = cell.date_sown or date_cls.today()
                existing.count = cell.seeds_planted
                existing.veg_name = veg_display(cell.veg)
                existing.veg_key = cell.veg.key
                existing.save()
            else:
                HistoryEntry.objects.create(
                    plot=cell.plot,
                    cell=cell,
                    event_type=HistoryEntry.PLANTED,
                    date=cell.date_sown or date_cls.today(),
                    veg_name=veg_display(cell.veg),
                    veg_key=cell.veg.key if cell.veg else '',
                    count=cell.seeds_planted,
                )

        cell.refresh_from_db()
        return Response(self.get_serializer(cell).data)

    def _record(self, request, cell, event_type, total_field):
        try:
            count = int(request.data.get('count', 1))
        except (TypeError, ValueError):
            return Response({'error': 'Invalid count'}, status=400)
        if count <= 0:
            return Response({'error': 'Count must be positive'}, status=400)
        note = (request.data.get('note') or '').strip()
        try:
            weight = int(request.data.get('weight', 0) or 0)
        except (TypeError, ValueError):
            weight = 0
        weight = max(0, weight)
        # Atomic increments to avoid lost updates under concurrent requests.
        setattr(cell, total_field, F(total_field) + count)
        if weight:
            cell.total_weight_g = F('total_weight_g') + weight
        cell.save()
        cell.refresh_from_db()  # resolve F() back to integers for the response
        HistoryEntry.objects.create(
            plot=cell.plot,
            cell=cell,
            event_type=event_type,
            date=date_cls.today(),
            veg_name=veg_display(cell.veg),
            veg_key=cell.veg.key if cell.veg else '',
            count=count,
            weight_g=weight,
            note=note,
        )
        return Response(self.get_serializer(cell).data)

    @action(detail=True, methods=['post'])
    def record_harvest(self, request, pk=None):
        return self._record(request, self.get_object(),
                            HistoryEntry.HARVESTED, 'total_harvested')

    @action(detail=True, methods=['post'])
    def record_failure(self, request, pk=None):
        return self._record(request, self.get_object(),
                            HistoryEntry.FAILED, 'total_failed')

    @action(detail=True, methods=['post'])
    def clear_plot(self, request, pk=None):
        cell = self.get_object()
        if cell.veg or cell.date_sown or cell.seeds_planted:
            HistoryEntry.objects.create(
                plot=cell.plot,
                cell=cell,
                event_type=HistoryEntry.CLEARED,
                date=date_cls.today(),
                veg_name=veg_display(cell.veg),
                veg_key=cell.veg.key if cell.veg else '',
                count=0,
            )
        cell.veg = None
        cell.date_sown = None
        cell.seeds_planted = 0
        cell.save()
        return Response(self.get_serializer(cell).data)

    @action(detail=True, methods=['post'])
    def reset_totals(self, request, pk=None):
        cell = self.get_object()
        cell.total_harvested = 0
        cell.total_failed = 0
        cell.total_weight_g = 0
        cell.save()
        cell.history.all().delete()
        return Response(self.get_serializer(cell).data)

    @action(detail=True, methods=['post'])
    def set_plant(self, request, pk=None):
        """Create or update the ornamental Plant occupying this square."""
        cell = self.get_object()
        data = request.data
        name = (data.get('name') or '').strip()
        if not name:
            return Response({'error': 'Plant name is required'}, status=400)
        raw_date = data.get('date_planted')
        try:
            planted = date_cls.fromisoformat(str(raw_date)) if raw_date else None
        except (TypeError, ValueError):
            planted = None
        vals = dict(
            name=name[:120],
            latin_name=(data.get('latin_name') or '')[:150],
            date_planted=planted,
            about=(data.get('about') or ''),
            water_level=(data.get('water_level') or '')[:20],
            sun_level=(data.get('sun_level') or '')[:30],
            soil_type=(data.get('soil_type') or '')[:30],
        )
        if cell.plant_id:
            for k, v in vals.items():
                setattr(cell.plant, k, v)
            cell.plant.save()
        else:
            cell.plant = Plant.objects.create(**vals)
            cell.save()
        cell.refresh_from_db()
        return Response(self.get_serializer(cell).data)

    @action(detail=True, methods=['post'])
    def remove_plant(self, request, pk=None):
        """Remove the Plant from this square (deletes the Plant record)."""
        cell = self.get_object()
        if cell.plant_id:
            cell.plant.delete()  # SET_NULL clears cell.plant
            cell.refresh_from_db()
        return Response(self.get_serializer(cell).data)

    @action(detail=True, methods=['post'])
    def place_plant(self, request, pk=None):
        """Place a catalogue Plant into this square. The same plant may be placed
        in any number of squares (the relation is one plant -> many cells)."""
        cell = self.get_object()
        try:
            plant = Plant.objects.get(pk=request.data.get('plant_id'))
        except (Plant.DoesNotExist, TypeError, ValueError):
            return Response({'error': 'Unknown plant'}, status=400)
        cell.plant = plant
        cell.save()
        cell.refresh_from_db()
        return Response(self.get_serializer(cell).data)

    @action(detail=True, methods=['post'])
    def unplace_plant(self, request, pk=None):
        """Remove the plant from this square but keep the record in the catalogue."""
        cell = self.get_object()
        cell.plant = None
        cell.save()
        return Response(self.get_serializer(cell).data)

    @action(detail=True, methods=['post'])
    def log_job(self, request, pk=None):
        """Record a job as done for THIS square only (strict per-square tracking).

        Accepts a job id (preferred) or a raw description."""
        cell = self.get_object()
        desc = ''
        job_id = request.data.get('job')
        if job_id:
            j = Job.objects.filter(pk=job_id).first()
            if j:
                desc = j.description
        desc = (desc or request.data.get('description') or 'Job').strip()
        name = veg_display(cell.veg) if cell.veg_id else (cell.plant.name if cell.plant_id else '')
        HistoryEntry.objects.create(
            plot=cell.plot, cell=cell, event_type=HistoryEntry.JOB,
            date=date_cls.today(), veg_name=name,
            veg_key=cell.veg.key if cell.veg_id else '',
            note=desc, count=0)
        cell.refresh_from_db()
        return Response(self.get_serializer(cell).data)

    @action(detail=True, methods=['post'])
    def plant_from_seedling(self, request, pk=None):
        """Transplant `count` seedlings from a greenhouse batch into this square,
        carrying the veg/variety and sow date, and reduce the batch's amount."""
        cell = self.get_object()
        try:
            seedling = Seedling.objects.get(pk=request.data.get('seedling_id'))
        except (Seedling.DoesNotExist, TypeError, ValueError):
            return Response({'error': 'Unknown seedling batch'}, status=400)
        if not seedling.veg_id:
            return Response({'error': 'That seedling batch has no vegetable'}, status=400)
        try:
            count = int(request.data.get('count', 1))
        except (TypeError, ValueError):
            return Response({'error': 'Invalid count'}, status=400)
        if count <= 0:
            return Response({'error': 'Count must be positive'}, status=400)
        if count > seedling.amount:
            return Response({'error': f'Only {seedling.amount} seedling(s) available'}, status=400)
        cell.veg = seedling.veg
        cell.date_sown = seedling.date_sown
        cell.seeds_planted = count
        cell.save()
        Seedling.objects.filter(pk=seedling.pk).update(amount=F('amount') - count)
        HistoryEntry.objects.create(
            plot=cell.plot, cell=cell, event_type=HistoryEntry.PLANTED,
            date=cell.date_sown or date_cls.today(),
            veg_name=veg_display(cell.veg), veg_key=cell.veg.key,
            count=count, note='Transplanted from greenhouse')
        cell.refresh_from_db()
        return Response(self.get_serializer(cell).data)


class PlantViewSet(viewsets.ModelViewSet):
    """Catalog of plants — managed from the Settings → Plants tab. Plants may be
    placed in a plant bed (referenced by a Cell) or kept standalone."""
    queryset = Plant.objects.all()
    serializer_class = PlantSerializer


class FeatureViewSet(viewsets.ModelViewSet):
    """Non-bed Designer elements (paths, sheds, lawn, etc.)."""
    queryset = Feature.objects.all()
    serializer_class = FeatureSerializer


class JobViewSet(viewsets.ModelViewSet):
    """Seasonal tasks attached to a vegetable (variety) or a plant.

    Filterable with ?veg=<key> or ?plant=<id> for an item's job list."""
    queryset = Job.objects.all()
    serializer_class = JobSerializer

    def get_queryset(self):
        qs = Job.objects.all()
        veg = self.request.query_params.get('veg')
        plant = self.request.query_params.get('plant')
        if veg:
            qs = qs.filter(veg__key=veg)
        if plant:
            qs = qs.filter(plant_id=plant)
        return qs

class SeedlingViewSet(viewsets.ModelViewSet):
    """Greenhouse seedling batches (seeds sown indoors before going outside)."""
    queryset = Seedling.objects.all().select_related('veg')
    serializer_class = SeedlingSerializer


class PhotoViewSet(viewsets.ModelViewSet):
    """Progress photos attached to a square. Filter with ?cell=<id>."""
    queryset = Photo.objects.all()
    serializer_class = PhotoSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = Photo.objects.all().select_related('cell')
        cell = self.request.query_params.get('cell')
        return qs.filter(cell_id=cell) if cell else qs


class WeatherView(APIView):
    """Proxy a 7-day forecast from Open-Meteo (free, no API key) for a lat/lon."""

    def get(self, request):
        try:
            lat = float(request.query_params.get('lat'))
            lon = float(request.query_params.get('lon'))
        except (TypeError, ValueError):
            return Response({'error': 'lat and lon query params are required'}, status=400)
        params = urllib.parse.urlencode({
            'latitude': lat, 'longitude': lon,
            'daily': 'temperature_2m_min,temperature_2m_max,precipitation_sum,weathercode',
            'forecast_days': 7, 'timezone': 'auto',
        })
        url = 'https://api.open-meteo.com/v1/forecast?' + params
        try:
            with urllib.request.urlopen(url, timeout=8) as r:
                data = json.loads(r.read().decode())
        except Exception as e:  # network/parse errors -> graceful failure
            return Response({'error': f'Weather lookup failed: {e}'}, status=502)
        daily = data.get('daily', {})
        dates = daily.get('time', [])

        def col(name):
            return daily.get(name, [None] * len(dates))
        mins, maxs, precs, codes = col('temperature_2m_min'), col('temperature_2m_max'), \
            col('precipitation_sum'), col('weathercode')
        days = [{'date': dates[i], 'min': mins[i], 'max': maxs[i],
                 'precip': precs[i], 'code': codes[i]} for i in range(len(dates))]
        frost = [d for d in days if d['min'] is not None and d['min'] <= 1.5]
        return Response({'days': days, 'frost_days': frost,
                         'units': data.get('daily_units', {})})


class CalendarView(APIView):
    """An .ics feed of upcoming garden events: expected harvests + jobs."""

    def get(self, request):
        today = date_cls.today()
        lines = ['BEGIN:VCALENDAR', 'VERSION:2.0',
                 'PRODID:-//Square Foot Garden//EN', 'CALSCALE:GREGORIAN']

        def ev(uid, when, summary):
            lines.extend(['BEGIN:VEVENT', f'UID:{uid}@sfg',
                          f'DTSTART;VALUE=DATE:{when.strftime("%Y%m%d")}',
                          'SUMMARY:' + summary.replace('\n', ' '), 'END:VEVENT'])

        for cell in Cell.objects.select_related('veg', 'plot').filter(veg__isnull=False):
            if cell.date_sown and cell.veg and cell.veg.days_to_harvest:
                hd = cell.date_sown + timedelta(days=cell.veg.days_to_harvest)
                if hd >= today:
                    ev(f'harv-{cell.id}', hd, f'Harvest {veg_display(cell.veg)} ({cell.plot.name})')
        planted = set(Cell.objects.filter(veg__isnull=False).values_list('veg__key', flat=True))
        for job in Job.objects.select_related('veg').filter(veg__key__in=planted):
            if not job.month:
                continue
            yr = today.year if job.month >= today.month else today.year + 1
            ev(f'job-{job.id}', date_cls(yr, job.month, 1),
               f'{veg_display(job.veg)}: {job.description}')
        lines.append('END:VCALENDAR')
        resp = HttpResponse('\r\n'.join(lines), content_type='text/calendar')
        resp['Content-Disposition'] = 'attachment; filename="garden.ics"'
        return resp


class BackupView(APIView):
    def get(self, request):
        plots = Plot.objects.all().prefetch_related('cells__veg', 'cells__plant', 'cells__history')
        veg = VegEntry.objects.all()
        return Response({
            'exported_at': timezone.now().isoformat(),
            'plots': PlotSerializer(plots, many=True, context={'request': request}).data,
            'veg_db': VegEntrySerializer(veg, many=True, context={'request': request}).data,
            'features': FeatureSerializer(Feature.objects.all(), many=True).data,
            # Plants not currently placed in a bed (placed ones travel with their cell).
            'unplaced_plants': PlantSerializer(
                Plant.objects.exclude(id__in=Cell.objects.filter(plant__isnull=False)
                                      .values_list('plant_id', flat=True)),
                many=True).data,
            'seedlings': SeedlingSerializer(Seedling.objects.all(), many=True).data,
        })


class RestoreView(APIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @transaction.atomic
    def post(self, request):
        data = request.data
        if 'plots' not in data or 'veg_db' not in data:
            return Response({'error': 'Backup must contain plots and veg_db'}, status=400)

        # Replace veg_db
        Job.objects.all().delete()
        Seedling.objects.all().delete()
        VegEntry.objects.all().delete()
        for v in data['veg_db']:
            veg = VegEntry.objects.create(
                key=v.get('key') or slugify(v.get('name', ''))[:80],
                name=v.get('name', ''),
                variety=v.get('variety', '') or '',
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
                **sow_windows_from_backup(v),
            )
            self._restore_jobs(v.get('jobs'), veg=veg)

        # Replace plots
        HistoryEntry.objects.all().delete()
        Plant.objects.all().delete()
        Cell.objects.all().delete()
        Plot.objects.all().delete()

        legacy_plot = None
        for p in data['plots']:
            if 'cells' in p or 'rows' in p:
                # New format: a named, sized bed with nested cells.
                lc = p.get('last_composted')
                try:
                    lc = date_cls.fromisoformat(str(lc)) if lc else None
                except (TypeError, ValueError):
                    lc = None
                plot = Plot.objects.create(
                    name=p.get('name') or 'Plot',
                    kind=Plot.PLANT if p.get('kind') == Plot.PLANT else Plot.VEG,
                    rows=_clamp_dim(p.get('rows'), 4),
                    cols=_clamp_dim(p.get('cols'), 4),
                    last_composted=lc,
                    notes=p.get('notes', '') or '',
                )
                for c in p.get('cells', []):
                    self._restore_cell(plot, c.get('position', 0), c)
            else:
                # Legacy format: flat squares (index 0-15) → one default 4x4 bed.
                if legacy_plot is None:
                    legacy_plot = Plot.objects.create(name='Main Bed', rows=4, cols=4)
                self._restore_cell(legacy_plot, p.get('index', 0), p)

        # Recreate standalone (unplaced) plants from the catalog.
        for pl in data.get('unplaced_plants', []):
            if not pl.get('name'):
                continue
            try:
                dp = date_cls.fromisoformat(str(pl.get('date_planted'))) if pl.get('date_planted') else None
            except (TypeError, ValueError):
                dp = None
            plant = Plant.objects.create(
                name=pl.get('name', '')[:120],
                latin_name=(pl.get('latin_name', '') or '')[:150],
                date_planted=dp,
                about=pl.get('about', '') or '',
                water_level=(pl.get('water_level', '') or '')[:20],
                sun_level=(pl.get('sun_level', '') or '')[:30],
                soil_type=(pl.get('soil_type', '') or '')[:30],
            )
            self._restore_jobs(pl.get('jobs'), plant=plant)

        # Replace Designer features (optional in older backups).
        Feature.objects.all().delete()
        for f in data.get('features', []):
            Feature.objects.create(
                kind=(f.get('kind') or 'other')[:20],
                label=(f.get('label') or '')[:60],
                x=max(0, int(f.get('x') or 0)),
                y=max(0, int(f.get('y') or 0)),
                w=max(1, int(f.get('w') or 2)),
                h=max(1, int(f.get('h') or 2)),
            )

        # Greenhouse seedling batches (optional in older backups).
        for sd in data.get('seedlings', []):
            veg_obj = VegEntry.objects.filter(key=sd.get('veg_key') or sd.get('veg')).first()
            if not veg_obj:
                continue
            try:
                ds = date_cls.fromisoformat(str(sd.get('date_sown'))) if sd.get('date_sown') else None
            except (TypeError, ValueError):
                ds = None
            Seedling.objects.create(
                veg=veg_obj, date_sown=ds,
                amount=sd.get('amount') or 0,
                sprouted=sd.get('sprouted') or 0,
                failed=sd.get('failed') or 0,
                notes=sd.get('notes', '') or '',
            )

        return Response({'restored': True})

    def _restore_cell(self, plot, position, src):
        veg_key = src.get('veg_key')
        veg_obj = VegEntry.objects.filter(key=veg_key).first() if veg_key else None
        cell = Cell.objects.create(
            plot=plot,
            position=position,
            veg=veg_obj,
            date_sown=src.get('date_sown') or src.get('date_sewed') or None,
            seeds_planted=src.get('seeds_planted') or 0,
            total_harvested=src.get('total_harvested') or 0,
            total_failed=src.get('total_failed') or 0,
            total_weight_g=src.get('total_weight_g') or 0,
        )
        pl = src.get('plant')
        if pl and pl.get('name'):
            try:
                dp = date_cls.fromisoformat(str(pl.get('date_planted'))) if pl.get('date_planted') else None
            except (TypeError, ValueError):
                dp = None
            cell.plant = Plant.objects.create(
                name=pl.get('name', '')[:120],
                latin_name=(pl.get('latin_name', '') or '')[:150],
                date_planted=dp,
                about=pl.get('about', '') or '',
                water_level=(pl.get('water_level', '') or '')[:20],
                sun_level=(pl.get('sun_level', '') or '')[:30],
                soil_type=(pl.get('soil_type', '') or '')[:30],
            )
            cell.save()
            self._restore_jobs(pl.get('jobs'), plant=cell.plant)
        for h in src.get('history', []):
            HistoryEntry.objects.create(
                plot=plot,
                cell=cell,
                event_type=h.get('event_type', HistoryEntry.PLANTED),
                date=h.get('date') or date_cls.today(),
                veg_name=h.get('veg_name', ''),
                veg_key=h.get('veg_key', '') or '',
                count=h.get('count', 0),
                weight_g=h.get('weight_g', 0) or 0,
                note=h.get('note', '') or '',
            )

    def _restore_jobs(self, jobs, veg=None, plant=None):
        for j in (jobs or []):
            try:
                month = int(j.get('month') or 0)
            except (TypeError, ValueError):
                month = 0
            Job.objects.create(
                veg=veg, plant=plant,
                month=max(0, min(12, month)),
                description=j.get('description', '') or '',
            )
