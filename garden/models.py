from django.db import models
from django.dispatch import receiver


class VegEntry(models.Model):
    key = models.CharField(max_length=80, primary_key=True)
    name = models.CharField(max_length=100)
    latin_name = models.CharField(max_length=120, blank=True, default="")
    emoji = models.CharField(max_length=8, blank=True, default="")
    image = models.ImageField(upload_to='veg_images/', null=True, blank=True)
    # Legacy single sow window (kept for backups/compat; the UI now uses the
    # per-method windows below).
    sow_where = models.CharField(max_length=30, default='Sow outdoors')
    sow_start = models.IntegerField(default=0)
    sow_end = models.IntegerField(default=0)
    # Per-method sow windows (month numbers 1-12; 0 = not applicable).
    sow_outdoors_start = models.IntegerField(default=0)
    sow_outdoors_end = models.IntegerField(default=0)
    sow_covered_start = models.IntegerField(default=0)
    sow_covered_end = models.IntegerField(default=0)
    sow_indoors_start = models.IntegerField(default=0)
    sow_indoors_end = models.IntegerField(default=0)
    plant_out_start = models.IntegerField(default=0)
    plant_out_end = models.IntegerField(default=0)
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
    """A named raised bed: a rows x cols grid of squares.

    `kind` decides what a square holds: a vegetable planting ('veg') or an
    ornamental Plant ('plant').
    """
    VEG = 'veg'
    PLANT = 'plant'
    KIND_CHOICES = [(VEG, 'Veg'), (PLANT, 'Plant')]

    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=VEG)
    rows = models.IntegerField(default=4)
    cols = models.IntegerField(default=4)
    last_composted = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    # Position on the garden Designer canvas, in grid units (1 unit = 1 square foot).
    layout_x = models.IntegerField(null=True, blank=True)
    layout_y = models.IntegerField(null=True, blank=True)
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
    # In a 'plant' bed the square holds an ornamental Plant from the catalogue.
    # related_name='cells' makes the relation bidirectional (plant.cells).
    plant = models.ForeignKey(
        'Plant', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='cells'
    )
    date_sown = models.DateField(null=True, blank=True)
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


class Plant(models.Model):
    """An ornamental plant occupying one square of a 'plant' bed."""
    name = models.CharField(max_length=120)
    latin_name = models.CharField(max_length=150, blank=True, default="")
    date_planted = models.DateField(null=True, blank=True)
    about = models.TextField(blank=True, default="")
    water_level = models.CharField(max_length=20, blank=True, default="")
    sun_level = models.CharField(max_length=30, blank=True, default="")
    soil_type = models.CharField(max_length=30, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Feature(models.Model):
    """A non-bed element on the garden Designer map (path, shed, lawn, pond, etc.).

    Position (x, y) and size (w, h) are in grid units — 1 unit = 1 square foot.
    """
    kind = models.CharField(max_length=20, default='other')
    label = models.CharField(max_length=60, blank=True, default="")
    x = models.IntegerField(default=0)
    y = models.IntegerField(default=0)
    w = models.IntegerField(default=2)
    h = models.IntegerField(default=2)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.label or self.kind


@receiver(models.signals.post_delete, sender=Cell)
def _cleanup_cell_plant(sender, instance, **kwargs):
    """Delete the attached Plant when its square is removed (resize / bed delete)."""
    if instance.plant_id:
        Plant.objects.filter(pk=instance.plant_id).delete()
