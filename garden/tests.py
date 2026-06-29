"""
API tests for the core garden flows.

Run inside the container:
    docker compose exec web python manage.py test garden
"""
from django.test import TestCase
from rest_framework.test import APIClient

from garden.models import VegEntry, Plot, Cell, HistoryEntry


class GardenAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        VegEntry.objects.create(
            key='tomatoes', name='Tomatoes', sow_where='Sow indoors',
            sow_start=2, sow_end=4, harvest_start=7, harvest_end=10,
            per_sq_ft=1, days_to_harvest=75,
        )

    def _make_bed(self, name='Test Bed', rows=2, cols=2):
        r = self.client.post('/api/plots/',
                             {'name': name, 'rows': rows, 'cols': cols}, format='json')
        self.assertEqual(r.status_code, 201)
        return r.json()

    def _plant(self, cell_id, date='2026-03-01', seeds=1):
        return self.client.patch(
            '/api/cells/%d/' % cell_id,
            {'veg_key': 'tomatoes', 'date_sown': date, 'seeds_planted': seeds},
            format='json',
        )

    # ---- beds & cells ----
    def test_create_bed_creates_cells(self):
        bed = self._make_bed(rows=3, cols=4)
        self.assertEqual((bed['rows'], bed['cols']), (3, 4))
        self.assertEqual(len(bed['cells']), 12)
        self.assertEqual(Cell.objects.filter(plot_id=bed['id']).count(), 12)

    def test_plant_square_logs_history(self):
        bed = self._make_bed()
        cid = bed['cells'][0]['id']
        r = self._plant(cid)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['veg_key'], 'tomatoes')
        self.assertEqual(
            HistoryEntry.objects.filter(cell_id=cid, event_type='planted').count(), 1)

    def test_resize_blocked_when_occupied(self):
        bed = self._make_bed(rows=2, cols=2)  # positions 0-3
        last = next(c for c in bed['cells'] if c['position'] == 3)
        self._plant(last['id'])
        r = self.client.patch('/api/plots/%d/' % bed['id'],
                              {'rows': 1, 'cols': 2}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('occupied_positions', r.json())

    # ---- harvest / weight ----
    def test_record_harvest_with_weight_and_note(self):
        bed = self._make_bed()
        cid = bed['cells'][0]['id']
        self._plant(cid)
        r = self.client.post('/api/cells/%d/record_harvest/' % cid,
                             {'count': 5, 'weight': 450, 'note': 'great crop'}, format='json')
        self.assertEqual(r.status_code, 200)
        cell = r.json()
        self.assertEqual(cell['total_harvested'], 5)
        self.assertEqual(cell['total_weight_g'], 450)
        h = HistoryEntry.objects.get(cell_id=cid, event_type='harvested')
        self.assertEqual((h.weight_g, h.note), (450, 'great crop'))

    def test_record_failure_rejects_non_positive(self):
        bed = self._make_bed()
        cid = bed['cells'][0]['id']
        r = self.client.post('/api/cells/%d/record_failure/' % cid,
                             {'count': 0}, format='json')
        self.assertEqual(r.status_code, 400)

    # ---- compost ----
    def test_add_compost_keeps_most_recent(self):
        bed = self._make_bed()
        r = self.client.post('/api/plots/%d/add_compost/' % bed['id'],
                             {'date': '2026-05-01'}, format='json')
        self.assertEqual(r.json()['last_composted'], '2026-05-01')
        # an older date must not override the most recent
        self.client.post('/api/plots/%d/add_compost/' % bed['id'],
                         {'date': '2026-01-01'}, format='json')
        self.assertEqual(
            Plot.objects.get(id=bed['id']).last_composted.isoformat(), '2026-05-01')

    # ---- stats ----
    def test_stats_shape_and_totals(self):
        bed = self._make_bed()
        cid = bed['cells'][0]['id']
        self._plant(cid)
        self.client.post('/api/cells/%d/record_harvest/' % cid,
                         {'count': 3, 'weight': 300}, format='json')
        r = self.client.get('/api/plots/%d/stats/' % bed['id'])
        self.assertEqual(r.status_code, 200)
        data = r.json()
        for key in ('plot', 'totals', 'by_square', 'by_vegetable',
                    'plant_square_matrix', 'monthly'):
            self.assertIn(key, data)
        self.assertEqual(data['totals']['total_harvested'], 3)
        self.assertEqual(data['totals']['total_weight_g'], 300)
        self.assertTrue(any(v['veg_key'] == 'tomatoes' for v in data['by_vegetable']))

    # ---- backup / restore ----
    def test_backup_restore_roundtrip(self):
        bed = self._make_bed(name='My Bed')
        cid = bed['cells'][0]['id']
        self._plant(cid)
        self.client.post('/api/cells/%d/record_harvest/' % cid,
                         {'count': 2, 'weight': 200}, format='json')
        backup = self.client.get('/api/backup/').json()
        r = self.client.post('/api/backup/restore/', backup, format='json')
        self.assertEqual(r.status_code, 200)
        beds = self.client.get('/api/plots/').json()
        self.assertEqual(len(beds), 1)
        self.assertEqual(beds[0]['name'], 'My Bed')
        harvested = [c for c in beds[0]['cells'] if c['total_harvested'] == 2]
        self.assertTrue(harvested)
        self.assertEqual(harvested[0]['total_weight_g'], 200)

    # ---- designer layout ----
    def test_save_layout_updates_only_positions(self):
        bed = self._make_bed(name='Map Bed')
        r = self.client.post('/api/plots/save_layout/',
                             {'layouts': [{'id': bed['id'], 'x': 3, 'y': 5}]}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['saved'], 1)
        fresh = Plot.objects.get(id=bed['id'])
        self.assertEqual((fresh.layout_x, fresh.layout_y), (3, 5))
        self.assertEqual(fresh.name, 'Map Bed')  # bed itself untouched

    def test_plant_catalog_crud(self):
        # add a standalone plant from the catalog
        r = self.client.post('/api/plants/', {'name': 'Lavender'}, format='json')
        self.assertEqual(r.status_code, 201)
        pid = r.json()['id']
        r = self.client.patch('/api/plants/%d/' % pid,
                              {'sun_level': 'Full sun', 'water_level': 'Low'}, format='json')
        self.assertEqual(r.json()['sun_level'], 'Full sun')
        self.assertEqual(len(self.client.get('/api/plants/').json()), 1)
        self.client.delete('/api/plants/%d/' % pid)
        self.assertEqual(len(self.client.get('/api/plants/').json()), 0)

    def test_place_existing_plant(self):
        bed = self.client.post('/api/plots/',
                              {'name': 'Border', 'kind': 'plant', 'rows': 1, 'cols': 1},
                              format='json').json()
        cid = bed['cells'][0]['id']
        p = self.client.post('/api/plants/', {'name': 'Rose'}, format='json').json()
        r = self.client.post('/api/cells/%d/place_plant/' % cid,
                             {'plant_id': p['id']}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['plant']['id'], p['id'])

    def test_same_plant_in_multiple_squares(self):
        bed = self.client.post('/api/plots/',
                              {'name': 'Hedge', 'kind': 'plant', 'rows': 1, 'cols': 3},
                              format='json').json()
        ids = [c['id'] for c in bed['cells']]
        p = self.client.post('/api/plants/', {'name': 'Box'}, format='json').json()
        for cid in ids:
            self.client.post('/api/cells/%d/place_plant/' % cid,
                             {'plant_id': p['id']}, format='json')
        self.assertEqual(Cell.objects.filter(plant_id=p['id']).count(), 3)
        # removing from one square leaves it in the others and in the catalogue
        self.client.post('/api/cells/%d/unplace_plant/' % ids[0], {}, format='json')
        self.assertEqual(Cell.objects.filter(plant_id=p['id']).count(), 2)
        self.assertEqual(len(self.client.get('/api/plants/').json()), 1)

    def test_unplace_keeps_plant_in_catalogue(self):
        bed = self.client.post('/api/plots/',
                              {'name': 'Border', 'kind': 'plant', 'rows': 1, 'cols': 2},
                              format='json').json()
        cid = bed['cells'][0]['id']
        p = self.client.post('/api/plants/', {'name': 'Hosta'}, format='json').json()
        self.client.post('/api/cells/%d/place_plant/' % cid,
                         {'plant_id': p['id']}, format='json')
        r = self.client.post('/api/cells/%d/unplace_plant/' % cid, {}, format='json')
        self.assertIsNone(r.json()['plant'])
        self.assertEqual(len(self.client.get('/api/plants/').json()), 1)  # still in catalogue

    def test_service_worker_served(self):
        r = self.client.get('/sw.js')
        self.assertEqual(r.status_code, 200)
        self.assertIn('javascript', r['Content-Type'])

    def test_feature_crud(self):
        r = self.client.post('/api/features/',
                             {'kind': 'shed', 'label': 'Shed', 'x': 1, 'y': 2, 'w': 2, 'h': 2},
                             format='json')
        self.assertEqual(r.status_code, 201)
        fid = r.json()['id']
        r = self.client.patch('/api/features/%d/' % fid, {'x': 5, 'y': 6}, format='json')
        self.assertEqual((r.json()['x'], r.json()['y']), (5, 6))
        self.assertEqual(len(self.client.get('/api/features/').json()), 1)
        self.client.delete('/api/features/%d/' % fid)
        self.assertEqual(len(self.client.get('/api/features/').json()), 0)

    # ---- plant beds ----
    def test_plant_bed_set_and_remove_plant(self):
        r = self.client.post('/api/plots/',
                             {'name': 'Border', 'kind': 'plant', 'rows': 2, 'cols': 2},
                             format='json')
        self.assertEqual(r.status_code, 201)
        bed = r.json()
        self.assertEqual(bed['kind'], 'plant')
        cid = bed['cells'][0]['id']
        r = self.client.post('/api/cells/%d/set_plant/' % cid, {
            'name': 'Lavender', 'latin_name': 'Lavandula angustifolia',
            'date_planted': '2026-04-01', 'water_level': 'Low',
            'sun_level': 'Full sun', 'soil_type': 'Sandy', 'about': 'Bee magnet',
        }, format='json')
        self.assertEqual(r.status_code, 200)
        plant = r.json()['plant']
        self.assertEqual(plant['name'], 'Lavender')
        self.assertEqual(plant['sun_level'], 'Full sun')
        # remove it
        r = self.client.post('/api/cells/%d/remove_plant/' % cid, {}, format='json')
        self.assertIsNone(r.json()['plant'])

    def test_set_plant_requires_name(self):
        bed = self.client.post('/api/plots/',
                              {'name': 'Border', 'kind': 'plant', 'rows': 1, 'cols': 1},
                              format='json').json()
        cid = bed['cells'][0]['id']
        r = self.client.post('/api/cells/%d/set_plant/' % cid, {'name': ''}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_switching_kind_clears_plantings(self):
        bed = self._make_bed()                       # veg bed
        cid = bed['cells'][0]['id']
        self._plant(cid)
        self.client.post('/api/cells/%d/record_harvest/' % cid, {'count': 2}, format='json')
        # switch to a plant bed
        r = self.client.patch('/api/plots/%d/' % bed['id'], {'kind': 'plant'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['kind'], 'plant')
        from garden.models import HistoryEntry as HE
        self.assertEqual(HE.objects.filter(plot_id=bed['id']).count(), 0)
        cell = next(c for c in r.json()['cells'] if c['id'] == cid)
        self.assertIsNone(cell['veg'])
        self.assertEqual(cell['total_harvested'], 0)

    def test_legacy_restore_wraps_into_main_bed(self):
        legacy = {
            'veg_db': [{'key': 'tomatoes', 'name': 'Tomatoes'}],
            'plots': [
                {'index': 0, 'veg_key': 'tomatoes', 'date_sewed': '2026-03-01',
                 'seeds_planted': 1, 'total_harvested': 4, 'total_failed': 0,
                 'history': [{'event_type': 'harvested', 'date': '2026-07-01',
                              'veg_name': 'Tomatoes', 'count': 4}]},
                {'index': 1},
            ],
        }
        r = self.client.post('/api/backup/restore/', legacy, format='json')
        self.assertEqual(r.status_code, 200)
        beds = self.client.get('/api/plots/').json()
        self.assertEqual(len(beds), 1)
        self.assertEqual(beds[0]['name'], 'Main Bed')
        c0 = next(c for c in beds[0]['cells'] if c['position'] == 0)
        self.assertEqual(c0['total_harvested'], 4)


class VarietyJobSeedlingTests(TestCase):
    """Coverage for varieties, jobs, the greenhouse and bulk fill."""

    def setUp(self):
        self.client = APIClient()
        self.tom = VegEntry.objects.create(
            key='tomatoes', name='Tomatoes', sow_indoors_start=2, sow_indoors_end=4,
            harvest_start=7, harvest_end=10, per_sq_ft=1, days_to_harvest=75)

    def _bed(self, rows=2, cols=2, kind='veg'):
        return self.client.post('/api/plots/',
                                {'name': 'Bed', 'rows': rows, 'cols': cols, 'kind': kind},
                                format='json').json()

    # ---- varieties ----
    def test_variety_gets_unique_key_and_display_name(self):
        r = self.client.post('/api/veg/',
                             {'name': 'Tomatoes', 'variety': 'Sungold'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertNotEqual(r.json()['key'], 'tomatoes')
        self.assertEqual(r.json()['display_name'], 'Tomatoes — Sungold')

    # ---- mandatory date / seeds ----
    def test_planting_requires_date_and_seeds(self):
        bed = self._bed()
        cid = bed['cells'][0]['id']
        r = self.client.patch('/api/cells/%d/' % cid,
                              {'veg_key': 'tomatoes', 'seeds_planted': 3}, format='json')
        self.assertEqual(r.status_code, 400)  # no date
        r = self.client.patch('/api/cells/%d/' % cid,
                              {'veg_key': 'tomatoes', 'date_sown': '2026-03-01', 'seeds_planted': 0},
                              format='json')
        self.assertEqual(r.status_code, 400)  # no seeds

    def test_changing_date_updates_existing_planting(self):
        bed = self._bed()
        cid = bed['cells'][0]['id']
        self.client.patch('/api/cells/%d/' % cid,
                          {'veg_key': 'tomatoes', 'date_sown': '2026-03-01', 'seeds_planted': 2},
                          format='json')
        self.client.patch('/api/cells/%d/' % cid,
                          {'veg_key': 'tomatoes', 'date_sown': '2026-03-08', 'seeds_planted': 2},
                          format='json')
        self.assertEqual(
            HistoryEntry.objects.filter(cell_id=cid, event_type='planted').count(), 1)

    # ---- jobs ----
    def test_job_crud_and_nested_on_veg(self):
        r = self.client.post('/api/jobs/',
                             {'veg': 'tomatoes', 'month': 6, 'description': 'Pinch out'},
                             format='json')
        self.assertEqual(r.status_code, 201)
        veg = self.client.get('/api/veg/tomatoes/').json()
        self.assertEqual(len(veg['jobs']), 1)
        self.assertEqual(veg['jobs'][0]['description'], 'Pinch out')

    def test_log_job_is_per_square(self):
        bed = self._bed(rows=1, cols=2)
        a, b = bed['cells'][0]['id'], bed['cells'][1]['id']
        for cid in (a, b):
            self.client.patch('/api/cells/%d/' % cid,
                              {'veg_key': 'tomatoes', 'date_sown': '2026-03-01', 'seeds_planted': 1},
                              format='json')
        job = self.client.post('/api/jobs/',
                              {'veg': 'tomatoes', 'month': 6, 'description': 'Feed'},
                              format='json').json()
        r = self.client.post('/api/cells/%d/log_job/' % a, {'job': job['id']}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(HistoryEntry.objects.filter(cell_id=a, event_type='job').count(), 1)
        self.assertEqual(HistoryEntry.objects.filter(cell_id=b, event_type='job').count(), 0)

    # ---- greenhouse ----
    def test_seedling_transplant_reduces_amount(self):
        bed = self._bed()
        cid = bed['cells'][0]['id']
        sd = self.client.post('/api/seedlings/',
                             {'veg': 'tomatoes', 'date_sown': '2026-03-01', 'amount': 10},
                             format='json').json()
        r = self.client.post('/api/cells/%d/plant_from_seedling/' % cid,
                            {'seedling_id': sd['id'], 'count': 4}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['seeds_planted'], 4)
        self.assertEqual(r.json()['veg_key'], 'tomatoes')
        self.assertEqual(self.client.get('/api/seedlings/%d/' % sd['id']).json()['amount'], 6)

    def test_seedling_transplant_rejects_overdraw(self):
        bed = self._bed()
        cid = bed['cells'][0]['id']
        sd = self.client.post('/api/seedlings/',
                             {'veg': 'tomatoes', 'amount': 3}, format='json').json()
        r = self.client.post('/api/cells/%d/plant_from_seedling/' % cid,
                            {'seedling_id': sd['id'], 'count': 5}, format='json')
        self.assertEqual(r.status_code, 400)

    # ---- bulk fill ----
    def test_fill_only_fills_empty_squares(self):
        bed = self._bed(rows=2, cols=2)
        occupied = bed['cells'][0]['id']
        self.client.patch('/api/cells/%d/' % occupied,
                          {'veg_key': 'tomatoes', 'date_sown': '2026-03-01', 'seeds_planted': 9},
                          format='json')
        r = self.client.post('/api/plots/%d/fill/' % bed['id'],
                            {'veg_key': 'tomatoes', 'date_sown': '2026-04-01', 'seeds_planted': 1},
                            format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['filled'], 3)  # the 3 empties, not the occupied one
        cell = Cell.objects.get(id=occupied)
        self.assertEqual(cell.seeds_planted, 9)  # untouched

    # ---- backup round-trip of new entities ----
    def test_backup_restore_keeps_jobs_and_seedlings(self):
        self.client.post('/api/jobs/',
                        {'veg': 'tomatoes', 'month': 6, 'description': 'Pinch out'}, format='json')
        self.client.post('/api/seedlings/',
                        {'veg': 'tomatoes', 'amount': 5}, format='json')
        backup = self.client.get('/api/backup/').json()
        self.assertTrue(backup.get('seedlings'))
        r = self.client.post('/api/backup/restore/', backup, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(self.client.get('/api/seedlings/').json()), 1)
        veg = self.client.get('/api/veg/tomatoes/').json()
        self.assertEqual(len(veg['jobs']), 1)
