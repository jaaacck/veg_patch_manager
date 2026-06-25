from rest_framework import serializers
from .models import VegEntry, Plot, Cell, HistoryEntry


class HistoryEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = HistoryEntry
        fields = ['id', 'event_type', 'date', 'veg_name', 'veg_key', 'count', 'weight_g', 'note', 'created_at']


class VegEntrySerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = VegEntry
        fields = [
            'key', 'name', 'latin_name', 'emoji', 'image', 'image_url',
            'sow_where', 'sow_start', 'sow_end',
            'harvest_start', 'harvest_end',
            'per_sq_ft', 'days_to_harvest', 'notes',
        ]
        extra_kwargs = {
            'image': {'required': False, 'write_only': True},
            'key': {'required': False},
        }

    def get_image_url(self, obj):
        if not obj.image:
            return None
        request = self.context.get('request')
        url = obj.image.url
        return request.build_absolute_uri(url) if request else url


class CellSerializer(serializers.ModelSerializer):
    veg = VegEntrySerializer(read_only=True)
    veg_key = serializers.CharField(
        source='veg.key', read_only=True, allow_null=True
    )
    history = HistoryEntrySerializer(many=True, read_only=True)

    class Meta:
        model = Cell
        fields = [
            'id', 'position', 'veg', 'veg_key',
            'date_sewed', 'seeds_planted',
            'total_harvested', 'total_failed', 'total_weight_g',
            'history',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['total_harvested', 'total_failed', 'total_weight_g', 'created_at', 'updated_at']


class PlotSerializer(serializers.ModelSerializer):
    cells = CellSerializer(many=True, read_only=True)

    class Meta:
        model = Plot
        fields = [
            'id', 'name', 'rows', 'cols', 'last_composted', 'notes',
            'cells',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['last_composted', 'created_at', 'updated_at']
