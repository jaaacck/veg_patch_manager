import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0007_feature'),
    ]

    operations = [
        migrations.AlterField(
            model_name='cell',
            name='plant',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='cells', to='garden.plant'),
        ),
    ]
