from django.core.management.base import BaseCommand
from django.utils.text import slugify
from garden.models import VegEntry, Plot, Cell


DEFAULTS = [
    ('Tomatoes', 'Solanum lycopersicum', '🍅', 'Sow indoors',2, 4, 7, 10, 1, 75, 'Pinch out side shoots on cordon varieties. Feed weekly once flowers appear.'),
    ('Carrots', 'Daucus carota', '🥕', 'Sow outdoors',3, 7, 6, 10, 16, 70, 'Sow thinly in stone-free soil. Cover with fleece to deter carrot fly.'),
    ('Lettuce', 'Lactuca sativa', '🥬', 'Sow indoors',3, 8, 5, 10, 4, 50, 'Sow little and often for a continuous supply. Bolts in hot weather.'),
    ('Salad leaves', 'Mixed cultivars', '🥬', 'Sow indoors',3, 9, 4, 10, 9, 30, 'Cut-and-come-again. Harvest outer leaves to extend the crop.'),
    ('Spinach', 'Spinacia oleracea', '🥬', 'Sow outdoors',3, 9, 5, 10, 9, 45, 'Prefers cool weather. Pick young leaves regularly.'),
    ('Broccoli', 'Brassica oleracea var. italica', '🥦', 'Sow indoors',2, 5, 6, 10, 1, 90, 'Cut the central head first to encourage side shoots.'),
    ('Purple sprouting broccoli', 'Brassica oleracea var. italica', '🥦', 'Sow outdoors',4, 6, 2, 4, 1, 300, 'Hardy winter crop. Harvest spears before flowers open.'),
    ('Cauliflower', 'Brassica oleracea var. botrytis', '🥦', 'Sow indoors',3, 6, 6, 10, 1, 100, 'Bend outer leaves over the curd to keep it white.'),
    ('Cabbage', 'Brassica oleracea var. capitata', '🥬', 'Sow outdoors',3, 7, 6, 2, 1, 90, 'Firm in plants well. Net against cabbage white butterflies.'),
    ('Brussels sprouts', 'Brassica oleracea var. gemmifera', '🥬', 'Sow outdoors',3, 4, 10, 2, 1, 180, 'Stake tall plants. Best flavour after a frost.'),
    ('Kale', 'Brassica oleracea var. acephala', '🥬', 'Sow outdoors',3, 6, 7, 3, 1, 75, 'Extremely hardy. Pick leaves from the bottom up.'),
    ('Kalettes', 'Brassica oleracea hybrid', '🥬', 'Sow indoors',4, 5, 11, 2, 1, 140, 'Cross between kale and Brussels sprouts. Harvest small rosettes.'),
    ('Pak choi', 'Brassica rapa subsp. chinensis', '🥬', 'Sow outdoors',4, 8, 5, 10, 4, 45, 'Fast-growing. Bolts if sown too early - wait for warm weather.'),
    ('Chinese cabbage', 'Brassica rapa subsp. pekinensis', '🥬', 'Sow outdoors',6, 8, 9, 11, 1, 70, 'Sow in summer for autumn harvest.'),
    ('Lambs lettuce', 'Valerianella locusta', '🥬', 'Sow outdoors',8, 10, 10, 3, 9, 60, 'Winter-hardy salad. Sow under cover in cold areas.'),
    ('Chicory', 'Cichorium intybus', '🥬', 'Sow outdoors',6, 7, 9, 1, 4, 100, 'Force roots in darkness for winter chicons.'),
    ('Swiss chard', 'Beta vulgaris subsp. vulgaris', '🌿', 'Sow outdoors',4, 7, 6, 11, 4, 55, 'Colourful stems. Cut-and-come-again throughout the season.'),
    ('Cucumber', 'Cucumis sativus', '🥒', 'Sow indoors',4, 5, 7, 9, 2, 60, 'Pinch out tip of main stem above 7th leaf. Keep well-watered.'),
    ('Courgette', 'Cucurbita pepo', '🥒', 'Sow indoors',4, 5, 7, 10, 1, 55, 'Pick young and often to keep plants productive.'),
    ('Aubergine', 'Solanum melongena', '🍆', 'Sow indoors',2, 4, 7, 10, 1, 120, 'Needs warmth. Best grown in greenhouse or polytunnel in UK.'),
    ('Peppers (sweet)', 'Capsicum annuum', '🫑', 'Sow indoors',2, 4, 7, 10, 1, 90, 'Pinch out growing tip to encourage bushy plants.'),
    ('Sweet peppers', 'Capsicum annuum', '🫑', 'Sow indoors',2, 4, 7, 10, 1, 90, 'Pinch out growing tip to encourage bushy plants.'),
    ('Chillies', 'Capsicum spp.', '🌶️', 'Sow indoors',1, 3, 7, 10, 1, 120, 'Sow early. Heat increases as fruits ripen from green to red.'),
    ('Sweetcorn', 'Zea mays', '🌽', 'Sow indoors',4, 5, 8, 10, 1, 90, 'Plant in blocks not rows for good wind pollination.'),
    ('Pumpkin', 'Cucurbita maxima', '🎃', 'Sow indoors',4, 5, 9, 10, 0.25, 120, 'Needs lots of space and feeding. Cure in sun before storing.'),
    ('Pumpkins', 'Cucurbita maxima', '🎃', 'Sow indoors',4, 5, 9, 10, 0.25, 120, 'Needs lots of space and feeding. Cure in sun before storing.'),
    ('Butternut squash', 'Cucurbita moschata', '🎃', 'Sow indoors',4, 5, 9, 11, 0.25, 120, 'Long season. Best in a sunny sheltered spot.'),
    ('Squash', 'Cucurbita spp.', '🎃', 'Sow indoors',4, 5, 8, 10, 0.25, 100, 'Mulch heavily. Train vines onto supports to save space.'),
    ('Marrow', 'Cucurbita pepo', '🎃', 'Sow indoors',4, 5, 7, 10, 0.25, 90, 'Pick regularly to keep them coming. Lift fruits onto a brick.'),
    ('Potatoes', 'Solanum tuberosum', '🥔', 'Sow outdoors',3, 4, 6, 10, 1, 90, 'Earth up as shoots emerge. Water well in dry weather.'),
    ('First early potatoes', 'Solanum tuberosum', '🥔', 'Sow outdoors',2, 3, 6, 7, 1, 80, 'Quick-growing. Chitting before planting gives an earlier crop.'),
    ('Second early potatoes', 'Solanum tuberosum', '🥔', 'Sow outdoors',3, 4, 7, 8, 1, 100, 'Slightly later than first earlies. Good for new potatoes.'),
    ('Maincrop potatoes', 'Solanum tuberosum', '🥔', 'Sow outdoors',3, 5, 8, 10, 1, 120, 'Longer growing season. Better for storage and baking.'),
    ('Onions', 'Allium cepa', '🧅', 'Sow outdoors',3, 4, 7, 9, 9, 120, 'Stop watering once tops yellow. Dry off well before storing.'),
    ('Spring onions', 'Allium cepa', '🧅', 'Sow outdoors',3, 7, 5, 10, 16, 60, 'Sow in succession every 2-3 weeks for continuous picking.'),
    ('Spring onion', 'Allium cepa', '🧅', 'Sow outdoors',3, 7, 5, 10, 16, 60, 'Sow in succession every 2-3 weeks for continuous picking.'),
    ('Autumn planting onion sets', 'Allium cepa', '🧅', 'Sow outdoors',9, 11, 7, 8, 9, 240, 'Overwinter for an early summer crop.'),
    ('Spring planting onion sets', 'Allium cepa', '🧅', 'Sow outdoors',3, 4, 8, 9, 9, 120, 'Plant sets just below soil with tip exposed.'),
    ('Autumn planting shallot sets', 'Allium cepa var. aggregatum', '🧅', 'Sow outdoors',10, 11, 6, 7, 9, 210, 'Plant in autumn for an early harvest the following summer.'),
    ('Spring planting shallot sets', 'Allium cepa var. aggregatum', '🧅', 'Sow outdoors',2, 4, 7, 8, 9, 120, 'Each set produces a cluster of bulbs.'),
    ('Garlic', 'Allium sativum', '🧄', 'Sow outdoors',10, 3, 6, 8, 9, 240, 'Needs a cold spell to form bulbs. Plant cloves pointed end up.'),
    ('Spring planting garlic', 'Allium sativum', '🧄', 'Sow outdoors',1, 3, 7, 8, 9, 180, 'Suitable for milder areas. Smaller bulbs than autumn-planted.'),
    ('Autumn planting garlic', 'Allium sativum', '🧄', 'Sow outdoors',10, 12, 6, 8, 9, 240, 'Plant before Christmas for the best yields.'),
    ('Leeks', 'Allium ampeloprasum', '🌿', 'Sow outdoors',3, 5, 9, 3, 4, 170, 'Drop seedlings into 15cm holes for long white shanks.'),
    ('Leek', 'Allium ampeloprasum', '🌿', 'Sow outdoors',3, 5, 9, 3, 4, 170, 'Drop seedlings into 15cm holes for long white shanks.'),
    ('Beetroot', 'Beta vulgaris', '🥕', 'Sow outdoors',3, 7, 6, 10, 9, 70, "Sow direct. Thin seedlings as 'clusters' produce multiple roots."),
    ('Radish', 'Raphanus sativus', '🥕', 'Sow outdoors',3, 8, 4, 10, 16, 30, 'Fast crop. Sow every 2 weeks for a constant supply.'),
    ('Turnip', 'Brassica rapa subsp. rapa', '🥕', 'Sow outdoors',3, 7, 6, 10, 9, 60, 'Best picked young and tender. Avoid woody large roots.'),
    ('Turnips', 'Brassica rapa subsp. rapa', '🥕', 'Sow outdoors',3, 7, 6, 10, 9, 60, 'Best picked young and tender. Avoid woody large roots.'),
    ('Swede', 'Brassica napus subsp. rapifera', '🥕', 'Sow outdoors',4, 6, 9, 2, 4, 90, 'Hardy winter root. Sweeter after a frost.'),
    ('Parsnips', 'Pastinaca sativa', '🥕', 'Sow outdoors',2, 4, 9, 2, 9, 180, 'Slow to germinate. Use fresh seed each year. Lift after first frost.'),
    ('Parsnip', 'Pastinaca sativa', '🥕', 'Sow outdoors',2, 4, 9, 2, 9, 180, 'Slow to germinate. Use fresh seed each year. Lift after first frost.'),
    ('Celeriac', 'Apium graveolens var. rapaceum', '🥕', 'Sow indoors',2, 4, 9, 12, 1, 180, 'Remove side shoots and keep moist for large root balls.'),
    ('Celery', 'Apium graveolens var. dulce', '🌿', 'Sow indoors',3, 4, 8, 10, 4, 140, 'Self-blanching types are easiest. Needs rich, moist soil.'),
    ('Fennel', 'Foeniculum vulgare', '🌿', 'Sow outdoors',4, 7, 7, 10, 4, 85, 'Earth up as bulbs swell. Bolts if stressed.'),
    ('Kohl rabi', 'Brassica oleracea var. gongylodes', '🫛', 'Sow outdoors',3, 8, 5, 10, 4, 55, 'Pick when tennis-ball sized for best flavour.'),
    ('Broad beans', 'Vicia faba', '🫛', 'Sow outdoors',2, 4, 5, 8, 8, 120, 'Pinch out tops once pods set to deter blackfly.'),
    ('Broad bean', 'Vicia faba', '🫛', 'Sow outdoors',2, 4, 5, 8, 8, 120, 'Pinch out tops once pods set to deter blackfly.'),
    ('French beans', 'Phaseolus vulgaris', '🫛', 'Sow indoors',4, 7, 7, 10, 9, 60, 'Sow after frosts. Pick young pods regularly.'),
    ('French bean', 'Phaseolus vulgaris', '🫛', 'Sow indoors',4, 7, 7, 10, 9, 60, 'Sow after frosts. Pick young pods regularly.'),
    ('Runner beans', 'Phaseolus coccineus', '🫛', 'Sow indoors',4, 5, 7, 10, 8, 80, 'Tall climbers - need sturdy supports up to 2m+.'),
    ('Peas', 'Pisum sativum', '🫛', 'Sow outdoors',3, 6, 5, 8, 8, 70, 'Support with netting or twiggy sticks. Pick to keep cropping.'),
    ('Asparagus', 'Asparagus officinalis', '🌿', 'Sow outdoors',3, 4, 4, 6, 1, 730, 'Wait 2 years before harvesting. Lasts 20+ years once established.'),
    ('Asparagus crowns', 'Asparagus officinalis', '🌿', 'Sow outdoors',3, 4, 4, 6, 1, 730, 'Plant crowns in trenches with ridges. Mulch annually.'),
    ('Jerusalem artichoke', 'Helianthus tuberosus', '🌿', 'Sow outdoors',2, 4, 10, 3, 1, 180, 'Vigorous - can become invasive. Lift tubers as needed in winter.'),
    ('Globe artichoke', 'Cynara cardunculus var. scolymus', '🌿', 'Sow outdoors',3, 5, 6, 8, 1, 180, 'Harvest heads before scales open. Cut down stems after cropping.'),
    ('Globe artichokes', 'Cynara cardunculus var. scolymus', '🌿', 'Sow outdoors',3, 5, 6, 8, 1, 180, 'Harvest heads before scales open. Cut down stems after cropping.'),
    ('Oca root', 'Oxalis tuberosa', '🥕', 'Sow outdoors',4, 5, 10, 12, 1, 240, 'South American tuber. Lift after frost blackens foliage.'),
    ('Yacon root', 'Smallanthus sonchifolius', '🥕', 'Sow outdoors',4, 5, 10, 11, 1, 210, 'Sweet crunchy tubers. Lift before hard frosts.'),
    ('Mint', 'Mentha spp.', '🌿', 'Sow indoors',3, 5, 5, 10, 1, 90, 'Best grown in a pot - spreads aggressively if planted out.'),
    ('Thyme', 'Thymus vulgaris', '🌿', 'Sow indoors',2, 5, 5, 10, 4, 90, 'Loves dry, sunny conditions. Trim after flowering.'),
    ('Lemon verbena', 'Aloysia citrodora', '🌿', 'Sow indoors',3, 4, 6, 10, 1, 120, 'Tender perennial. Move indoors over winter.')
]


