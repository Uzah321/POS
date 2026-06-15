<#
.SYNOPSIS
  Core POS post-install setup. Called by Inno Setup after extracting all files.
  Installs PostgreSQL (downloads from internet if not present), creates the
  database, configures Laravel, and creates the launch shortcut.
#>
param(
    [string]$AppDir = "C:\POS"
)

$ErrorActionPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Host.UI.RawUI.WindowTitle = "Core POS First-Time Setup"

function Log($m)  { Write-Host "  $m" }
function OK($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function WAIT($m) { Write-Host "  [...] $m" -ForegroundColor Yellow }
function ERR($m) {
    Write-Host ""
    Write-Host "  [ERROR] $m" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Core POS setup did not complete. Please check the error above." -ForegroundColor Red
    Write-Host "  You can re-run setup from: $AppDir\install.ps1" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
}

Clear-Host
Write-Host ""
Write-Host "  Core POS - First-Time Setup" -ForegroundColor Cyan
Write-Host "  ===========================" -ForegroundColor Cyan
Write-Host "  Installing to: $AppDir" -ForegroundColor Gray
Write-Host ""

$php     = "$AppDir\php\php.exe"
$phpIni  = "$AppDir\php\php.ini"
$artisan = "$AppDir\backend\artisan"
$envFile = "$AppDir\backend\.env"


# ============================================================================
# STEP 1 - Fix PHP extension_dir to absolute path in php.ini
# ============================================================================
WAIT "Configuring PHP runtime..."
if (!(Test-Path $php)) { ERR "PHP not found at $php. The installer may be incomplete." }

$ini = [System.IO.File]::ReadAllText($phpIni)
$ini = $ini -replace 'extension_dir\s*=\s*"ext"', "extension_dir = `"$AppDir\php\ext`""
$ini = $ini -replace '^extension_dir\s*=\s*ext', "extension_dir = `"$AppDir\php\ext`""
[System.IO.File]::WriteAllText($phpIni, $ini)
OK "PHP configured"


# ============================================================================
# STEP 2 - Check for PostgreSQL; install if missing
# ============================================================================
WAIT "Checking for PostgreSQL..."
$pgSvc = Get-Service | Where-Object { $_.Name -like "postgresql*" } | Select-Object -First 1

if (!$pgSvc) {
    Write-Host ""
    Write-Host "  PostgreSQL is not installed." -ForegroundColor Yellow
    Write-Host "  Downloading PostgreSQL 17 installer (~330 MB)." -ForegroundColor Yellow
    Write-Host "  This is a one-time download - please wait..." -ForegroundColor Yellow
    Write-Host ""

    $pgInstaller = "$env:TEMP\pg17-setup.exe"
    $pgUrls = @(
        "https://get.enterprisedb.com/postgresql/postgresql-17.5-1-windows-x64.exe",
        "https://get.enterprisedb.com/postgresql/postgresql-17.4-1-windows-x64.exe"
    )

    $downloaded = $false
    foreach ($url in $pgUrls) {
        try {
            Write-Host "  Downloading from EDB..." -ForegroundColor DarkGray
            $wc = New-Object System.Net.WebClient
            $wc.DownloadFile($url, $pgInstaller)
            $downloaded = $true
            break
        } catch { }
    }
    if (!$downloaded) { ERR "Failed to download PostgreSQL. Please check your internet connection and re-run setup." }

    WAIT "Installing PostgreSQL 17 (this takes 2-4 minutes)..."
    $pgArgs = "--mode unattended --unattendedmodeui none --superpassword ""Core@2024!"" --serverport 5432 --servicename postgresql-x64-17 --enable-components server"
    $proc = Start-Process -FilePath $pgInstaller -ArgumentList $pgArgs -Wait -PassThru -ErrorAction Stop
    Remove-Item $pgInstaller -Force

    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 1) {
        ERR "PostgreSQL installation failed (exit code $($proc.ExitCode))."
    }

    Start-Sleep -Seconds 6
    $pgSvc = Get-Service | Where-Object { $_.Name -like "postgresql*" } | Select-Object -First 1
    if (!$pgSvc) { ERR "PostgreSQL service not found after installation. Please install PostgreSQL 17 manually." }
    OK "PostgreSQL 17 installed"
} else {
    OK "PostgreSQL found ($($pgSvc.Name))"
}


# ============================================================================
# STEP 3 - Ensure service is running
# ============================================================================
if ($pgSvc.Status -ne "Running") {
    WAIT "Starting PostgreSQL service..."
    Start-Service $pgSvc.Name
    Start-Sleep -Seconds 5
}
OK "PostgreSQL service is running"


# ============================================================================
# STEP 4 - Locate psql.exe and data directory
# ============================================================================
WAIT "Locating PostgreSQL binaries..."
$psqlExe = Get-ChildItem "C:\Program Files\PostgreSQL" -Recurse -Filter "psql.exe" -ErrorAction SilentlyContinue |
           Select-Object -First 1 -ExpandProperty FullName
if (!$psqlExe) {
    ERR "psql.exe not found under C:\Program Files\PostgreSQL. PostgreSQL may not have installed correctly."
}
$pgBinDir = Split-Path $psqlExe
$pgDataDir = Join-Path (Split-Path $pgBinDir -Parent) "data"
OK "psql found at $psqlExe"


# ============================================================================
# STEP 5 - Temporarily enable trust auth so we can create the DB user
# ============================================================================
$hbaFile   = "$pgDataDir\pg_hba.conf"
$hbaBackup = "$pgDataDir\pg_hba.conf.nexabak"

