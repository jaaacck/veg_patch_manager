import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0004_harvest_weight'),
    ]

    operations = [
        migrations.AddField(
            model_name='plot',
            name='kind',
            field=models.CharField(
                choices=[('veg', 'Veg'), ('plant', 'Plant')],
                default='veg', max_length=10),
        ),
        migrations.CreateModel(
            name='Plant',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('latin_name', models.CharField(blank=True, default='', max_length=150)),
                ('date_planted', models.DateField(blank=True, null=True)),
                ('about', models.TextField(blank=True, default='')),
                ('water_level', models.CharField(blank=True, default='', max_length=20)),
                ('sun_level', models.CharField(blank=True, default='', max_length=30)),
                ('soil_type', models.CharField(blank=True, default='', max_length=30)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddField(
            model_name='cell',
            name='plant',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='garden.plant'),
        ),
    ]
