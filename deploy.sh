#!/bin/bash
# =============================================================
# NexaPOS — Full Automated Deployment Script
# Run on a fresh Ubuntu 24 LTS server as: bash deploy.sh
# =============================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo -e "${GREEN}"
echo "  _   _                 ____   ___  ____"
echo " | \ | | _____  ____ _ |  _ \ / _ \/ ___|"
echo " |  \| |/ _ \ \/ / _\` || |_) | | | \___ \\"
echo " | |\  |  __/>  < (_| ||  __/| |_| |___) |"
echo " |_| \_|\___/_/\_\__,_||_|    \___/|____/"
echo -e "${NC}"
echo "  Automated Production Deployment"
echo "  ================================"
echo ""

# ── Collect config ───────────────────────────────────────────
APP_DIR="/var/www/nexapos"
REPO="https://github.com/Uzah321/POS.git"
SERVER_IP=$(curl -4 -fsS ifconfig.me 2>/dev/null || hostname -I | tr ' ' '\n' | grep -m1 -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || hostname -I | awk '{print $1}')

read -p "Enter domain or IP for this server [${SERVER_IP}]: " DOMAIN
DOMAIN=${DOMAIN:-$SERVER_IP}

read -s -p "Enter a PostgreSQL password to create (or press Enter for auto-generated): " DB_PASS
echo ""
if [ -z "$DB_PASS" ]; then
  DB_PASS=$(openssl rand -base64 18 | tr -d '=/+' | head -c 20)
  warn "Auto-generated DB password: ${DB_PASS}  ← save this!"
fi

echo ""
info "Deploying to: http://${DOMAIN}"
info "App directory: ${APP_DIR}"
echo ""

# ── Update system ─────────────────────────────────────────────
info "Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get upgrade -y -qq
ok "System updated"

# ── Install PHP 8.3 ──────────────────────────────────────────
info "Installing PHP 8.3..."
apt-get install -y -qq software-properties-common
add-apt-repository -y ppa:ondrej/php >/dev/null 2>&1
apt-get update -qq
apt-get install -y -qq \
  php8.3 php8.3-fpm php8.3-pgsql php8.3-mbstring php8.3-xml \
  php8.3-curl php8.3-zip php8.3-bcmath php8.3-tokenizer \
  php8.3-gd php8.3-intl php8.3-readline
ok "PHP 8.3 installed: $(php8.3 --version | head -1)"

# ── Install PostgreSQL ───────────────────────────────────────
info "Installing PostgreSQL..."
apt-get install -y -qq postgresql postgresql-contrib
systemctl enable --now postgresql
ok "PostgreSQL installed: $(psql --version)"

# ── Install Node.js 20 ───────────────────────────────────────
info "Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
apt-get install -y -qq nodejs
ok "Node.js installed: $(node --version)"

# ── Install Nginx ────────────────────────────────────────────
info "Installing Nginx..."
apt-get install -y -qq nginx
ok "Nginx installed"

# ── Install Composer ─────────────────────────────────────────
info "Installing Composer..."
curl -sS https://getcomposer.org/installer | php -- --quiet
mv composer.phar /usr/local/bin/composer
chmod +x /usr/local/bin/composer
ok "Composer installed: $(composer --version 2>/dev/null | head -1)"

# ── Install other tools ──────────────────────────────────────
apt-get install -y -qq git unzip curl wget
ok "Git and utilities installed"

# ── PostgreSQL database setup ────────────────────────────────
info "Setting up PostgreSQL database..."
sudo -u postgres psql -c "DROP DATABASE IF EXISTS nexapos_prod;" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS nexapos_user;" 2>/dev/null || true
sudo -u postgres psql <<EOSQL
CREATE DATABASE nexapos_prod;
CREATE USER nexapos_user WITH ENCRYPTED PASSWORD '${DB_PASS}';
GRANT ALL PRIVILEGES ON DATABASE nexapos_prod TO nexapos_user;
\c nexapos_prod
GRANT ALL ON SCHEMA public TO nexapos_user;
EOSQL
ok "Database 'nexapos_prod' and user 'nexapos_user' created"

# ── Clone repository ─────────────────────────────────────────
info "Cloning repository from GitHub..."
rm -rf "$APP_DIR"
git clone "$REPO" "$APP_DIR" --quiet
ok "Repository cloned to $APP_DIR"

# ── Install update command ───────────────────────────────────
if [ -f "$APP_DIR/update.sh" ]; then
  install -m 755 "$APP_DIR/update.sh" /usr/local/bin/nexapos-update
  ok "Update command installed: sudo nexapos-update"
fi

# ── Backend setup ────────────────────────────────────────────
info "Installing PHP dependencies..."
cd "$APP_DIR/backend"
composer install --no-dev --optimize-autoloader --quiet
ok "Composer dependencies installed"

# ── Generate app key ─────────────────────────────────────────
APP_KEY=$(php artisan key:generate --show 2>/dev/null || echo "base64:$(openssl rand -base64 32)")

# ── Write .env ───────────────────────────────────────────────
info "Writing production .env..."
cat > "$APP_DIR/backend/.env" <<ENV
APP_NAME="NexaPOS"
APP_ENV=production
APP_KEY=${APP_KEY}
APP_DEBUG=false
APP_URL=http://${DOMAIN}

APP_LOCALE=en
APP_FALLBACK_LOCALE=en

