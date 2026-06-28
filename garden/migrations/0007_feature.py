from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0006_plot_layout'),
    ]

    operations = [
        migrations.CreateModel(
            name='Feature',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(default='other', max_length=20)),
                ('label', models.CharField(blank=True, default='', max_length=60)),
                ('x', models.IntegerField(default=0)),
                ('y', models.IntegerField(default=0)),
                ('w', models.IntegerField(default=2)),
                ('h', models.IntegerField(default=2)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['id'],
            },
        ),
    ]
