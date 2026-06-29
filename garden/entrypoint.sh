#!/usr/bin/env bash
set -e

echo "Waiting for postgres at $POSTGRES_HOST:$POSTGRES_PORT..."
while ! nc -z "$POSTGRES_HOST" "$POSTGRES_PORT"; do
  sleep 1
done
echo "Postgres is up."

python manage.py makemigrations garden --noinput
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py seed_defaults

exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --access-logfile -