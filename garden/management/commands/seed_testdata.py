"""
Generate realistic test data — a full year (plus the current season) of
square-foot vegetable gardening — across every square of every plot.

What it models, so the Data dashboard fills in believably:
  * Themed beds (a tomato bed, a salad/root bed, an allium box, ...).
  * A sun/fertility gradient down each bed (top rows yield more than the
    shaded bottom rows) — so the heatmap and best/weakest rankings show a
    real spatial pattern.
  * Last year's full season: sow -> staggered harvests -> the odd pest
    failure -> clear, with some squares doing succession planting.
  * The current season's crops still in the ground (so the Garden grid
    shows live "days to harvest" countdowns), with harvests recorded up to
    today where the window has opened.
  * Yields/failures driven by each veg's real per_sq_ft, days_to_harvest
    and sow window, with random variation.

Usage (inside the container):
  docker compose exec web python manage.py seed_testdata          # fill existing beds
  docker compose exec web python manage.py seed_testdata --fresh  # wipe & build a demo garden
  docker compose exec web python manage.py seed_testdata --seed 7 # reproducible run
"""
import datetime
import random

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.text import slugify

from garden.models import VegEntry, Plot, Cell, HistoryEntry, Plant, Job


# Demo beds created by --fresh (name drives the themed crop pool below).
DEMO_BEDS = [
    ('Main Bed', 4, 4),
    ('Tomato Bed', 3, 5),
    ('Salad & Roots', 2, 6),
    ('Herb & Allium Box', 3, 3),
]

# Crop pools by bed-name keyword (display names; resolved to keys via slugify).
THEME_POOLS = {
    'tomato': ['Tomatoes', 'Sweet peppers', 'Chillies', 'Cucumber', 'Aubergine', 'Courgette'],
    'salad': ['Lettuce', 'Salad leaves', 'Spinach', 'Radish', 'Pak choi', 'Swiss chard', 'Beetroot'],
    'root': ['Carrots', 'Beetroot', 'Parsnips', 'Radish', 'Turnip', 'Swede', 'Spring onions'],
    'herb': ['Mint', 'Thyme', 'Lemon verbena', 'Spring onions', 'Garlic', 'Leeks'],
    'allium': ['Onions', 'Garlic', 'Leeks', 'Spring onions'],
    'bean': ['French beans', 'Runner beans', 'Broad beans', 'Peas'],
}
MIXED_POOL = ['Tomatoes', 'Carrots', 'Lettuce', 'Courgette', 'Beetroot', 'Kale', 'Spinach',
              'French beans', 'Peas', 'Onions', 'Leeks', 'Radish', 'Swiss chard', 'Broccoli',
              'Cabbage', 'Cucumber', 'Garlic', 'Parsnips', 'Spring onions', 'Potatoes']
SUMMER_NOW = ['Tomatoes', 'Courgette', 'Cucumber', 'French beans', 'Peas', 'Beetroot', 'Lettuce',
              'Swiss chard', 'Kale', 'Leeks', 'Carrots', 'Spring onions', 'Chillies', 'Sweet peppers']
SUCCESSION = ['Radish', 'Salad leaves', 'Lettuce', 'Spinach', 'Pak choi']
FAIL_NOTES = ['Slug damage', 'Bolted in the heat', 'Caterpillars got it', 'Poor germination',
              'Pigeon damage', 'Rotted in the wet', 'Eaten by birds', 'Powdery mildew']
HARV_NOTES = ['Great crop', 'Small but tasty', 'Bumper yield', 'A bit woody', 'Sweet and tender',
              'Picked young', 'Best in this bed', 'Slightly bitter']
BED_NOTES = ['South-facing, drains well.', 'Heavy clay — improved with compost each year.',
             'Shadier end of the garden.', 'Slugs are bad here after rain.',
             'Sandy soil, dries out fast in summer.', 'Sheltered spot, warms up early.']

# Jobs for the demo ornamental plants (name -> list of (month, description)).
PLANT_JOBS = {
    'Lavender': [(8, 'Trim lightly after flowering to keep it bushy.')],
    'Rose': [(2, 'Prune hard in late winter.'), (6, 'Feed and mulch; watch for blackspot.')],
    'Hydrangea': [(3, "Cut back last year's flowered stems above a fat bud.")],
    'Hosta': [(6, 'Watch for slugs; water well in dry spells.')],
    'Foxglove': [(6, 'Deadhead the main spike to encourage side shoots.')],
    'Salvia': [(6, 'Chop back after the first flush for a second show.')],
}

