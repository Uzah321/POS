#!/bin/bash
# =============================================================
# NexaPOS — One-Command VPS Update Script
# Run on an existing server install as: sudo bash update.sh
# Or after installation: sudo nexapos-update
#
# Updates every NexaPOS site on the server — each checkout in
# /var/www/* (the main one, and any added with add-site.sh).
# To update just one: sudo APP_DIR=/var/www/<name> nexapos-update
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
  # Older deploy.sh runs overwrote the tracked file; the server build now passes
  # VITE_API_URL via the environment instead.
  git checkout -- frontend/.env.production 2>/dev/null || true

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

MAIN_DIR="/var/www/nexapos"
BRANCH="${BRANCH:-main}"
PHP_BIN="${PHP_BIN:-php}"
COMPOSER_BIN="${COMPOSER_BIN:-composer}"
NPM_BIN="${NPM_BIN:-npm}"
LOCK_FILE="/tmp/nexapos-update.lock"

# The main site goes first: it's the demo, so a bad migration shows up
# there before it reaches a client's site.
SITES=()
if [ -n "${APP_DIR:-}" ]; then
  SITES=("${APP_DIR%/}")
else
  if [ -d "${MAIN_DIR}" ]; then
    SITES+=("${MAIN_DIR}")
  fi
  for dir in /var/www/*/; do
    dir="${dir%/}"
    if [ "${dir}" != "${MAIN_DIR}" ] && [ -d "${dir}/.git" ] && [ -f "${dir}/backend/artisan" ] && [ -f "${dir}/backend/.env" ]; then
      SITES+=("${dir}")
    fi
  done
fi
[ "${#SITES[@]}" -gt 0 ] || error "No NexaPOS site found in /var/www — set APP_DIR to where it is"

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

command -v git >/dev/null 2>&1 || error "git is not installed"
command -v "${PHP_BIN}" >/dev/null 2>&1 || error "${PHP_BIN} is not installed"
command -v "${COMPOSER_BIN}" >/dev/null 2>&1 || error "${COMPOSER_BIN} is not installed"
command -v "${NPM_BIN}" >/dev/null 2>&1 || error "${NPM_BIN} is not installed"

info "Sites to update: ${SITES[*]}"

update_site() {
  APP_DIR="$1"
  BACKEND_DIR="${APP_DIR}/backend"
  FRONTEND_DIR="${APP_DIR}/frontend"

  echo ""
  info "━━━ ${APP_DIR} ━━━"

  [ -d "${APP_DIR}/.git" ] || error "Git repository not found at ${APP_DIR}"
  [ -d "${BACKEND_DIR}" ] || error "Backend directory not found at ${BACKEND_DIR}"
  [ -d "${FRONTEND_DIR}" ] || error "Frontend directory not found at ${FRONTEND_DIR}"
  [ -f "${BACKEND_DIR}/.env" ] || error "Backend .env not found at ${BACKEND_DIR}/.env"

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
  if [ -f package-lock.json ]; then
    "${NPM_BIN}" ci --silent
  else
    "${NPM_BIN}" install --silent
  fi
  ok "Frontend dependencies installed"

  info "Building frontend..."
  # The tracked .env.production targets the desktop build's local server
  # (127.0.0.1:8080); on the VPS the API is same-origin /api. Process env wins
  # over .env files in Vite, so this overrides it without touching the file.
  VITE_API_URL=/api "${NPM_BIN}" run build
  # vite.config.ts sets outDir to ../backend/public (single-server layout) — build output
  # lands there, not in frontend/dist.
  [ -f "${BACKEND_DIR}/public/index.html" ] || error "Frontend build did not produce backend/public/index.html"
  ok "Frontend build complete"
}

# Returns non-zero instead of exiting, so every site gets checked
check_site() {
  local backend_dir="$1/backend" app_url app_host frontend_status api_status
  app_url="$(grep '^APP_URL=' "${backend_dir}/.env" | cut -d= -f2- | tr -d '"' || true)"
  app_host="$(printf '%s' "${app_url}" | sed -E 's#^[a-z]+://([^/]+).*$#\1#')"
  if [ -z "${app_host}" ] || [ "${app_host}" = "${app_url}" ]; then
    app_host="127.0.0.1"
  fi

  frontend_status="$(curl -skL -o /dev/null -w '%{http_code}' --resolve "${app_host}:80:127.0.0.1" --resolve "${app_host}:443:127.0.0.1" "http://${app_host}/" || true)"
  api_status="$(curl -skL -o /dev/null -w '%{http_code}' --resolve "${app_host}:80:127.0.0.1" --resolve "${app_host}:443:127.0.0.1" "http://${app_host}/api/currencies" || true)"

  if [ "${frontend_status}" != "200" ] || [ "${api_status}" != "200" ]; then
    warn "${app_host}: health check failed (frontend HTTP ${frontend_status}, API HTTP ${api_status})"
    return 1
  fi
  ok "${app_host}: frontend and API healthy (HTTP 200)"
}

for site in "${SITES[@]}"; do
  update_site "${site}"
done

echo ""
info "Installing update command alias..."
install -m 755 "${SITES[0]}/update.sh" /usr/local/bin/nexapos-update
ok "Command available as: sudo nexapos-update"

if command -v supervisorctl >/dev/null 2>&1 && [ -f /etc/supervisor/conf.d/nexapos-worker.conf ]; then
  info "Restarting queue workers..."
  supervisorctl restart nexapos-worker:* >/dev/null || warn "Queue worker restart failed"
fi

info "Restarting services..."
systemctl restart php8.3-fpm nginx
ok "Services restarted"

info "Running health checks..."
FAILED=()
for site in "${SITES[@]}"; do
  check_site "${site}" || FAILED+=("${site}")
done
[ "${#FAILED[@]}" -eq 0 ] || error "Health check failed for: ${FAILED[*]} — logs: <site>/backend/storage/logs/laravel.log, /var/log/nginx/error.log"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           UPDATE COMPLETE!                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  🔄  Updated to: ${GREEN}${TARGET_COMMIT}${NC}"
echo -e "  🌐  Sites: ${GREEN}${SITES[*]}${NC}"
echo -e "  🧰  Next update: ${YELLOW}sudo nexapos-update${NC}"
echo -e "  📄  Logs: sudo journalctl -u nginx -u php8.3-fpm -n 100 --no-pager"
echo ""
