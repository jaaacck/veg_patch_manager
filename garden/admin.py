from django.contrib import admin
from .models import VegEntry, Plot, Cell, HistoryEntry


@admin.register(VegEntry)
class VegEntryAdmin(admin.ModelAdmin):
    list_display = ['name', 'latin_name', 'sow_where', 'sow_start', 'sow_end', 'days_to_harvest']
    search_fields = ['name', 'latin_name', 'key']
    list_filter = ['sow_where']


@admin.register(Plot)
class PlotAdmin(admin.ModelAdmin):
    list_display = ['name', 'rows', 'cols', 'created_at']
    search_fields = ['name']


@admin.register(Cell)
class CellAdmin(admin.ModelAdmin):
    list_display = ['plot', 'position', 'veg', 'date_sewed', 'seeds_planted', 'total_harvested', 'total_failed']
    list_filter = ['plot', 'veg']


@admin.register(HistoryEntry)
class HistoryEntryAdmin(admin.ModelAdmin):
    list_display = ['plot', 'cell', 'event_type', 'veg_name', 'count', 'date']
    list_filter = ['event_type', 'plot']
