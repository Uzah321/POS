# Production image. Build context is the REPO ROOT (not backend/), because
# the frontend build needs both frontend/ and backend/ present — vite.config.ts's
# outDir is the relative path ../backend/public. See docker-compose.prod.yml.
#
#   docker build -f backend/Dockerfile -t nexapos-backend .

# ---- Stage 1: build the frontend, output lands in backend/public ----------
FROM node:20-alpine AS frontend-build
WORKDIR /repo
COPY frontend/package.json frontend/package-lock.json* frontend/
RUN npm ci --prefix frontend
COPY frontend/ frontend/
COPY backend/public backend/public
RUN npm run build --prefix frontend

# ---- Stage 2: PHP-FPM app image, includes the built frontend --------------
FROM php:8.3-fpm-alpine AS php

RUN apk add --no-cache \
        postgresql-dev libzip-dev libpng-dev libxml2-dev icu-dev oniguruma-dev curl-dev \
    && docker-php-ext-install pdo_pgsql mbstring xml curl zip bcmath gd intl \
    && rm -rf /var/cache/apk/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --optimize-autoloader

COPY backend/ ./
COPY --from=frontend-build /repo/backend/public ./public

# --no-scripts: package:discover needs the app to boot, which needs a real
# .env (deliberately absent from the image — see docker-entrypoint.sh, which
# runs it once actual runtime env is injected).
RUN composer dump-autoload --no-dev --optimize --no-scripts \
    && mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER www-data
EXPOSE 9000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["php-fpm"]

# ---- Stage 3: nginx, serves the same built frontend + proxies to php-fpm --
FROM nginx:alpine AS nginx
COPY --from=frontend-build /repo/backend/public /usr/share/nginx/html
COPY docker/nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
