from django.db import migrations, models


# Legacy "where to sow" value -> new sow category.
SOW_WHERE_MAP = {
    'Indoors': 'Sow indoors',
    'Indoors/Outdoors': 'Sow indoors',
    'Outdoors': 'Sow outdoors',
    'In ground': 'Sow outdoors',
    'Under cover': 'Sow outdoors (covered)',
}

NEW_VALUES = {
    'Sow indoors',
    'Sow outdoors',
    'Sow outdoors (covered)',
    'Plant out seedlings',
}


def remap_sow_where(apps, schema_editor):
    VegEntry = apps.get_model('garden', 'VegEntry')
    for veg in VegEntry.objects.all():
        current = (veg.sow_where or '').strip()
        if current in NEW_VALUES:
            continue
        veg.sow_where = SOW_WHERE_MAP.get(current, 'Sow outdoors')
        veg.save(update_fields=['sow_where'])


def noop_reverse(apps, schema_editor):
    # One-way data remap; categories are not losslessly reversible.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0001_initial'),
    ]

    operations = [
        migrations.RenameField(
            model_name='plot',
            old_name='date_sewed',
            new_name='date_sown',
        ),
        migrations.AddField(
            model_name='plot',
            name='notes',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='vegentry',
            name='sow_where',
            field=models.CharField(default='Sow outdoors', max_length=30),
        ),
        migrations.RunPython(remap_sow_where, noop_reverse),
    ]
