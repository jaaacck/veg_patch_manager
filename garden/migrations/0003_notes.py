from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0002_plot_last_composted'),
    ]

    operations = [
        migrations.AddField(
            model_name='plot',
            name='notes',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='historyentry',
            name='note',
            field=models.TextField(blank=True, default=''),
        ),
    ]
