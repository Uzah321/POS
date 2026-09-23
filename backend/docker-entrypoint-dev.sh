#!/usr/bin/env bash
# Dev entrypoint: install deps only if missing (vendor/ is a named volume, so
# this is a no-op on every restart after the first), migrate, seed only on a
# truly fresh database, then serve.
set -e

if [ ! -f vendor/autoload.php ]; then
  echo "[backend] Installing Composer dependencies..."
  composer install
fi

mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache

echo "[backend] Waiting for Postgres..."
until php -r "new PDO('pgsql:host='.getenv('DB_HOST').';port='.getenv('DB_PORT').';dbname='.getenv('DB_DATABASE'), getenv('DB_USERNAME'), getenv('DB_PASSWORD'));" 2>/dev/null; do
  sleep 1
done
echo "[backend] Postgres is up."

php artisan migrate --force

USER_COUNT="$(php artisan tinker --execute='echo \App\Models\User::count();' 2>/dev/null | tail -1)"
if [ "$USER_COUNT" = "0" ]; then
  echo "[backend] Fresh database — seeding..."
  php artisan db:seed --force
fi

echo "[backend] Starting dev server on 0.0.0.0:8080"
# Not `artisan serve` — it spawns the actual request-handling process with
# only a hardcoded env allowlist (APP_ENV, PATH, ...), silently dropping the
# DB_HOST=postgres override from docker-compose.yml and falling back to
# whatever's literally in the bind-mounted .env file (127.0.0.1, for native
# dev). Running PHP's built-in server directly inherits the full container
# environment. Same router script and docroot (public/) ServeCommand itself
# uses (Process($cmd, public_path(), ...) — cwd matters, index.php is resolved
# relative to it), just without the env-stripping subprocess boundary.
cd public
exec php -S 0.0.0.0:8080 /app/vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php
