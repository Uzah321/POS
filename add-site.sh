#!/bin/bash
# =============================================================
# NexaPOS — Add another site (its own subdomain and database)
# next to the main one on this server.
#
#   sudo bash /var/www/nexapos/add-site.sh <name> <domain> ["Company Name"]
#   e.g. sudo bash /var/www/nexapos/add-site.sh mazinyane mazinyane.mycorre.com "Mazinyane Butchery"
#
# The new site shares nothing with the others but the server:
#  - its own checkout in /var/www/<name> (uploads, logos, backups, logs)
#  - its own Postgres database <name>_prod, which only <name>_user can open
#  - its own PHP-FPM pool and Nginx site, with HTTPS from Let's Encrypt
# It starts empty: you set its admin login near the end.
#
# Point the domain at this server first (an A record to its IP), or
# HTTPS is skipped — the script prints the certbot command to run once
# DNS has caught up. Safe to run again for the same name: finished
# steps are kept. sudo nexapos-update then updates every site.
# =============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

usage() {
  echo "Usage: sudo bash add-site.sh <name> <domain> [\"Company Name\"]"
  echo "  name    lowercase letters, digits and _ (e.g. mazinyane) — names the folder and database"
  echo "  domain  the site's address (e.g. mazinyane.mycorre.com)"
  exit 1
}

if [ "${EUID}" -ne 0 ]; then
  exec sudo bash "$0" "$@"
fi

NAME="${1:-}"
DOMAIN="$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]')"
COMPANY="${3:-${NAME^}}"

