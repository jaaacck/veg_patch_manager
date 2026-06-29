# 🌱 Square Foot Garden — Django + Docker Compose

A self-hosted Django port of the Square Foot Garden planner. All data lives in PostgreSQL via Django models, served by a Django REST Framework API and a single-page front-end.

## Features
- **📚 Guide** — month-by-month planting calendar generated from your vegetable DB. Click any plant for full details.
- **🌱 Garden** — interactive 4×4 raised-bed grid. Track sowing date, seeds planted, harvested totals, failure totals, and full history per plot.
- **⚙️ Settings** — edit the vegetable database (latin names, sow/harvest months, plants per sq ft, days to harvest, notes, custom emoji or uploaded photo).
- **🔍 Plant search** with autocomplete by common or Latin name.
- **🧺 / ❌ Record buttons** for harvest and failure with running totals + activity log.
- **📥 / 📤 Backup & Restore** as a single JSON file.

## Quick start

```bash
# 1. (Optional) edit .env to change DB credentials / SECRET_KEY
# A working .env is included so you can skip this for a quick test.

# 2. Build and start everything
docker compose up --build

# 3. Open the app
http://localhost:8000
```

First run takes a minute or two: it builds the image, starts Postgres, runs migrations, collects static files and seeds the database with 72 default vegetables and 16 empty plots.

## Admin

```bash
docker compose exec web python manage.py createsuperuser
```

Then visit http://localhost:8000/admin to manage VegEntry / Plot / HistoryEntry records directly.

## API endpoints

All under `/api/`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/veg/` | List all vegetables |
| POST | `/api/veg/` | Create a vegetable |
| GET / PATCH / DELETE | `/api/veg/<key>/` | Retrieve / update / delete |
| POST | `/api/veg/<key>/upload_image/` | Multipart image upload |
| POST | `/api/veg/<key>/remove_image/` | Remove image |
| GET | `/api/plots/` | List all 16 plots (with nested veg + history) |
| PATCH | `/api/plots/<index>/` | Update plot (`veg_key`, `date_sown`, `seeds_planted`, `notes`) |
| POST | `/api/plots/<index>/record_harvest/` | Body `{count}` → adds to total_harvested |
| POST | `/api/plots/<index>/record_failure/` | Body `{count}` → adds to total_failed |
| POST | `/api/plots/<index>/clear_plot/` | Clear veg/date/seeds, preserve totals + history |
| POST | `/api/plots/<index>/reset_totals/` | Zero totals + delete history |
| POST | `/api/plots/reset_all/` | Reset every plot |
| GET | `/api/backup/` | Full backup as JSON `{plots, veg_db, exported_at}` |
| POST | `/api/backup/restore/` | Restore from a previous backup |

## Data model

- **VegEntry** — `key` (slug, primary key), name, latin_name, emoji, image, sow_where (`Sow indoors` / `Sow outdoors` / `Sow outdoors (covered)` / `Plant out seedlings`), sow_start/end, harvest_start/end, per_sq_ft, days_to_harvest, notes
- **Plot** — `index` 0–15 (primary key), FK to VegEntry, date_sown, seeds_planted, total_harvested, total_failed, notes (per-square growing notes)
- **HistoryEntry** — FK to Plot, event_type (planted/harvested/failed/cleared), date, veg_name snapshot, count

## Persistence

Docker volumes:
- `postgres_data` — the PostgreSQL database
- `media_volume` — uploaded vegetable images
- `static_volume` — collected static files

```bash
docker compose down       # stop, data is kept
docker compose down -v    # ⚠️ wipes all volumes and data
```

You can also use the in-app **📥 Backup** button to download a portable JSON snapshot at any time.

## Development tips

```bash
# Run migrations after model changes
docker compose exec web python manage.py makemigrations
docker compose exec web python manage.py migrate

# Open a Django shell
docker compose exec web python manage.py shell

# Re-seed (idempotent — won't overwrite existing rows)
docker compose exec web python manage.py seed_defaults
```

## File layout

```
.
├── docker-compose.yml
├── Dockerfile
├── entrypoint.sh
├── requirements.txt
├── manage.py
├── .env
├── config/                # Django project settings
└── garden/                # Application
    ├── models.py
    ├── serializers.py
    ├── views.py
    ├── urls.py
    ├── admin.py
    ├── management/commands/seed_defaults.py
    ├── templates/garden/index.html
    └── static/garden/{app.css, app.js}
```
