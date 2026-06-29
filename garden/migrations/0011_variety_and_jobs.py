import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0010_sow_method_windows'),
    ]

    operations = [
        migrations.AddField(
            model_name='vegentry',
            name='variety',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AlterModelOptions(
            name='vegentry',
            options={'ordering': ['name', 'variety']},
        ),
        migrations.CreateModel(
            name='Job',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('month', models.IntegerField(default=0)),
                ('description', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('plant', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='jobs', to='garden.plant')),
                ('veg', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='jobs', to='garden.vegentry')),
            ],
            options={
                'ordering': ['month', 'id'],
            },
        ),
    ]