BCRYPT_ROUNDS=12
LOG_CHANNEL=stack
LOG_STACK=single
LOG_LEVEL=error

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=nexapos_prod
DB_USERNAME=nexapos_user
DB_PASSWORD=${DB_PASS}

SESSION_DRIVER=database
SESSION_LIFETIME=480
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=null

CACHE_STORE=database
QUEUE_CONNECTION=database
FILESYSTEM_DISK=local
BROADCAST_CONNECTION=log

FRONTEND_URL=http://${DOMAIN}
VITE_APP_NAME="NexaPOS"
ENV
ok ".env written"

# ── Run migrations & seed ────────────────────────────────────
info "Running database migrations..."
cd "$APP_DIR/backend"
php artisan migrate --force
ok "Migrations complete"

info "Seeding initial data..."
php artisan db:seed --force 2>/dev/null && ok "Database seeded" || warn "Seeder not found — skipping"

# ── Cache for production ─────────────────────────────────────
info "Caching config and routes..."
php artisan config:cache
php artisan route:cache
php artisan view:cache
ok "Caches built"

# ── Permissions ──────────────────────────────────────────────
info "Setting file permissions..."
chown -R www-data:www-data "$APP_DIR/backend/storage"
chown -R www-data:www-data "$APP_DIR/backend/bootstrap/cache"
find "$APP_DIR/backend/storage" "$APP_DIR/backend/bootstrap/cache" -type d -exec chmod 775 {} +
find "$APP_DIR/backend/storage" "$APP_DIR/backend/bootstrap/cache" -type f ! -name '.gitignore' -exec chmod 664 {} +
find "$APP_DIR/backend/storage" "$APP_DIR/backend/bootstrap/cache" -type f -name '.gitignore' -exec chmod 644 {} +
ok "Permissions set"

# ── Build frontend ───────────────────────────────────────────
info "Installing frontend dependencies..."
cd "$APP_DIR/frontend"
if [ -f package-lock.json ]; then
  npm ci --silent
else
  npm install --silent
fi
ok "npm install complete"

info "Building React frontend (this takes ~1 min)..."
# Point the built frontend's API calls to /api on the same server
cat > .env.production <<ENV
VITE_API_URL=/api
VITE_APP_NAME=NexaPOS
ENV
npm run build
ok "Frontend built → $APP_DIR/frontend/dist"

# ── Nginx config ─────────────────────────────────────────────
info "Configuring Nginx..."
cat > /etc/nginx/sites-available/nexapos <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    # Serve built React app
    root ${APP_DIR}/frontend/dist;
    index index.html;

    # Laravel backend — handle /api/*
    location ~ ^/api(/.*)?$ {
        root ${APP_DIR}/backend/public;
        try_files \$uri \$uri/ /index.php?\$query_string;

        location ~ \.php\$ {
            fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;
            fastcgi_param SCRIPT_FILENAME ${APP_DIR}/backend/public/index.php;
            fastcgi_param REQUEST_URI \$request_uri;
            fastcgi_param DOCUMENT_ROOT ${APP_DIR}/backend/public;
            include fastcgi_params;
        }
    }

    # Also serve /sanctum for CSRF
    location /sanctum {
        root ${APP_DIR}/backend/public;
        try_files \$uri \$uri/ /index.php?\$query_string;
        location ~ \.php\$ {
            fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;
            fastcgi_param SCRIPT_FILENAME ${APP_DIR}/backend/public/index.php;
            include fastcgi_params;
        }
    }

    # React Router — all other routes go to index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    client_max_body_size 50M;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/nexapos /etc/nginx/sites-enabled/nexapos
nginx -t && systemctl reload nginx
systemctl enable nginx php8.3-fpm
ok "Nginx configured and reloaded"

# ── Firewall ─────────────────────────────────────────────────
info "Configuring firewall..."
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true
ok "Firewall configured"

# ── Final health check ───────────────────────────────────────
info "Running health check..."
sleep 2
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1/api/currencies" 2>/dev/null)
if [ "$HTTP_STATUS" = "200" ]; then
  ok "API health check passed (HTTP ${HTTP_STATUS})"
else
  warn "API returned HTTP ${HTTP_STATUS} — check logs: sudo tail -50 /var/log/nginx/error.log"
fi

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         DEPLOYMENT COMPLETE!                 ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  🌐  App URL:   ${GREEN}http://${DOMAIN}${NC}"
echo -e "  📋  API URL:   ${GREEN}http://${DOMAIN}/api${NC}"
echo ""
echo -e "  👤  Login credentials:"
echo -e "      Username: ${YELLOW}admin${NC}     Password: ${YELLOW}Admin@123${NC}"
echo -e "      Username: ${YELLOW}manager${NC}   Password: ${YELLOW}Manager@123${NC}"
echo -e "      Username: ${YELLOW}cashier1${NC}  Password: ${YELLOW}Cashier@123${NC}"
echo ""
echo -e "  🗄️  Database password: ${YELLOW}${DB_PASS}${NC}  ← save this!"
echo ""
echo -e "  ⬆️  Future updates: ${YELLOW}sudo nexapos-update${NC}"
echo -e "  📄  Logs: sudo tail -f /var/log/nginx/error.log"
echo -e "  🔄  Restart: sudo systemctl restart php8.3-fpm nginx"
echo ""
