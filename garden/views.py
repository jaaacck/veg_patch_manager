from datetime import date as date_cls
from django.utils.text import slugify
from django.utils import timezone
from django.db import transaction
from django.views.generic import TemplateView

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from .models import VegEntry, Plot, Cell, HistoryEntry
from .serializers import (
    VegEntrySerializer, PlotSerializer, CellSerializer, HistoryEntrySerializer,
)

MIN_DIM = 1
MAX_DIM = 20


def _clamp_dim(value, fallback):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(MIN_DIM, min(MAX_DIM, n))


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
            'veg_name': c.veg.name if c.veg else None,
            'date_sewed': c.date_sewed,
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
        'cells_used': sum(1 for c in cells if c.veg_id or c.date_sewed or c.seeds_planted),
        'distinct_crops': distinct_crops,
    }


class PlotViewSet(viewsets.ModelViewSet):
    queryset = (
        Plot.objects.all()
        .prefetch_related('cells__veg', 'cells__history')
    )
    serializer_class = PlotSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        name = (data.get('name') or '').strip() or 'New plot'
        rows = _clamp_dim(data.get('rows'), 4)
        cols = _clamp_dim(data.get('cols'), 4)
        with transaction.atomic():
            plot = Plot.objects.create(name=name[:100], rows=rows, cols=cols)
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
            if new_size < old_size:
                doomed = list(plot.cells.filter(position__gte=new_size))
                occupied = [
                    c for c in doomed
                    if c.veg_id or c.date_sewed or c.seeds_planted
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
        """Clear every square in this plot and wipe its totals + history."""
        plot = self.get_object()
        with transaction.atomic():
            plot.history.all().delete()
            plot.cells.update(
                veg=None, date_sewed=None, seeds_planted=0,
                total_harvested=0, total_failed=0,
            )
        plot = self.get_queryset().get(pk=plot.pk)
        return Response(self.get_serializer(plot).data)

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
        date_sewed = request.data.get('date_sewed', None)
        seeds_planted = request.data.get('seeds_planted', None)

        old_veg_key = cell.veg.key if cell.veg else None
        old_date = cell.date_sewed
        old_seeds = cell.seeds_planted

        if 'veg_key' in request.data:
            if veg_key:
                try:
                    cell.veg = VegEntry.objects.get(key=veg_key)
                except VegEntry.DoesNotExist:
                    return Response({'error': f'Unknown veg key: {veg_key}'}, status=400)
            else:
                cell.veg = None

        if 'date_sewed' in request.data:
            cell.date_sewed = date_sewed if date_sewed else None
        if 'seeds_planted' in request.data:
            try:
                cell.seeds_planted = int(seeds_planted or 0)
            except (TypeError, ValueError):
                cell.seeds_planted = 0

        cell.save()

        # Auto-log a "planted" history entry if a new planting was registered
        is_planting = (
            cell.veg
            and cell.date_sewed
            and (
                (cell.veg.key != old_veg_key)
                or (cell.date_sewed != old_date)
                or (cell.seeds_planted != old_seeds)
            )
        )
        if is_planting:
            HistoryEntry.objects.create(
                plot=cell.plot,
                cell=cell,
                event_type=HistoryEntry.PLANTED,
                date=cell.date_sewed or date_cls.today(),
                veg_name=cell.veg.name if cell.veg else '',
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
        setattr(cell, total_field, getattr(cell, total_field) + count)
        if weight:
            cell.total_weight_g += weight
        cell.save()
        HistoryEntry.objects.create(
            plot=cell.plot,
            cell=cell,
            event_type=event_type,
            date=date_cls.today(),
            veg_name=cell.veg.name if cell.veg else '',
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
        if cell.veg or cell.date_sewed or cell.seeds_planted:
            HistoryEntry.objects.create(
                plot=cell.plot,
                cell=cell,
                event_type=HistoryEntry.CLEARED,
                date=date_cls.today(),
                veg_name=cell.veg.name if cell.veg else '',
                veg_key=cell.veg.key if cell.veg else '',
                count=0,
            )
        cell.veg = None
        cell.date_sewed = None
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


class BackupView(APIView):
    def get(self, request):
        plots = Plot.objects.all().prefetch_related('cells__veg', 'cells__history')
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

        # Replace veg_db
        VegEntry.objects.all().delete()
        for v in data['veg_db']:
            VegEntry.objects.create(
                key=v.get('key') or slugify(v.get('name', ''))[:80],
                name=v.get('name', ''),
                latin_name=v.get('latin_name', '') or '',
                emoji=v.get('emoji', '') or '',
                sow_where=v.get('sow_where', 'Outdoors') or 'Outdoors',
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

        return Response({'restored': True})

    def _restore_cell(self, plot, position, src):
        veg_key = src.get('veg_key')
        veg_obj = VegEntry.objects.filter(key=veg_key).first() if veg_key else None
        cell = Cell.objects.create(
            plot=plot,
            position=position,
            veg=veg_obj,
            date_sewed=src.get('date_sewed') or None,
            seeds_planted=src.get('seeds_planted') or 0,
            total_harvested=src.get('total_harvested') or 0,
            total_failed=src.get('total_failed') or 0,
            total_weight_g=src.get('total_weight_g') or 0,
        )
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
