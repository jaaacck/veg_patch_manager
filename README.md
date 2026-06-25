# 🌱 Square Foot Garden — Django + Docker Compose

A self-hosted Django port of the Square Foot Garden planner. All data lives in PostgreSQL via Django models, served by a Django REST Framework API and a single-page front-end.

## Features
- **📚 Guide** — month-by-month planting calendar generated from your vegetable DB. Click any plant for full details.
- **🌱 Garden** — create **multiple named, sized raised beds** (plots). Each plot is a `rows × cols` grid of square-foot squares. Switch between plots, rename, resize, or delete them. Track sowing date, seeds planted, harvested totals, failure totals, and full history per square.
- **📊 Data** — an analytics dashboard with an always-on **Overview** summary and two tabs:
  - **🟩 Beds** — per-bed, with collapsible sections (each shows a one-line stat preview when collapsed): a **yield heatmap of every square** (toggle harvested / success-rate / failures, click a square for its full crop history over time), best/weakest-square rankings, a vegetable performance table (success rate, squares used, actual days-to-harvest), a **plant × square matrix**, and a monthly harvest timeline.
  - **🥕 Plants** — every crop's cross-bed performance: harvested/failed, success rate, squares & beds used, average days-to-harvest, a per-bed breakdown, its best-performing squares, and its sow/harvest window.
- **🗓️ Sow Chart** — a sow/harvest calendar generated from your vegetable database: each veg gets a row of bars across the 12 months showing its sow window (green), harvest window (orange), or both. Filterable by name; click a row for full plant details.
- **⚙️ Settings** — edit the vegetable database (latin names, sow/harvest months, plants per sq ft, days to harvest, notes, custom emoji or uploaded photo).
- **🔍 Plant search** with autocomplete by common or Latin name.
- **🧺 / ❌ Record buttons** for harvest and failure with running totals + activity log.
- **📥 / 📤 Backup & Restore** as a single JSON file (the export doubles as your chartable dataset).

## Quick start

```bash
# 1. (Optional) edit .env to change DB credentials / SECRET_KEY
# A working .env is included so you can skip this for a quick test.

# 2. Build and start everything
docker compose up --build

# 3. Open the app
http://localhost:8008
```

First run takes a minute or two: it builds the image, starts Postgres, runs migrations, collects static files and seeds the database with 72 default vegetables and one default 4×4 plot ("Main Bed"). Open it on the host at **http://localhost:8008** (Compose maps host `8008` → container `8000`).

> **Upgrading from the single-grid version?** The data model changed (one fixed grid → multiple named, sized plots), so an existing database must be reset with `docker compose down -v`. To keep your data, export a **📥 Backup** with the old version first, then **📤 Restore** it after upgrading — the new restore reads the old format and loads it into a "Main Bed" 4×4 plot.

## Authentication (optional)

By default the app is open — intended for a private home network. To require a login,
set `REQUIRE_AUTH=1` in `.env` and create a user:

```bash
docker compose exec web python manage.py createsuperuser
docker compose restart web
```

Every request (except `/admin` and static files) then needs HTTP Basic credentials —
the browser shows its own login prompt, so there's no separate login screen. Turning
auth on also disables wide-open CORS.

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
| GET | `/api/plots/` | List all plots (with nested cells, veg + history) |
| POST | `/api/plots/` | Create a plot — body `{name, rows, cols}`; auto-creates `rows×cols` squares |
| GET / PATCH / DELETE | `/api/plots/<id>/` | Retrieve / rename + resize (`name`, `rows`, `cols`) / delete |
| POST | `/api/plots/<id>/reset/` | Clear every square in the plot + wipe its totals/history |
| GET | `/api/plots/<id>/stats/` | Charting payload (totals, per-vegetable, timeline) |
| PATCH | `/api/cells/<id>/` | Update a square (`veg_key`, `date_sewed`, `seeds_planted`) |
| POST | `/api/cells/<id>/record_harvest/` | Body `{count}` → adds to total_harvested |
| POST | `/api/cells/<id>/record_failure/` | Body `{count}` → adds to total_failed |
| POST | `/api/cells/<id>/clear_plot/` | Clear veg/date/seeds, preserve totals + history |
| POST | `/api/cells/<id>/reset_totals/` | Zero totals + delete that square's history |
| GET | `/api/backup/` | Full backup as JSON `{plots, veg_db, exported_at}` |
| POST | `/api/backup/restore/` | Restore from a backup (accepts old single-grid and new multi-plot formats) |

## Data model

- **VegEntry** — `key` (slug, primary key), name, latin_name, emoji, image, sow_where, sow_start/end, harvest_start/end, per_sq_ft, days_to_harvest, notes
- **Plot** — a named raised bed: `name`, `rows`, `cols` (size in square-foot squares), created_at/updated_at
- **Cell** — one square within a plot: FK to Plot, `position` (0-based, row-major), FK to VegEntry, date_sewed, seeds_planted, total_harvested, total_failed
- **HistoryEntry** — FK to **Plot** (charting anchor; survives resizes) + FK to **Cell** (nulled if the square is removed), event_type (planted/harvested/failed/cleared), date, veg_name + veg_key snapshot, count

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

# Generate a realistic year of sample data across every bed
docker compose exec web python manage.py seed_testdata --fresh

# Run the API test suite
docker compose exec web python manage.py test garden
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
