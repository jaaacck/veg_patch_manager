from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0005_plant_beds'),
    ]

    operations = [
        migrations.AddField(
            model_name='plot',
            name='layout_x',
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='plot',
            name='layout_y',
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