if (Test-Path $hbaFile) {
    WAIT "Configuring database access for setup..."
    Copy-Item $hbaFile $hbaBackup -Force
    $hba = Get-Content $hbaFile
    $hba = $hba -replace '\bscram-sha-256\b', 'trust' -replace '\bmd5\b', 'trust'
    $hba | Set-Content $hbaFile
    Restart-Service $pgSvc.Name
    Start-Sleep -Seconds 6
    OK "Database access configured"
}


# ============================================================================
# STEP 6 - Create Core database and user
# ============================================================================
WAIT "Creating Core POS database..."

$env:PGPASSFILE = ""
function psql($args) { & $psqlExe -U postgres -p 5432 -h 127.0.0.1 @args 2>$null }

psql @("-c", "DROP DATABASE IF EXISTS Core;")
psql @("-c", "DROP USER IF EXISTS Core;")
psql @("-c", "CREATE USER Core WITH PASSWORD 'Core123';")
psql @("-c", "CREATE DATABASE Core OWNER Core ENCODING 'UTF8';")
psql @("-c", "GRANT ALL PRIVILEGES ON DATABASE Core TO Core;")
psql @("-d", "Core", "-c", "GRANT ALL ON SCHEMA public TO Core;")
OK "Database and user created"


# ============================================================================
# STEP 7 - Restore pg_hba.conf to secure password auth
# ============================================================================
if (Test-Path $hbaBackup) {
    WAIT "Restoring database security settings..."
    Copy-Item $hbaBackup $hbaFile -Force
    Remove-Item $hbaBackup -Force
    Restart-Service $pgSvc.Name
    Start-Sleep -Seconds 5
    OK "Database security restored"
}

# Write pgpass.conf so php/artisan can auth as Core without password prompts
$pgpassDir = "$env:APPDATA\postgresql"
if (!(Test-Path $pgpassDir)) { New-Item -ItemType Directory -Path $pgpassDir -Force | Out-Null }
"localhost:5432:*:Core:Core123" | Set-Content "$pgpassDir\pgpass.conf" -Encoding ASCII
$env:PGPASSFILE = "$pgpassDir\pgpass.conf"


# ============================================================================
# STEP 8 - Write .env
# ============================================================================
WAIT "Writing application configuration..."

$envContent = @"
APP_NAME=Core
APP_ENV=production
APP_KEY=
APP_DEBUG=false
APP_URL=http://localhost:8080

LOG_CHANNEL=single
LOG_LEVEL=error

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=Core
DB_USERNAME=Core
DB_PASSWORD=Core123

CACHE_DRIVER=file
SESSION_DRIVER=file
QUEUE_CONNECTION=sync
"@

[System.IO.File]::WriteAllText($envFile, $envContent)
OK "Application configuration written"


# ============================================================================
# STEP 9 - Run artisan setup commands
# ============================================================================
function artisan($args) {
    & $php -c $phpIni $artisan @args 2>$null
}

WAIT "Generating application key..."
artisan @("key:generate", "--force")
OK "Application key generated"

WAIT "Running database migrations..."
artisan @("migrate", "--force")
OK "Database tables created"

WAIT "Seeding default data (products, users, settings)..."
artisan @("db:seed", "--force")
OK "Default data loaded"

WAIT "Caching application for performance..."
artisan @("config:cache")
artisan @("route:cache")
artisan @("view:cache")
OK "Application cached"


# ============================================================================
# STEP 10 - Rewrite start-pos.bat with absolute paths for this install
# ============================================================================
WAIT "Creating launcher script..."

$batContent = "@echo off" + [char]13 + [char]10 +
"title Core" + [char]13 + [char]10 +
"net start $($pgSvc.Name) >nul 2>&1" + [char]13 + [char]10 +
"netstat -ano | find `"8080`" | find `"LISTENING`" >nul 2>&1 && (" + [char]13 + [char]10 +
"    start `"`" http://localhost:8080/cashier" + [char]13 + [char]10 +
"    goto :eof" + [char]13 + [char]10 +
")" + [char]13 + [char]10 +
"start /B `"`" `"$AppDir\php\php.exe`" -c `"$AppDir\php\php.ini`" `"$AppDir\backend\artisan`" serve --host=0.0.0.0 --port=8080" + [char]13 + [char]10 +
"timeout /t 3 /nobreak >nul" + [char]13 + [char]10 +
"start `"`" http://localhost:8080/cashier" + [char]13 + [char]10

[System.IO.File]::WriteAllText("$AppDir\start-pos.bat", $batContent)
OK "Launcher script written"


# ============================================================================
# STEP 11 - Desktop shortcut
# ============================================================================
WAIT "Creating desktop shortcut..."
try {
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut("$env:PUBLIC\Desktop\Core.lnk")
    $lnk.TargetPath      = "$AppDir\start-pos.bat"
    $lnk.WorkingDirectory = $AppDir
    $lnk.Description     = "Core POS Point of Sale"
    $lnk.IconLocation    = "shell32.dll,22"
    $lnk.Save()
    OK "Desktop shortcut created"
} catch {
    Log "(Shortcut creation skipped: $($_.Exception.Message))"
}


# ============================================================================
# DONE
# ============================================================================
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "    Core POS setup complete!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Default login credentials:" -ForegroundColor White
Write-Host "    Username : admin@Core.com" -ForegroundColor Cyan
Write-Host "    Password : Admin@123" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Double-click 'Core POS' on your desktop to launch." -ForegroundColor White
Write-Host ""
Read-Host "  Press Enter to close this window"
