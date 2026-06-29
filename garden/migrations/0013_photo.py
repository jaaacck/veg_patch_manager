import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('garden', '0012_seedling_and_job_event'),
    ]

    operations = [
        migrations.CreateModel(
            name='Photo',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('image', models.ImageField(upload_to='cell_photos/')),
                ('caption', models.CharField(blank=True, default='', max_length=200)),
                ('taken_on', models.DateField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('cell', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='photos', to='garden.cell')),
            ],
            options={
                'ordering': ['-taken_on', '-created_at'],
            },
        ),
    ]
