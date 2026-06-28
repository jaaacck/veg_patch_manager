from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0003_notes'),
    ]

    operations = [
        migrations.AddField(
            model_name='cell',
            name='total_weight_g',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='historyentry',
            name='weight_g',
            field=models.IntegerField(default=0),
        ),
    ]
