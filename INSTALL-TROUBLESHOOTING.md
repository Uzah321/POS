# Core POS — Installation Troubleshooting & Recovery Guide

This document records every error encountered when deploying Core POS to a new machine,
the root cause of each, and the exact commands used to fix them.

---

## Table of Contents

1. [Login page shows "NexaPOS" instead of "Core"](#1-login-page-shows-nexapos-instead-of-core)
2. [500 Server Error after hard refresh](#2-500-server-error-after-hard-refresh)
3. [500 Server Error on new machine — missing .env](#3-500-server-error-on-new-machine--missing-env)
4. ["8-bit characters may not work properly" warning](#4-8-bit-characters-may-not-work-properly-warning)
5. [pdo_sqlite MISSING — PHP cannot connect to database](#5-pdo_sqlite-missing--php-cannot-connect-to-database)
6. [.env file not created by installer](#6-env-file-not-created-by-installer)
7. [Seeder fails — "table users has no column named branch_id"](#7-seeder-fails--table-users-has-no-column-named-branch_id)
8. [Login returns 422 / Invalid credentials after fresh install](#8-login-returns-422--invalid-credentials-after-fresh-install)
9. [Rebuilding the installer after fixes](#9-rebuilding-the-installer-after-fixes)
10. [Full recovery script for a broken install](#10-full-recovery-script-for-a-broken-install)

---

## 1. Login page shows "NexaPOS" instead of "Core"

**Symptom:** The login page title and branding still shows "NexaPOS" after the rebrand.

**Root cause:** The frontend was built before the rebrand. The old bundles in
`backend/public/assets/` were still being served.

**Fix:** Rebuild the frontend so it outputs the updated branding.

```powershell
# Run on dev machine from the project root
cd frontend
npm run build
```

Also ensure `backend/.env` has:
```
APP_NAME=Core
```

---

## 2. 500 Server Error after hard refresh

**Symptom:** App appeared to work normally, then showed 500 after Ctrl+Shift+R.

**Root cause:** The PWA service worker was caching all pages. A hard refresh bypassed
the service worker and revealed a pre-existing 500 error (missing .env or broken config).

**Fix:** Diagnose the actual Laravel error using the log (see Section 3), then clear
Laravel's cache and restart PHP.

```powershell
$p="C:\POS\php\php.exe"; $c="C:\POS\php\php.ini"; $a="C:\POS\backend\artisan"
& $p -c $c $a config:clear
& $p -c $c $a config:cache
& $p -c $c $a route:cache
& $p -c $c $a view:cache
Get-Process php -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process "C:\POS\start-pos.bat"
```

---

## 3. 500 Server Error on new machine — missing .env

**Symptom:** Fresh install shows 500 immediately. Laravel log says:
```
No application encryption key has been specified.
```

**Root cause:** `install.ps1` did not create `C:\POS\backend\.env`. This happens when
the Inno Setup `[Run]` step fails silently (PowerShell execution policy, UAC, or the
script errored before writing the file).

**Fix:** Create the .env manually and run the artisan setup commands.

```powershell
# Step 1 — Create .env
@(
  "APP_NAME=Core",
  "APP_ENV=production",
  "APP_KEY=",
  "APP_DEBUG=false",
  "APP_URL=http://localhost:8080",
  "",
  "LOG_CHANNEL=single",
  "LOG_LEVEL=error",
  "",
  "DB_CONNECTION=sqlite",
  "DB_DATABASE=C:\POS\backend\database\database.sqlite",
  "",
  "SESSION_DRIVER=file",
  "QUEUE_CONNECTION=sync",
  "CACHE_STORE=file"
) | Set-Content "C:\POS\backend\.env" -Encoding UTF8

# Step 2 — Generate app key and set up database
$p="C:\POS\php\php.exe"; $c="C:\POS\php\php.ini"; $a="C:\POS\backend\artisan"
& $p -c $c $a key:generate --force
& $p -c $c $a migrate --force
& $p -c $c $a db:seed --force
& $p -c $c $a config:cache
& $p -c $c $a route:cache
& $p -c $c $a view:cache

# Step 3 — Restart PHP
Get-Process php -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process "C:\POS\start-pos.bat"
```

---

## 4. "8-bit characters may not work properly" warning

**Symptom:** When PHP runs artisan commands, it prints a warning about 8-bit characters.
The server returns 500 errors.

**Root cause:** `extension_dir` was commented out in `php.ini`. Without it, PHP cannot
find `mbstring.dll` (and all other extension DLLs). PHP warns about 8-bit character
handling as a side effect.

The line in `php.ini` looks like:
```
; extension_dir = "ext"
```
and needs to become:
```
extension_dir = "C:\POS\php\ext"
```

**Fix:**

```powershell
$i = [System.IO.File]::ReadAllText("C:\POS\php\php.ini")
$i = $i -replace '(?m)^[; ]*extension_dir\s*=\s*"[^"]*"', 'extension_dir = "C:\POS\php\ext"'
[System.IO.File]::WriteAllText("C:\POS\php\php.ini", $i, [System.Text.Encoding]::UTF8)
Write-Host "extension_dir fixed"
```

After this, restart the PHP process (see Section 2 restart commands).

---

## 5. pdo_sqlite MISSING — PHP cannot connect to database

**Symptom:** Running the diagnostic command returns `pdo_sqlite: MISSING`.
The app crashes with a database driver error.

**Root cause:** The bundled `php.ini` had PostgreSQL extensions enabled (`pdo_pgsql`)
but not SQLite extensions. This was a bug in `installer/rebuild-installer.ps1` —
its else branch enabled the wrong extension list.

**Fix (on the problem machine):**

```powershell
$i = [System.IO.File]::ReadAllText("C:\POS\php\php.ini")
$i = $i -replace '(?m)^[; ]*extension_dir\s*=\s*"[^"]*"', 'extension_dir = "C:\POS\php\ext"'
$i = $i -replace ';extension=pdo_sqlite', 'extension=pdo_sqlite'
$i = $i -replace ';extension=sqlite3',    'extension=sqlite3'
$i = $i -replace ';extension=mbstring',   'extension=mbstring'
$i = $i -replace ';extension=openssl',    'extension=openssl'
[System.IO.File]::WriteAllText("C:\POS\php\php.ini", $i, [System.Text.Encoding]::UTF8)
Write-Host "php.ini fixed"
```

**Permanent fix (already applied in source):** `installer/rebuild-installer.ps1` line 101
was changed from `pdo_pgsql` to `pdo_sqlite` so the next `Core-Setup.exe` build is correct.

---

## 6. .env file not created by installer

**Symptom:** Diagnostic shows `.env MISSING` even though the installer appeared to finish.

**Root cause:** The Inno Setup post-install step runs `install.ps1` via PowerShell.
If the script errors before reaching Step 4 (e.g. because PHP extensions weren't loading
and `key:generate` failed), the `.env` write is skipped.

Also fixed in source: `install.ps1` now always deletes and recreates the SQLite database
file before running migrations, preventing stale-state failures from repeat install attempts.

**Manual fix:** See Section 3 — the .env creation and artisan commands there cover this.

---

## 7. Seeder fails — "table users has no column named branch_id"

**Symptom:** During `db:seed --force`, the error appears:
```
SQLSTATE[HY000]: General error: 1 table users has no column named branch_id
```

**Root cause:** A previous (partial) installation had already run `0001_01_01_000000_create_users_table`
and recorded it in the `migrations` table, but that run used an older schema without `branch_id`.
When the installer ran again, Laravel skipped that migration (already recorded as done) so
the `branch_id` column was never created.

**Fix:** Wipe the stale database completely and run fresh migrations.

```powershell
$p="C:\POS\php\php.exe"; $c="C:\POS\php\php.ini"; $a="C:\POS\backend\artisan"

# Delete the partial database and create a clean empty one
Remove-Item "C:\POS\backend\database\database.sqlite" -Force -ErrorAction SilentlyContinue
[System.IO.File]::WriteAllText("C:\POS\backend\database\database.sqlite", "")

# Run everything fresh
& $p -c $c $a migrate --force
& $p -c $c $a db:seed --force
& $p -c $c $a config:cache

# Restart PHP
Get-Process php -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process "C:\POS\start-pos.bat"
```

**Permanent fix (already applied in source):** `installer/install.ps1` Step 3 now always
deletes any existing SQLite file before creating a fresh one, so a re-run of the installer
can never leave a stale partial database.

---

## 8. Login returns 422 / Invalid credentials after fresh install

**Symptom:** Login page loads, entering `admin` / `Admin@123` returns
`422 Unprocessable Content` in the browser console and "invalid credentials" on screen.

**Root cause 1:** The user was entering `admin` in an email field on an older UI.
The current login form sends `username`, which is correct — use `admin` as the username.

**Root cause 2:** The password hash in the database didn't match (e.g. seeder ran while
PHP extensions were broken, storing a garbled hash, or the seeder was interrupted).

**Fix — reset the admin password directly:**

```powershell
$script = "C:\POS\fix-user.php"
[System.IO.File]::WriteAllText($script, @'
<?php
define('LARAVEL_START', microtime(true));
require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();
$user = App\Models\User::where('username', 'admin')->first();
if (!$user) { echo "ERROR: admin user not found. Run db:seed --force first.\n"; exit(1); }
$user->password = Illuminate\Support\Facades\Hash::make('Admin@123');
$user->is_active = 1;
$user->save();
echo "Done. Login: admin / Admin@123\n";
'@)
& "C:\POS\php\php.exe" -c "C:\POS\php\php.ini" $script
Remove-Item $script
```

**Default credentials (created by the seeder):**
| Field    | Value               |
|----------|---------------------|
| Username | `admin`             |
| Email    | `admin@nexapos.com` |
| Password | `Admin@123`         |

---

## 9. Rebuilding the installer after fixes

Run this on the **dev machine** whenever a new `Core-Setup.exe` is needed.
It automatically handles Inno Setup, frontend build, and php.ini preparation.

```powershell
# From the project root (c:\Users\...\Desktop\POSS\POS)
powershell -ExecutionPolicy Bypass -File installer\rebuild-installer.ps1
```

Output: `installer\Output\Core-Setup.exe`

---

## 10. Full recovery script for a broken install

Use this when a fresh-machine install ends up with a 500 error and you need to
fix everything in one go. Run all blocks **in order** on the problem machine.

**Block 1 — Fix PHP extensions:**
```powershell
$i=[System.IO.File]::ReadAllText("C:\POS\php\php.ini"); $i=$i -replace '(?m)^[; ]*extension_dir\s*=\s*"[^"]*"','extension_dir = "C:\POS\php\ext"'; $i=$i -replace ';extension=pdo_sqlite','extension=pdo_sqlite'; $i=$i -replace ';extension=sqlite3','extension=sqlite3'; $i=$i -replace ';extension=mbstring','extension=mbstring'; $i=$i -replace ';extension=openssl','extension=openssl'; [System.IO.File]::WriteAllText("C:\POS\php\php.ini",$i,[System.Text.Encoding]::UTF8); Write-Host "php.ini fixed" -ForegroundColor Green
```

**Block 2 — Create .env (only if missing):**
```powershell
if (!(Test-Path "C:\POS\backend\.env")) { @("APP_NAME=Core","APP_ENV=production","APP_KEY=","APP_DEBUG=false","APP_URL=http://localhost:8080","","LOG_CHANNEL=single","LOG_LEVEL=error","","DB_CONNECTION=sqlite","DB_DATABASE=C:\POS\backend\database\database.sqlite","","SESSION_DRIVER=file","QUEUE_CONNECTION=sync","CACHE_STORE=file") | Set-Content "C:\POS\backend\.env" -Encoding UTF8; Write-Host ".env created" -ForegroundColor Green } else { Write-Host ".env already exists" -ForegroundColor Yellow }
```

**Block 3 — Wipe stale database and run fresh migrations:**
```powershell
$p="C:\POS\php\php.exe"; $c="C:\POS\php\php.ini"; $a="C:\POS\backend\artisan"; Remove-Item "C:\POS\backend\database\database.sqlite" -Force -ErrorAction SilentlyContinue; [System.IO.File]::WriteAllText("C:\POS\backend\database\database.sqlite",""); & $p -c $c $a key:generate --force; & $p -c $c $a migrate --force; & $p -c $c $a db:seed --force; & $p -c $c $a config:cache; & $p -c $c $a route:cache; & $p -c $c $a view:cache; Write-Host "Setup complete" -ForegroundColor Green
```

**Block 4 — Restart PHP and open browser:**
```powershell
Get-Process php -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2; Start-Process "C:\POS\start-pos.bat"; Write-Host "Launched" -ForegroundColor Green
```

**Block 5 — If login still fails, reset admin password:**
```powershell
$s="C:\POS\fix.php"; [System.IO.File]::WriteAllText($s,'<?php define(''LARAVEL_START'',microtime(true)); require __DIR__.''/vendor/autoload.php''; $app=require_once __DIR__.''/bootstrap/app.php''; $k=$app->make(Illuminate\Contracts\Console\Kernel::class); $k->bootstrap(); $u=App\Models\User::where(''username'',''admin'')->first(); if(!$u){echo "No admin user\n";exit;} $u->password=Illuminate\Support\Facades\Hash::make(''Admin@123''); $u->is_active=1; $u->save(); echo "Password reset OK\n";'); & "C:\POS\php\php.exe" -c "C:\POS\php\php.ini" $s; Remove-Item $s
```

---

## Diagnostic command

Run this at any time on any machine to get a status snapshot:

```powershell
$A="C:\POS"; Write-Host "--- .env ---" -ForegroundColor Cyan; if(Test-Path "$A\backend\.env"){Get-Content "$A\backend\.env"}else{Write-Host "MISSING" -ForegroundColor Red}; Write-Host "--- SQLite ---" -ForegroundColor Cyan; if(Test-Path "$A\backend\database\database.sqlite"){Write-Host ((Get-Item "$A\backend\database\database.sqlite").Length.ToString() + " bytes") -ForegroundColor Green}else{Write-Host "MISSING" -ForegroundColor Red}; Write-Host "--- PHP pdo_sqlite ---" -ForegroundColor Cyan; if(Test-Path "$A\php\php.exe"){& "$A\php\php.exe" -c "$A\php\php.ini" -r "echo extension_loaded('pdo_sqlite')?'OK':'MISSING'; echo PHP_EOL;" 2>&1}else{Write-Host "php.exe not found" -ForegroundColor Red}; Write-Host "--- Laravel Log ---" -ForegroundColor Cyan; $l="$A\backend\storage\logs\laravel.log"; if(Test-Path $l){Get-Content $l | Select-Object -Last 30}else{Write-Host "No log file" -ForegroundColor Red}
```

---

*Last updated: 2026-06-15*