def _sow_windows(sow_where, ss, se):
    """Route a veg's single sow window into the matching per-method window."""
    w = {
        'sow_outdoors_start': 0, 'sow_outdoors_end': 0,
        'sow_covered_start': 0, 'sow_covered_end': 0,
        'sow_indoors_start': 0, 'sow_indoors_end': 0,
        'plant_out_start': 0, 'plant_out_end': 0,
    }
    if not (ss and se):
        return w
    sw = (sow_where or '').strip().lower()
    if sw == 'sow indoors':
        w['sow_indoors_start'], w['sow_indoors_end'] = ss, se
    elif sw == 'sow outdoors (covered)':
        w['sow_covered_start'], w['sow_covered_end'] = ss, se
    elif sw == 'plant out seedlings':
        w['plant_out_start'], w['plant_out_end'] = ss, se
    else:
        w['sow_outdoors_start'], w['sow_outdoors_end'] = ss, se
    return w


class Command(BaseCommand):
    help = "Seed default VegEntry rows (72 vegetables) and a default 4x4 plot if missing."

    def handle(self, *args, **kwargs):
        created_veg = 0
        for (name, latin, emoji, sow_where, ss, se, hs, he, persqft, days, notes) in DEFAULTS:
            key = slugify(name)[:80] or 'veg'
            obj, was_created = VegEntry.objects.get_or_create(
                key=key,
                defaults=dict(
                    name=name,
                    latin_name=latin,
                    emoji=emoji,
                    sow_where=sow_where,
                    sow_start=ss,
                    sow_end=se,
                    harvest_start=hs,
                    harvest_end=he,
                    per_sq_ft=persqft,
                    days_to_harvest=days,
                    notes=notes,
                    **_sow_windows(sow_where, ss, se),
                ),
            )
            if was_created:
                created_veg += 1

        # Create one default 4x4 bed only if the user has no plots yet.
        created_plots = 0
        if not Plot.objects.exists():
            plot = Plot.objects.create(name='Main Bed', rows=4, cols=4)
            Cell.objects.bulk_create(
                [Cell(plot=plot, position=i) for i in range(plot.rows * plot.cols)]
            )
            created_plots = 1

        self.stdout.write(self.style.SUCCESS(
            f"seed_defaults: {created_veg} vegetables, {created_plots} plots created"
        ))
