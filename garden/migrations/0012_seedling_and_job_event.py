import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0011_variety_and_jobs'),
    ]

    operations = [
        migrations.AlterField(
            model_name='historyentry',
            name='event_type',
            field=models.CharField(
                choices=[('planted', 'Planted'), ('harvested', 'Harvested'),
                         ('failed', 'Failed'), ('cleared', 'Cleared'), ('job', 'Job done')],
                max_length=20),
        ),
        migrations.CreateModel(
            name='Seedling',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date_sown', models.DateField(blank=True, null=True)),
                ('amount', models.IntegerField(default=0)),
                ('sprouted', models.IntegerField(default=0)),
                ('failed', models.IntegerField(default=0)),
                ('notes', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('veg', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='seedlings', to='garden.vegentry')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
