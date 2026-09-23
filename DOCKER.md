# Docker

Two separate stacks. Neither touches the bare-metal VPS path (`deploy.sh` /
`update.sh`) — pick whichever fits.

## Development

Reproduces the native setup 1:1: backend on `:8080`, frontend on `:5173`,
talking to each other exactly like `php artisan serve` + `npm run dev` do —
so `backend/.env` and `frontend/.env.development` work unmodified.

```bash
docker compose up
```

- `http://localhost:5173` — the app
- `http://localhost:8080` — the API directly
- `localhost:5433` — Postgres, for a local GUI client (user/pass/db:
  `nexapos` / `nexapos123` / `nexapos`, matching `backend/.env`). Not 5432,
  since that's likely already taken by a native Postgres install.

First run installs Composer/npm dependencies and seeds the database
automatically (only when the `users` table is empty — safe to restart
without re-seeding). Both `vendor/` and `node_modules/` live in named Docker
volumes, not on the host, so container-installed platform-specific packages
never fight with whatever's installed natively on your machine.

Source is bind-mounted, so editing a file on the host live-reloads inside
the container — no rebuild needed unless you change a `Dockerfile.dev` or
add a new system dependency.

To reset the database: `docker compose down -v` (drops the named volumes,
including `pgdata`) then `docker compose up` again.

## Production

Multi-stage build: one stage compiles the frontend into `backend/public`
(same single-server layout the app already uses — see
`frontend/vite.config.ts`'s `outDir`), a second stage is the PHP-FPM app, a
third is nginx serving the built assets and proxying `/api` + `/sanctum` to
PHP-FPM. No queue-worker or cron container — the app doesn't use either
right now.

**One-time setup:**
```bash
cp backend/.env.production.example backend/.env
# Edit backend/.env: APP_KEY (php artisan key:generate --show), DB_PASSWORD,
# APP_URL/FRONTEND_URL/SANCTUM_STATEFUL_DOMAINS for your real domain,
# SESSION_SECURE_COOKIE=true if serving over HTTPS.
```

**Build and run:**
```bash
docker compose --env-file backend/.env -f docker-compose.prod.yml build
docker compose --env-file backend/.env -f docker-compose.prod.yml up -d
```

`--env-file backend/.env` is required every time you run a `docker compose
...prod.yml` command — Compose only auto-loads a `.env` next to the compose
file itself, and this project's is under `backend/`.

Migrations, config/route/view caching all run automatically on container
start (`backend/docker-entrypoint.sh`), so a fresh deploy just needs the
image rebuilt and the stack brought back up:
```bash
docker compose --env-file backend/.env -f docker-compose.prod.yml up -d --build
```

Put this behind a reverse proxy or add TLS termination (e.g. Caddy, or
certbot + a real nginx TLS block) for HTTPS — the bundled `nginx.conf` is
plain HTTP only, matching what `deploy.sh` starts with too.