[[ "${NAME}" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || usage
[[ "${DOMAIN}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || usage
case "${NAME}" in
  nexapos|html|www) error "\"${NAME}\" is taken — pick another name" ;;
esac
# It goes inside double quotes in .env
[[ "${COMPANY}" != *[\"\\\$\`]* ]] || error "The company name can't contain \" \\ \$ or \`"

MAIN_DIR="/var/www/nexapos"
APP_DIR="/var/www/${NAME}"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"
ENV_FILE="${BACKEND_DIR}/.env"
BRANCH="main"
DB_NAME="${NAME}_prod"
DB_USER="${NAME}_user"
FPM_SOCK="/run/php/php8.3-fpm-${NAME}.sock"
POOL_FILE="/etc/php/8.3/fpm/pool.d/${NAME}.conf"
NGINX_FILE="/etc/nginx/sites-available/${NAME}"
REPO_URL="$(git -C "${MAIN_DIR}" remote get-url origin 2>/dev/null || echo https://github.com/Uzah321/POS.git)"

# psql runs as postgres, which can't read most working directories
cd /
pg() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt "$@"; }

for tool in git php composer npm psql nginx openssl; do
  command -v "${tool}" >/dev/null 2>&1 || error "${tool} is not installed — is this the NexaPOS server?"
done

# Another site already answering on this domain would shadow this one
if grep -lE "server_name[^;]*[[:space:]]${DOMAIN//./\\.}[[:space:];]" /etc/nginx/sites-enabled/* 2>/dev/null | grep -vx "/etc/nginx/sites-enabled/${NAME}" >/dev/null; then
  error "${DOMAIN} is already served by another Nginx site in /etc/nginx/sites-enabled"
fi

echo ""
info "Adding ${COMPANY} at https://${DOMAIN}"
info "Folder: ${APP_DIR}   Database: ${DB_NAME}"
echo ""

# ── Code ─────────────────────────────────────────────────────
if [ -d "${APP_DIR}/.git" ]; then
  ok "Code already in ${APP_DIR}"
else
  [ ! -e "${APP_DIR}" ] || error "${APP_DIR} exists but isn't a NexaPOS checkout — move it out of the way first"
  info "Cloning ${REPO_URL} (${BRANCH})..."
  git clone --quiet --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
  ok "Code cloned to ${APP_DIR}"
fi

# ── Database ─────────────────────────────────────────────────
# Keep the password a rerun already wrote into .env
if [ -f "${ENV_FILE}" ]; then
  DB_PASS="$(grep -E '^DB_PASSWORD=' "${ENV_FILE}" | cut -d= -f2- | tr -d '"')"
else
  DB_PASS="$(openssl rand -hex 24)"
fi

if [ "$(pg -c "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'")" = "1" ]; then
  pg -c "ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}'"
else
  pg -c "CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}'"
fi
if [ "$(pg -c "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != "1" ]; then
  pg -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
fi
# Only its owner may connect — not the other sites' database users
pg -c "REVOKE ALL ON DATABASE ${DB_NAME} FROM PUBLIC"
ok "Database ${DB_NAME} ready (user ${DB_USER})"

# ── .env ─────────────────────────────────────────────────────
if [ -f "${ENV_FILE}" ]; then
  ok ".env already written — leaving it as it is"
else
  info "Writing ${ENV_FILE}..."
  cat > "${ENV_FILE}" <<ENV
APP_NAME="${COMPANY}"
APP_ENV=production
APP_KEY=base64:$(openssl rand -base64 32)
APP_DEBUG=false
APP_URL=https://${DOMAIN}

APP_LOCALE=en
APP_FALLBACK_LOCALE=en

BCRYPT_ROUNDS=12
LOG_CHANNEL=stack
LOG_STACK=single
LOG_LEVEL=error

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=${DB_NAME}
DB_USERNAME=${DB_USER}
DB_PASSWORD=${DB_PASS}

SESSION_DRIVER=database
SESSION_LIFETIME=480
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=null

CACHE_STORE=file
QUEUE_CONNECTION=database
FILESYSTEM_DISK=local
BROADCAST_CONNECTION=log

FRONTEND_URL=https://${DOMAIN}
ENV
  chown root:www-data "${ENV_FILE}"
  chmod 640 "${ENV_FILE}"
  ok ".env written"
fi

# ── Backend ──────────────────────────────────────────────────
cd "${BACKEND_DIR}"
info "Installing backend dependencies..."
COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --optimize-autoloader --no-interaction --quiet
ok "Backend dependencies installed"

info "Running database migrations..."
php artisan migrate --force
ok "Migrations complete"

# A factory reset leaves data_reset_at behind, so its absence means the
# admin login hasn't been set yet (first run, or the reset was cancelled)
if [ "$(pg -d "${DB_NAME}" -c "SELECT count(*) FROM settings WHERE key = 'data_reset_at'")" = "0" ]; then
  info "Seeding roles, permissions and reference lists..."
  php artisan db:seed --force
  echo ""
  echo -e "${YELLOW}══════════════════════════════════════════════════════════════${NC}"
  echo -e "  Next: clear the sample records the seeder just added and set"
  echo -e "  ${COMPANY}'s admin login. This only touches the NEW database"
  echo -e "  ${DB_NAME} — the prompt names https://${DOMAIN}."
  echo -e "  When asked, type ${YELLOW}ERASE ALL DATA${NC}, then choose the admin's"
  echo -e "  name, username and password."
  echo -e "${YELLOW}══════════════════════════════════════════════════════════════${NC}"
  echo ""
  php artisan system:factory-reset || error "The admin login wasn't set. Run this script again to retry."
  COMPANY_NAME="${COMPANY}" php artisan tinker --execute='App\Models\Setting::set("company_name", getenv("COMPANY_NAME"), "company");'
  ok "Admin login set; company name is \"${COMPANY}\""
else
  ok "Admin login already set — data left as it is"
fi

php artisan config:cache
php artisan route:cache
php artisan view:cache

# artisan ran as root — hand storage back to the web server
chown -R www-data:www-data "${BACKEND_DIR}/storage" "${BACKEND_DIR}/bootstrap/cache"
find "${BACKEND_DIR}/storage" "${BACKEND_DIR}/bootstrap/cache" -type d -exec chmod 775 {} +
find "${BACKEND_DIR}/storage" "${BACKEND_DIR}/bootstrap/cache" -type f ! -name '.gitignore' -exec chmod 664 {} +
find "${BACKEND_DIR}/storage" "${BACKEND_DIR}/bootstrap/cache" -type f -name '.gitignore' -exec chmod 644 {} +
if [ -d "${BACKEND_DIR}/storage/app/backups" ]; then
  chmod -R go-rwx "${BACKEND_DIR}/storage/app/backups"
fi
ok "Backend ready"

# ── Frontend ─────────────────────────────────────────────────
info "Building the frontend (takes a minute or two)..."
cd "${FRONTEND_DIR}"
npm ci --silent
# Same-origin /api, as update.sh builds it
VITE_API_URL=/api npm run build
[ -f "${BACKEND_DIR}/public/index.html" ] || error "Frontend build did not produce backend/public/index.html"
ok "Frontend built"

# ── PHP-FPM pool ─────────────────────────────────────────────
# Its own workers, so one site's environment never leaks into another's
if [ -f "${POOL_FILE}" ]; then
  ok "PHP-FPM pool already set up"
else
  info "Setting up the PHP-FPM pool..."
  {
    echo "; NexaPOS site ${NAME} (${DOMAIN}) — written by add-site.sh"
    echo "[${NAME}]"
    echo "user = www-data"
    echo "group = www-data"
    echo "listen = ${FPM_SOCK}"
    echo "listen.owner = www-data"
    echo "listen.group = www-data"
    echo "pm = dynamic"
    echo "pm.max_children = 10"
    echo "pm.start_servers = 2"
    echo "pm.min_spare_servers = 1"
    echo "pm.max_spare_servers = 4"
    # Whatever PHP limits the main pool raises (upload size, memory...)
    grep -E '^[[:space:]]*php_(admin_)?(value|flag)\[' /etc/php/8.3/fpm/pool.d/www.conf 2>/dev/null || true
  } > "${POOL_FILE}"
  php-fpm8.3 -t
  systemctl reload php8.3-fpm
  ok "PHP-FPM pool ${NAME} listening on ${FPM_SOCK}"
fi

# ── Nginx ────────────────────────────────────────────────────
# Written once: certbot adds the HTTPS lines to this file afterwards
if [ -f "${NGINX_FILE}" ]; then
  ok "Nginx site already set up"
else
  info "Setting up the Nginx site..."
  cat > "${NGINX_FILE}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # vite.config.ts builds into backend/public, so the React app (index.html)
    # and Laravel (index.php) share one document root.
    root ${BACKEND_DIR}/public;
    index index.html;
    client_max_body_size 50M;

    location ^~ /api {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location ^~ /sanctum {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location = /index.php {
        internal;
        fastcgi_pass unix:${FPM_SOCK};
        fastcgi_param SCRIPT_FILENAME \$document_root/index.php;
        include fastcgi_params;
    }

    # React Router — all other routes go to index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
}
NGINX
  ok "Nginx site written to ${NGINX_FILE}"
fi
ln -sf "${NGINX_FILE}" "/etc/nginx/sites-enabled/${NAME}"
nginx -t
systemctl reload nginx
ok "Nginx reloaded"

# ── HTTPS ────────────────────────────────────────────────────
# Only ask Let's Encrypt once DNS points here — failed attempts are rate-limited
MY_IPS=" $(hostname -I) $(curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true) "
DNS_IP="$(getent ahostsv4 "${DOMAIN}" 2>/dev/null | awk 'NR==1 { print $1 }' || true)"
HTTPS_READY=0
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ] && grep -q "ssl_certificate" "${NGINX_FILE}"; then
  ok "HTTPS already set up"
  HTTPS_READY=1
elif [ -n "${DNS_IP}" ] && [[ "${MY_IPS}" == *" ${DNS_IP} "* ]]; then
  info "Getting an HTTPS certificate for ${DOMAIN}..."
  if certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect; then
    ok "HTTPS set up"
    HTTPS_READY=1
  else
    warn "certbot failed — once fixed, run: sudo certbot --nginx -d ${DOMAIN} --redirect"
  fi
else
  warn "${DOMAIN} doesn't point at this server yet (DNS says: ${DNS_IP:-no record})."
  warn "Add an A record for it pointing at this server's IP, wait for it to resolve, then run:"
  warn "  sudo certbot --nginx -d ${DOMAIN} --redirect"
fi

# ── Health check ─────────────────────────────────────────────
sleep 1
FRONTEND_STATUS="$(curl -skL -o /dev/null -w '%{http_code}' --resolve "${DOMAIN}:80:127.0.0.1" --resolve "${DOMAIN}:443:127.0.0.1" "http://${DOMAIN}/" || true)"
API_STATUS="$(curl -skL -o /dev/null -w '%{http_code}' --resolve "${DOMAIN}:80:127.0.0.1" --resolve "${DOMAIN}:443:127.0.0.1" "http://${DOMAIN}/api/currencies" || true)"
[ "${FRONTEND_STATUS}" = "200" ] || error "Frontend health check failed (HTTP ${FRONTEND_STATUS}) — see /var/log/nginx/error.log"
[ "${API_STATUS}" = "200" ] || error "API health check failed (HTTP ${API_STATUS}) — see ${BACKEND_DIR}/storage/logs/laravel.log"
ok "Health checks passed"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║             SITE ADDED!                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
if [ "${HTTPS_READY}" = "1" ]; then
  echo -e "  🌐  ${COMPANY}: ${GREEN}https://${DOMAIN}${NC}"
else
  echo -e "  🌐  ${COMPANY}: ${YELLOW}https://${DOMAIN}${NC} (after DNS + the certbot step above)"
fi
echo -e "  👤  Sign in with the admin login you just set"
echo -e "  🗄️  Database: ${DB_NAME} (password in ${ENV_FILE})"
echo -e "  ⬆️  Updates: ${YELLOW}sudo nexapos-update${NC} updates every site on this server"
echo -e "  📄  Logs: ${BACKEND_DIR}/storage/logs/laravel.log"
echo ""
