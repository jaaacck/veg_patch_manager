from django.db import models


class VegEntry(models.Model):
    key = models.CharField(max_length=80, primary_key=True)
    name = models.CharField(max_length=100)
    latin_name = models.CharField(max_length=120, blank=True, default="")
    emoji = models.CharField(max_length=8, blank=True, default="")
    image = models.ImageField(upload_to='veg_images/', null=True, blank=True)
    sow_where = models.CharField(max_length=30, default='Outdoors')
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
    """A named raised bed: a rows x cols grid of square-foot cells."""
    name = models.CharField(max_length=100)
    rows = models.IntegerField(default=4)
    cols = models.IntegerField(default=4)
    last_composted = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return self.name


class Cell(models.Model):
    """One square-foot square within a Plot. Holds a single vegetable planting."""
    plot = models.ForeignKey(Plot, related_name='cells', on_delete=models.CASCADE)
    position = models.IntegerField()  # 0-based, row-major index within the plot grid
    veg = models.ForeignKey(
        VegEntry, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='cells'
    )
    date_sewed = models.DateField(null=True, blank=True)
    seeds_planted = models.IntegerField(default=0)
    total_harvested = models.IntegerField(default=0)
    total_failed = models.IntegerField(default=0)
    total_weight_g = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['plot', 'position']
        unique_together = [('plot', 'position')]

    def __str__(self):
        return f"{self.plot.name} · cell {self.position}"


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

    # Anchored to the Plot for charting (survives cell deletion on resize);
    # cell is kept for the per-square modal but nulled if its cell is removed.
    plot = models.ForeignKey(Plot, related_name='history', on_delete=models.CASCADE)
    cell = models.ForeignKey(
        Cell, related_name='history', null=True, blank=True,
        on_delete=models.SET_NULL
    )
    event_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    date = models.DateField()
    veg_name = models.CharField(max_length=120, blank=True, default="")
    veg_key = models.CharField(max_length=80, blank=True, default="")
    count = models.IntegerField(default=0)
    weight_g = models.IntegerField(default=0)
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-created_at']
