from django.db import models


class VegEntry(models.Model):
    key = models.CharField(max_length=80, primary_key=True)
    name = models.CharField(max_length=100)
    latin_name = models.CharField(max_length=120, blank=True, default="")
    emoji = models.CharField(max_length=8, blank=True, default="")
    image = models.ImageField(upload_to='veg_images/', null=True, blank=True)
    sow_where = models.CharField(max_length=30, default='Sow outdoors')
    sow_start = models.IntegerField(default=0)
    sow_end = models.IntegerField(default=0)
    harvest_start = models.IntegerField(default=0)
    harvest_end = models.IntegerField(default=0)
    per_sq_ft = models.FloatField(default=1)
    days_to_harvest = models.IntegerField(default=60)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Plot(models.Model):
    index = models.IntegerField(primary_key=True)
    veg = models.ForeignKey(
        VegEntry, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='plots'
    )
    date_sown = models.DateField(null=True, blank=True)
    seeds_planted = models.IntegerField(default=0)
    total_harvested = models.IntegerField(default=0)
    total_failed = models.IntegerField(default=0)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['index']

    def __str__(self):
        return f"Plot {self.index}"


class HistoryEntry(models.Model):
    PLANTED = 'planted'
    HARVESTED = 'harvested'
    FAILED = 'failed'
    CLEARED = 'cleared'
    TYPE_CHOICES = [
        (PLANTED, 'Planted'),
        (HARVESTED, 'Harvested'),
        (FAILED, 'Failed'),
        (CLEARED, 'Cleared'),
    ]

    plot = models.ForeignKey(Plot, related_name='history', on_delete=models.CASCADE)
    event_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    date = models.DateField()
    veg_name = models.CharField(max_length=120, blank=True, default="")
    count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-created_at']