# (name, latin, water, sun, soil, about) for the demo ornamental bed.
PLANT_SAMPLES = [
    ('Lavender', 'Lavandula angustifolia', 'Low', 'Full sun', 'Sandy', 'Fragrant; loved by bees. Trim after flowering.'),
    ('Rose', 'Rosa', 'Medium', 'Full sun', 'Clay', 'Prune in late winter; feed in spring.'),
    ('Hydrangea', 'Hydrangea macrophylla', 'High', 'Partial shade', 'Loam', 'Flower colour shifts with soil pH.'),
    ('Hosta', 'Hosta', 'High', 'Full shade', 'Loam', 'Lush foliage; watch for slugs.'),
    ('Foxglove', 'Digitalis purpurea', 'Medium', 'Partial shade', 'Loam', 'Biennial; self-seeds freely.'),
    ('Salvia', 'Salvia nemorosa', 'Low', 'Full sun', 'Sandy', 'Long-flowering; drought-tolerant once set.'),
]
HEAVY_CROPPERS = {'tomatoes', 'courgette', 'cucumber', 'french-beans', 'runner-beans', 'peas',
                  'chillies', 'sweet-peppers', 'aubergine', 'swiss-chard', 'lettuce',
                  'salad-leaves', 'kale'}


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _resolve(names, by_key):
    """Resolve display type names to veg entries — INCLUDING every variety of
    that type, so the demo plants a spread of varieties (e.g. three Tomatoes)."""
    by_type = {}
    for v in by_key.values():
        by_type.setdefault(v.name.lower(), []).append(v)
    out = []
    for n in names:
        out.extend(by_type.get(n.strip().lower(), []))
    return out


def _pool_for(plot_name, by_key):
    nm = (plot_name or '').lower()
    for kw, names in THEME_POOLS.items():
        if kw in nm:
            p = _resolve(names, by_key)
            if p:
                return p
    return _resolve(MIXED_POOL, by_key) or list(by_key.values())


def _plants_for(veg):
    return _clamp(int(round(veg.per_sq_ft or 1)), 1, 16)


def _grams_per_item(veg, rng):
    """Rough per-item harvest weight, scaled by how densely the crop is planted."""
    psf = veg.per_sq_ft or 1
    if psf >= 9:      # radish, carrots, spring onions — small items
        return rng.randint(10, 60)
    if psf >= 4:      # lettuce, beetroot, chard
        return rng.randint(60, 250)
    if psf >= 1:      # tomatoes, cabbage, potatoes
        return rng.randint(150, 600)
    return rng.randint(500, 2500)  # pumpkins, squash, marrows


