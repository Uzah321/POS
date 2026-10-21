#!/bin/bash
# =============================================================
# NexaPOS — Factory reset: ERASES ALL DATA AND USERS
# Run on the server as: sudo bash /var/www/nexapos/factory-reset.sh
# It resets the site it's in: /var/www/<name>/factory-reset.sh resets
# that site (see add-site.sh) and leaves the others alone.
#
# Keeps the licences and the ZIMRA fiscal registration, backs the
# database up into backend/storage/app/backups first, and asks you to
# type ERASE ALL DATA and set the new admin login before anything is
# erased. See backend/app/Console/Commands/FactoryReset.php
# =============================================================
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  exec sudo --preserve-env=APP_DIR,PHP_BIN "$0" "$@"
fi

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"
PHP_BIN="${PHP_BIN:-php}"
BACKEND_DIR="${APP_DIR}/backend"

[ -f "${BACKEND_DIR}/artisan" ] || { echo "NexaPOS backend not found at ${BACKEND_DIR}" >&2; exit 1; }
cd "${BACKEND_DIR}"

status=0
"${PHP_BIN}" artisan system:factory-reset "$@" || status=$?

# artisan ran as root — hand storage (logs, the backup) back to the web
# server, and keep the backup readable by it alone
chown -R www-data:www-data storage bootstrap/cache
if [ -d storage/app/backups ]; then
  chmod -R go-rwx storage/app/backups
fi
exit "${status}"
