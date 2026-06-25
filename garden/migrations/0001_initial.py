import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='Plot',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('rows', models.IntegerField(default=4)),
                ('cols', models.IntegerField(default=4)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['created_at'],
            },
        ),
        migrations.CreateModel(
            name='VegEntry',
            fields=[
                ('key', models.CharField(max_length=80, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=100)),
                ('latin_name', models.CharField(blank=True, default='', max_length=120)),
                ('emoji', models.CharField(blank=True, default='', max_length=8)),
                ('image', models.ImageField(blank=True, null=True, upload_to='veg_images/')),
                ('sow_where', models.CharField(default='Outdoors', max_length=30)),
                ('sow_start', models.IntegerField(default=0)),
                ('sow_end', models.IntegerField(default=0)),
                ('harvest_start', models.IntegerField(default=0)),
                ('harvest_end', models.IntegerField(default=0)),
                ('per_sq_ft', models.FloatField(default=1)),
                ('days_to_harvest', models.IntegerField(default=60)),
                ('notes', models.TextField(blank=True, default='')),
            ],
            options={
                'ordering': ['name'],
            },
        ),
        migrations.CreateModel(
            name='Cell',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('position', models.IntegerField()),
                ('date_sewed', models.DateField(blank=True, null=True)),
                ('seeds_planted', models.IntegerField(default=0)),
                ('total_harvested', models.IntegerField(default=0)),
                ('total_failed', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('plot', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='cells', to='garden.plot')),
                ('veg', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='cells', to='garden.vegentry')),
            ],
            options={
                'ordering': ['plot', 'position'],
                'unique_together': {('plot', 'position')},
            },
        ),
        migrations.CreateModel(
            name='HistoryEntry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(choices=[('planted', 'Planted'), ('harvested', 'Harvested'), ('failed', 'Failed'), ('cleared', 'Cleared')], max_length=20)),
                ('date', models.DateField()),
                ('veg_name', models.CharField(blank=True, default='', max_length=120)),
                ('veg_key', models.CharField(blank=True, default='', max_length=80)),
                ('count', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('cell', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='history', to='garden.cell')),
                ('plot', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='history', to='garden.plot')),
            ],
            options={
                'ordering': ['-date', '-created_at'],
            },
        ),
    ]