class Command(BaseCommand):
    help = "Generate a realistic year of test data across all squares of all plots."

    def add_arguments(self, parser):
        parser.add_argument('--fresh', action='store_true',
                            help='Delete all plots/history first and build a demo garden.')
        parser.add_argument('--seed', type=int, default=None,
                            help='Random seed for reproducible output.')
        parser.add_argument('--if-empty', action='store_true',
                            help='Skip entirely if real data already exists (safe on build).')

    def handle(self, *args, **opts):
        # Build-time guard: never touch a garden that already has real data.
        if opts.get('if_empty'):
            has_data = (HistoryEntry.objects.exists()
                        or Cell.objects.exclude(veg__isnull=True).exists()
                        or Cell.objects.exclude(plant__isnull=True).exists()
                        or Plot.objects.exclude(name='Main Bed').exists())
            if has_data:
                self.stdout.write("seed_testdata: existing data found — skipping demo seed.")
                return
        rng = random.Random(opts.get('seed'))
        today = datetime.date.today()
        prev_year = today.year - 1
        prev_end = datetime.date(prev_year, 11, 30)

        by_key = {v.key: v for v in VegEntry.objects.all()}
        if not by_key:
            self.stderr.write(self.style.ERROR(
                "No vegetables found — run `python manage.py seed_defaults` first."))
            return

        with transaction.atomic():
            if opts.get('fresh'):
                HistoryEntry.objects.all().delete()
                Cell.objects.all().delete()
                Plot.objects.all().delete()
                for name, r, c in DEMO_BEDS:
                    plot = Plot.objects.create(name=name, rows=r, cols=c)
                    Cell.objects.bulk_create(
                        [Cell(plot=plot, position=i) for i in range(r * c)])
                # One demo ornamental (plant) bed.
                pbed = Plot.objects.create(name='Flower Bed', kind=Plot.PLANT, rows=3, cols=3)
                pbed.last_composted = today - datetime.timedelta(days=rng.randint(30, 200))
                pbed.notes = 'Mixed ornamental border — year-round colour.'
                pbed.save(update_fields=['last_composted', 'notes'])
                pcells = Cell.objects.bulk_create(
                    [Cell(plot=pbed, position=i) for i in range(9)])
                samples = PLANT_SAMPLES[:]
                rng.shuffle(samples)
                for cell, s in zip(pcells, samples):
                    cell.plant = Plant.objects.create(
                        name=s[0], latin_name=s[1], water_level=s[2], sun_level=s[3],
                        soil_type=s[4], about=s[5],
                        date_planted=today - datetime.timedelta(days=rng.randint(30, 400)))
                    cell.save(update_fields=['plant'])
                    for (mo, desc) in PLANT_JOBS.get(s[0], []):
                        Job.objects.create(plant=cell.plant, month=mo, description=desc)

            # Only veg beds get a generated year of harvest history.
            plots = list(Plot.objects.filter(kind=Plot.VEG))
            if not plots:
                plot = Plot.objects.create(name='Main Bed', rows=4, cols=4)
                Cell.objects.bulk_create([Cell(plot=plot, position=i) for i in range(16)])
                plots = [plot]

            n_plots = n_cells = n_events = 0
            tot_h = tot_f = 0

            for plot in plots:
                # Reset this plot's data so the command is safe to re-run.
                HistoryEntry.objects.filter(plot=plot).delete()
                plot.last_composted = today - datetime.timedelta(days=rng.randint(20, 240))
                if not (plot.notes or '').strip():
                    plot.notes = rng.choice(BED_NOTES)
                plot.save(update_fields=['last_composted', 'notes'])
                pool = _pool_for(plot.name, by_key)
                summer = [v for v in _resolve(SUMMER_NOW, by_key) if v in pool] \
                    or _resolve(SUMMER_NOW, by_key) or pool
                cols = plot.cols or 1
                rows = plot.rows or 1
                cells = list(plot.cells.all())

                for cell in cells:
                    hist = []
                    cell_h = cell_f = cell_w = 0
                    row_idx = cell.position // cols
                    grad = 1.0 - (row_idx / max(1, rows - 1)) * 0.45  # top sunnier than bottom
                    fert = _clamp(grad + rng.uniform(-0.12, 0.12), 0.30, 1.10)

                    # ---- last year's main crop ----
                    v1 = rng.choice(pool)
                    m1 = _clamp(v1.sow_start or rng.randint(3, 5), 2, 7)
                    sow1 = datetime.date(prev_year, m1, rng.randint(1, 28))
                    h, f, w = self._grow(rng, plot, cell, v1, sow1, fert, prev_end, hist)
                    cell_h += h
                    cell_f += f
                    cell_w += w
                    hist.append(self._evt(plot, cell, HistoryEntry.CLEARED, v1,
                                          datetime.date(prev_year, rng.choice([10, 11]),
                                                        rng.randint(1, 28))))

                    # ---- optional succession crop (fast turnover squares) ----
                    if (v1.days_to_harvest or 60) <= 60 and rng.random() < 0.35:
                        v1b = rng.choice(_resolve(SUCCESSION, by_key) or pool)
                        sow1b = datetime.date(prev_year, rng.choice([7, 8]), rng.randint(1, 28))
                        h, f, w = self._grow(rng, plot, cell, v1b, sow1b, fert, prev_end, hist)
                        cell_h += h
                        cell_f += f
                        cell_w += w
                        hist.append(self._evt(plot, cell, HistoryEntry.CLEARED, v1b,
                                              datetime.date(prev_year, 11, rng.randint(1, 28))))

                    # ---- this season's crop (most squares are in use now) ----
                    if rng.random() < 0.85:
                        v2 = rng.choice(summer)
                        sow_m = rng.randint(3, _clamp(today.month - 1, 3, 5)) \
                            if today.month > 3 else 3
                        sow2 = datetime.date(today.year, sow_m, rng.randint(1, 28))
                        if sow2 > today:
                            sow2 = today - datetime.timedelta(days=rng.randint(20, 60))
                        plants2 = _plants_for(v2)
                        hist.append(self._evt(plot, cell, HistoryEntry.PLANTED, v2, sow2,
                                              count=plants2))
                        cell.veg = v2
                        cell.date_sown = sow2
                        cell.seeds_planted = plants2

                        dth2 = v2.days_to_harvest or 60
                        gpi2 = _grams_per_item(v2, rng)
                        hd = sow2 + datetime.timedelta(days=int(dth2 * rng.uniform(0.85, 1.15)))
                        nmax = 6 if v2.key in HEAVY_CROPPERS else 3
                        k = 0
                        while hd <= today and k < nmax:
                            c = max(1, int(round(plants2 * rng.uniform(1.0, 3.0) * fert)))
                            wt = c * gpi2
                            note = rng.choice(HARV_NOTES) if rng.random() < 0.3 else ''
                            hist.append(self._evt(plot, cell, HistoryEntry.HARVESTED, v2, hd,
                                                  count=c, note=note, weight_g=wt))
                            cell_h += c
                            cell_w += wt
                            hd += datetime.timedelta(days=rng.randint(7, 14))
                            k += 1
                        if rng.random() < 0.20:
                            fd = sow2 + datetime.timedelta(days=rng.randint(10, max(12, dth2)))
                            if fd <= today:
                                fc = rng.randint(1, max(1, plants2 // 2 or 1))
                                hist.append(self._evt(plot, cell, HistoryEntry.FAILED, v2, fd,
                                                      count=fc, note=rng.choice(FAIL_NOTES)))
                                cell_f += fc
                    else:
                        cell.veg = None
                        cell.date_sown = None
                        cell.seeds_planted = 0

                    cell.total_harvested = cell_h
                    cell.total_failed = cell_f
                    cell.total_weight_g = cell_w
                    cell.save()
                    HistoryEntry.objects.bulk_create(hist)

                    n_cells += 1
                    n_events += len(hist)
                    tot_h += cell_h
                    tot_f += cell_f
                n_plots += 1

        self.stdout.write(self.style.SUCCESS(
            f"seed_testdata: {n_plots} plots, {n_cells} squares, {n_events} events — "
            f"{tot_h} harvested, {tot_f} failed."))

    # ---- helpers ----
    def _evt(self, plot, cell, event_type, veg, date, count=0, note='', weight_g=0):
        return HistoryEntry(plot=plot, cell=cell, event_type=event_type, date=date,
                            veg_name=veg.display_name, veg_key=veg.key, count=count, note=note,
                            weight_g=weight_g)

    def _grow(self, rng, plot, cell, veg, sow, fert, end_cap, hist):
        """Append a full crop lifecycle to `hist`; return (harvested, failed, weight_g)."""
        plants = _plants_for(veg)
        dth = veg.days_to_harvest or 60
        gpi = _grams_per_item(veg, rng)
        hist.append(self._evt(plot, cell, HistoryEntry.PLANTED, veg, sow, count=plants))
        harv = fail = weight = 0

        # Total wipe-out is more likely on poorer (shadier) squares.
        wipeout = rng.random() < 0.08 * (1.6 - fert)

        # Background pest/weather losses.
        if rng.random() < (0.20 + (1 - fert) * 0.45):
            for _ in range(rng.randint(1, 2)):
                fd = sow + datetime.timedelta(days=rng.randint(10, max(12, dth)))
                if fd > end_cap:
                    continue
                fc = rng.randint(1, max(1, plants // 2 or 1))
                note = rng.choice(FAIL_NOTES) if rng.random() < 0.7 else ''
                hist.append(self._evt(plot, cell, HistoryEntry.FAILED, veg, fd, count=fc, note=note))
                fail += fc

        if wipeout:
            fd = sow + datetime.timedelta(days=rng.randint(15, max(20, dth)))
            if fd <= end_cap:
                hist.append(self._evt(plot, cell, HistoryEntry.FAILED, veg, fd, count=plants,
                                      note=rng.choice(FAIL_NOTES)))
                fail += plants
            return harv, fail, weight

        if dth <= 45:
            n = rng.randint(2, 5)
        elif dth <= 90:
            n = rng.randint(1, 3)
        else:
            n = rng.randint(1, 2)
        if veg.key in HEAVY_CROPPERS:
            n += rng.randint(1, 3)

        hd = sow + datetime.timedelta(days=int(dth * rng.uniform(0.85, 1.15)))
        for _ in range(n):
            if hd > end_cap:
                break
            c = max(1, int(round(plants * rng.uniform(1.0, 3.0) * fert)))
            wt = c * gpi
            note = rng.choice(HARV_NOTES) if rng.random() < 0.3 else ''
            hist.append(self._evt(plot, cell, HistoryEntry.HARVESTED, veg, hd, count=c, note=note,
                                  weight_g=wt))
            harv += c
            weight += wt
            hd += datetime.timedelta(days=rng.randint(7, 14))
        return harv, fail, weight
