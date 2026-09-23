#!/bin/sh
# Prod entrypoint. Config/route/view caching happens here (not at image build
# time) because it depends on the real runtime .env — baking it into the
# image would freeze in whatever placeholder values were present at build.
set -e

echo "[backend] Waiting for Postgres..."
until php -r "new PDO('pgsql:host='.getenv('DB_HOST').';port='.getenv('DB_PORT').';dbname='.getenv('DB_DATABASE'), getenv('DB_USERNAME'), getenv('DB_PASSWORD'));" 2>/dev/null; do
  sleep 1
done
echo "[backend] Postgres is up."

php artisan package:discover --ansi
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache

exec "$@"
