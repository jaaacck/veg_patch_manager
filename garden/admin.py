from django.contrib import admin
from .models import VegEntry, Plot, Cell, HistoryEntry, Plant, Job, Seedling, Photo

admin.site.register(Photo)


@admin.register(Seedling)
class SeedlingAdmin(admin.ModelAdmin):
    list_display = ['veg', 'date_sown', 'amount', 'sprouted', 'failed']


@admin.register(VegEntry)
class VegEntryAdmin(admin.ModelAdmin):
    list_display = ['name', 'variety', 'latin_name', 'days_to_harvest']
    search_fields = ['name', 'variety', 'latin_name', 'key']
    list_filter = ['name']


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ['description', 'month', 'veg', 'plant']
    list_filter = ['month']


@admin.register(Plot)
class PlotAdmin(admin.ModelAdmin):
    list_display = ['name', 'rows', 'cols', 'created_at']
    search_fields = ['name']


@admin.register(Cell)
class CellAdmin(admin.ModelAdmin):
    list_display = ['plot', 'position', 'veg', 'date_sown', 'seeds_planted', 'total_harvested', 'total_failed']
    list_filter = ['plot', 'veg']


@admin.register(HistoryEntry)
class HistoryEntryAdmin(admin.ModelAdmin):
    list_display = ['plot', 'cell', 'event_type', 'veg_name', 'count', 'date']
    list_filter = ['event_type', 'plot']
