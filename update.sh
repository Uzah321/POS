#!/bin/bash
# =============================================================
# NexaPOS — One-Command VPS Update Script
# Run on an existing server install as: sudo bash update.sh
# Or after installation: sudo nexapos-update
# =============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

normalize_runtime_repo_state() {
  if [ -f "${APP_DIR}/frontend/.env.production" ] && ! git ls-files --error-unmatch frontend/.env.production >/dev/null 2>&1; then
    rm -f "${APP_DIR}/frontend/.env.production"
  fi

  while IFS= read -r path; do
    [ -n "${path}" ] || continue
    if [ -f "${APP_DIR}/${path}" ]; then
      chmod 644 "${APP_DIR}/${path}" || true
      git checkout -- "${path}" || true
    fi
  done < <(git ls-files backend/storage backend/bootstrap/cache | grep '/\.gitignore$' || true)

  if [ -f "${APP_DIR}/frontend/package-lock.json" ]; then
    git checkout -- frontend/package-lock.json || true
  fi
}

if [ "${EUID}" -ne 0 ]; then
  exec sudo --preserve-env=APP_DIR,BRANCH,PHP_BIN,COMPOSER_BIN,NPM_BIN "$0" "$@"
fi

APP_DIR="${APP_DIR:-/var/www/nexapos}"
BRANCH="${BRANCH:-main}"
PHP_BIN="${PHP_BIN:-php}"
COMPOSER_BIN="${COMPOSER_BIN:-composer}"
NPM_BIN="${NPM_BIN:-npm}"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"
LOCK_FILE="/tmp/nexapos-update.lock"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  error "Another NexaPOS update is already running"
fi

echo -e "${GREEN}"
echo "  _   _                 ____   ___  ____"
echo " | \ | | _____  ____ _ |  _ \ / _ \/ ___|"
echo " |  \| |/ _ \ \/ / _\` || |_) | | | \___ \\"
echo " | |\  |  __/>  < (_| ||  __/| |_| |___) |"
echo " |_| \_|\___/_/\_\__,_||_|    \___/|____/"
echo -e "${NC}"
echo "  Automated Production Update"
echo "  ============================"
echo ""

[ -d "${APP_DIR}/.git" ] || error "Git repository not found at ${APP_DIR}"
[ -d "${BACKEND_DIR}" ] || error "Backend directory not found at ${BACKEND_DIR}"
[ -d "${FRONTEND_DIR}" ] || error "Frontend directory not found at ${FRONTEND_DIR}"
[ -f "${BACKEND_DIR}/.env" ] || error "Backend .env not found at ${BACKEND_DIR}/.env"

command -v git >/dev/null 2>&1 || error "git is not installed"
command -v "${PHP_BIN}" >/dev/null 2>&1 || error "${PHP_BIN} is not installed"
command -v "${COMPOSER_BIN}" >/dev/null 2>&1 || error "${COMPOSER_BIN} is not installed"
command -v "${NPM_BIN}" >/dev/null 2>&1 || error "${NPM_BIN} is not installed"

cd "${APP_DIR}"

normalize_runtime_repo_state

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  error "Tracked local changes exist in ${APP_DIR}; commit or discard them before updating"
fi

info "Fetching latest code from GitHub (${BRANCH})..."
git fetch origin "${BRANCH}" --quiet
CURRENT_COMMIT="$(git rev-parse --short HEAD)"
TARGET_COMMIT="$(git rev-parse --short "origin/${BRANCH}")"

if [ "${CURRENT_COMMIT}" = "${TARGET_COMMIT}" ]; then
  warn "Repository is already at ${TARGET_COMMIT}; continuing to rebuild and refresh services"
else
  info "Updating ${CURRENT_COMMIT} -> ${TARGET_COMMIT}"
fi

git checkout "${BRANCH}" --quiet
git pull --ff-only origin "${BRANCH}"
ok "Code updated to ${TARGET_COMMIT}"

info "Installing backend dependencies..."
cd "${BACKEND_DIR}"
"${COMPOSER_BIN}" install --no-dev --optimize-autoloader --no-interaction --quiet
ok "Backend dependencies installed"

info "Running database migrations..."
"${PHP_BIN}" artisan migrate --force
ok "Database migrations complete"

info "Refreshing Laravel caches..."
"${PHP_BIN}" artisan config:cache
"${PHP_BIN}" artisan route:cache
"${PHP_BIN}" artisan view:cache
ok "Laravel caches refreshed"

info "Setting backend permissions..."
chown -R www-data:www-data "${BACKEND_DIR}/storage" "${BACKEND_DIR}/bootstrap/cache"
find "${BACKEND_DIR}/storage" "${BACKEND_DIR}/bootstrap/cache" -type d -exec chmod 775 {} +
find "${BACKEND_DIR}/storage" "${BACKEND_DIR}/bootstrap/cache" -type f ! -name '.gitignore' -exec chmod 664 {} +
find "${BACKEND_DIR}/storage" "${BACKEND_DIR}/bootstrap/cache" -type f -name '.gitignore' -exec chmod 644 {} +
ok "Permissions updated"

info "Installing frontend dependencies..."
cd "${FRONTEND_DIR}"
if [ ! -f .env.production ]; then
  cat > .env.production <<ENV
VITE_API_URL=/api
VITE_APP_NAME=DiaperMart Store
ENV
fi
if [ -f package-lock.json ]; then
  "${NPM_BIN}" ci --silent
else
  "${NPM_BIN}" install --silent
fi
ok "Frontend dependencies installed"

info "Building frontend..."
"${NPM_BIN}" run build
[ -f "${FRONTEND_DIR}/dist/index.html" ] || error "Frontend build did not produce dist/index.html"
ok "Frontend build complete"

info "Installing update command alias..."
install -m 755 "${APP_DIR}/update.sh" /usr/local/bin/nexapos-update
ok "Command available as: sudo nexapos-update"

if command -v supervisorctl >/dev/null 2>&1 && [ -f /etc/supervisor/conf.d/nexapos-worker.conf ]; then
  info "Restarting queue workers..."
  supervisorctl restart nexapos-worker:* >/dev/null || warn "Queue worker restart failed"
fi

info "Restarting services..."
systemctl restart php8.3-fpm nginx
ok "Services restarted"

APP_URL="$(grep '^APP_URL=' "${BACKEND_DIR}/.env" | cut -d= -f2- | tr -d '"' || true)"
APP_HOST="$(printf '%s' "${APP_URL}" | sed -E 's#^[a-z]+://([^/]+).*$#\1#')"
if [ -z "${APP_HOST}" ] || [ "${APP_HOST}" = "${APP_URL}" ]; then
  APP_HOST="127.0.0.1"
fi

info "Running health checks..."
FRONTEND_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${APP_HOST}" http://127.0.0.1/)"
API_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${APP_HOST}" http://127.0.0.1/api/currencies)"

if [ "${FRONTEND_STATUS}" != "200" ]; then
  error "Frontend health check failed (HTTP ${FRONTEND_STATUS})"
fi

if [ "${API_STATUS}" != "200" ]; then
  error "API health check failed (HTTP ${API_STATUS})"
fi

ok "Frontend health check passed (HTTP ${FRONTEND_STATUS})"
ok "API health check passed (HTTP ${API_STATUS})"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           UPDATE COMPLETE!                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  🔄  Updated to: ${GREEN}${TARGET_COMMIT}${NC}"
echo -e "  🧰  Next update: ${YELLOW}sudo nexapos-update${NC}"
echo -e "  📄  Logs: sudo journalctl -u nginx -u php8.3-fpm -n 100 --no-pager"
echo ""