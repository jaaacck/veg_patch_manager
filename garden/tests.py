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
            key='tomatoes', name='Tomatoes', sow_where='Indoors',
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
            {'veg_key': 'tomatoes', 'date_sewed': date, 'seeds_planted': seeds},
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
