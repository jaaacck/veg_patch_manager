#!/usr/bin/env bash
set -e

echo "Waiting for postgres at $POSTGRES_HOST:$POSTGRES_PORT..."
while ! nc -z "$POSTGRES_HOST" "$POSTGRES_PORT"; do
  sleep 1
done
echo "Postgres is up."

# Apply committed migrations only. Migrations are authored in development and
# checked into the repo, so we never generate them at runtime (which, with the
# bind mount, would otherwise write stray migration files into your source).
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py seed_defaults
# One-time demo garden (varieties + jobs + a year of history). The --if-empty
# guard means this only runs on a pristine database, never wiping real data.
python manage.py seed_testdata --fresh --if-empty --seed 7

exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --access-logfile -