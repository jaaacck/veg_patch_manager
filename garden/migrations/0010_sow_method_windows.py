from django.db import migrations, models


def populate_windows(apps, schema_editor):
    """Seed each per-method window from the veg's existing single sow window,
    routed by its (already-normalized) sow_where category."""
    VegEntry = apps.get_model('garden', 'VegEntry')
    for v in VegEntry.objects.all():
        ss, se = v.sow_start or 0, v.sow_end or 0
        if not (ss and se):
            continue
        sw = (v.sow_where or '').strip().lower()
        if sw == 'sow indoors':
            v.sow_indoors_start, v.sow_indoors_end = ss, se
        elif sw == 'sow outdoors (covered)':
            v.sow_covered_start, v.sow_covered_end = ss, se
        elif sw == 'plant out seedlings':
            v.plant_out_start, v.plant_out_end = ss, se
        else:  # 'sow outdoors' and anything else
            v.sow_outdoors_start, v.sow_outdoors_end = ss, se
        v.save(update_fields=[
            'sow_indoors_start', 'sow_indoors_end',
            'sow_outdoors_start', 'sow_outdoors_end',
            'sow_covered_start', 'sow_covered_end',
            'plant_out_start', 'plant_out_end',
        ])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0009_date_sown_sow_categories'),
    ]

    operations = [
        migrations.AddField(model_name='vegentry', name='sow_outdoors_start', field=models.IntegerField(default=0)),
        migrations.AddField(model_name='vegentry', name='sow_outdoors_end', field=models.IntegerField(default=0)),
        migrations.AddField(model_name='vegentry', name='sow_covered_start', field=models.IntegerField(default=0)),
        migrations.AddField(model_name='vegentry', name='sow_covered_end', field=models.IntegerField(default=0)),
        migrations.AddField(model_name='vegentry', name='sow_indoors_start', field=models.IntegerField(default=0)),
        migrations.AddField(model_name='vegentry', name='sow_indoors_end', field=models.IntegerField(default=0)),
        migrations.AddField(model_name='vegentry', name='plant_out_start', field=models.IntegerField(default=0)),
        migrations.AddField(model_name='vegentry', name='plant_out_end', field=models.IntegerField(default=0)),
        migrations.RunPython(populate_windows, noop_reverse),
    ]
