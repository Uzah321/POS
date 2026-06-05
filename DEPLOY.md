# NexaPOS — Production Deployment Guide (PostgreSQL)

## Requirements

| Requirement | Version |
|---|---|
| PHP | 8.3+ |
| PostgreSQL | 14+ |
| Node.js | 18+ |
| Composer | 2.x |
| Web server | Nginx (recommended) or Apache |

---

## Step 1 — PostgreSQL Setup

```sql
-- Run as postgres superuser
CREATE DATABASE nexapos_prod;
CREATE USER nexapos_user WITH ENCRYPTED PASSWORD 'STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON DATABASE nexapos_prod TO nexapos_user;
\c nexapos_prod
GRANT ALL ON SCHEMA public TO nexapos_user;
```

---

## Step 2 — Clone & Configure Backend

```bash
cd /var/www
git clone <your-repo> nexapos
cd nexapos/backend

# Install PHP dependencies
composer install --no-dev --optimize-autoloader

# Copy and edit environment file
cp .env.production.example .env
nano .env   # Fill in all values, especially DB_* and APP_KEY

# Generate app key (if not already set)
php artisan key:generate

# Run database migrations
php artisan migrate --force

# Seed initial data (first time only)
php artisan db:seed --force

# Cache config for performance
php artisan config:cache
php artisan route:cache
php artisan view:cache

# Set permissions
chown -R www-data:www-data /var/www/nexapos/backend
chmod -R 755 /var/www/nexapos/backend/storage
chmod -R 755 /var/www/nexapos/backend/bootstrap/cache
```

---

## Step 3 — Build Frontend

```bash
cd /var/www/nexapos/frontend

# Set production API URL in vite.config.ts or use environment variable
# Edit vite.config.ts: change proxy target to your production backend URL
# OR set VITE_API_URL and use it in axios config

npm install
npm run build
# Output goes to: frontend/dist/
```

---

## Step 4 — Nginx Configuration

```nginx
# /etc/nginx/sites-available/nexapos

# Backend API
server {
    listen 80;
    server_name api.your-domain.com;
    root /var/www/nexapos/backend/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    client_max_body_size 50M;   # for Excel imports
}

# Frontend (serve built React app)
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/nexapos/frontend/dist;
    index index.html;

    # All routes go to index.html (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable and reload:
```bash
ln -s /etc/nginx/sites-available/nexapos /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## Step 5 — SSL (HTTPS) with Let's Encrypt

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d your-domain.com -d api.your-domain.com
```

After SSL, update `.env`:
```
APP_URL=https://api.your-domain.com
FRONTEND_URL=https://your-domain.com
SESSION_SECURE_COOKIE=true
```

---

## Step 6 — Queue Worker (for background jobs)

```bash
# /etc/supervisor/conf.d/nexapos-worker.conf
[program:nexapos-worker]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/nexapos/backend/artisan queue:work database --sleep=3 --tries=3 --timeout=90
autostart=true
autorestart=true
user=www-data
numprocs=2
redirect_stderr=true
stdout_logfile=/var/log/nexapos-worker.log
```

```bash
supervisorctl reread
supervisorctl update
supervisorctl start nexapos-worker:*
```

---

## Step 7 — Frontend API URL (Single-Server vs Split)

**Option A — Same domain with /api prefix (simplest):**
- Backend served at `https://your-domain.com/api/`
- Frontend served at `https://your-domain.com/`
- In `vite.config.ts` set `proxy.target` to your production backend, or just build with relative `/api` paths (already the case)

**Option B — Separate subdomains:**
- Backend: `https://api.your-domain.com`
- Frontend: `https://your-domain.com`
- Update `frontend/src/lib/axios.ts` baseURL to `https://api.your-domain.com/api`

---

## Step 8 — Migrate from SQLite to PostgreSQL

If you have existing data in SQLite that you want to move:

```bash
# Export from SQLite
php artisan db:seed --class=MigrateFromSqliteSeeder  # if you write one

# Or use a tool like pgloader:
pgloader sqlite:///var/www/nexapos/backend/database/bottlestore.sqlite \
         pgsql://nexapos_user:PASSWORD@localhost/nexapos_prod
```

Otherwise just run fresh migrations:
```bash
php artisan migrate:fresh --force
php artisan db:seed --force
```

---

## Environment Checklist

- [ ] `APP_ENV=production`
- [ ] `APP_DEBUG=false`
- [ ] `APP_KEY` is set (php artisan key:generate)
- [ ] `DB_CONNECTION=pgsql` and all DB_* values set
- [ ] `SESSION_SECURE_COOKIE=true` (HTTPS only)
- [ ] `FRONTEND_URL` set to production frontend domain
- [ ] `APP_URL` set to production backend domain
- [ ] `php artisan config:cache` run after each .env change
- [ ] `php artisan route:cache` run
- [ ] Supervisor running queue worker
- [ ] SSL certificates installed
- [ ] File permissions: `storage/` and `bootstrap/cache/` writable by www-data

---

## Updating the Application

Preferred one-command update on the VPS:

```bash
sudo nexapos-update
```

If the command alias has not been installed yet:

```bash
cd /var/www/nexapos
sudo bash update.sh
```

What it does:
- pulls the latest code from `origin/main`
- installs backend dependencies
- runs `php artisan migrate --force`
- refreshes Laravel caches
- installs frontend dependencies and rebuilds `frontend/dist`
- restarts `php8.3-fpm` and `nginx`
- verifies both `/` and `/api/currencies`

Manual fallback:

```bash
cd /var/www/nexapos

# Pull latest code
git pull --ff-only origin main

# Backend
cd backend
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
supervisorctl restart nexapos-worker:*

# Frontend
cd ../frontend
npm install
npm run build
```
