# ==============================================================================
# NexaPOS - Windows Local Installer (PostgreSQL edition)
# Run once as Administrator:
#   powershell -ExecutionPolicy Bypass -File setup-windows.ps1
# After setup, double-click the NexaPOS shortcut on the Desktop every day.
# No internet connection is required AFTER this script completes.
# ==============================================================================

$ErrorActionPreference = "Stop"

# ── Configuration ────────────────────────────────────────────────────────────────
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir       = Split-Path -Parent $ScriptDir
$BackendDir   = Join-Path $AppDir "backend"
$FrontendDir  = Join-Path $AppDir "frontend"
$InstallDir   = "C:\POS"
$PhpDir       = Join-Path $InstallDir "php"
$PhpBin       = Join-Path $PhpDir "php.exe"
$ComposerPhar = Join-Path $InstallDir "composer.phar"

# PostgreSQL settings — change these if you already have Postgres installed
$PgVersion  = "16"
$PgHost     = "127.0.0.1"
$PgPort     = "5432"
$PgDatabase = "nexapos"
$PgUser     = "nexapos"
$PgPassword = "nexapos123"
$PgSuperPwd = "postgres123"   # postgres superuser password (set during install)

function Write-Step { param($msg) Write-Host "[....] $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "[ OK ] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail {
    param($msg)
    Write-Host "[FAIL] $msg" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Clear-Host
Write-Host ""
Write-Host "  NexaPOS - Windows Local Installer (PostgreSQL)" -ForegroundColor Green
Write-Host "  ================================================" -ForegroundColor Green
Write-Host ""

# ── 1. Require admin ─────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Fail "Please run this script as Administrator (right-click PowerShell -> Run as Administrator)"
}

# ── 2. Create C:\POS ─────────────────────────────────────────────────────────────
Write-Step "Creating install directory $InstallDir ..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-OK "Directory ready"

# ── 3. PostgreSQL ────────────────────────────────────────────────────────────────
Write-Step "Checking for PostgreSQL $PgVersion ..."

$pgBinDir = $null

# Look for pg_isready in common install paths
$pgCandidates = @(
    "C:\Program Files\PostgreSQL\$PgVersion\bin",
    "C:\Program Files\PostgreSQL\17\bin",
    "C:\Program Files\PostgreSQL\15\bin",
    "C:\Program Files\PostgreSQL\14\bin"
)
foreach ($c in $pgCandidates) {
    if (Test-Path (Join-Path $c "pg_isready.exe")) {
        $pgBinDir = $c
        break
    }
}

if ($pgBinDir) {
    Write-OK "PostgreSQL found at $pgBinDir"
} else {
    Write-Warn "PostgreSQL not found. Installing via winget ..."
    try {
        # Try winget first (available on Windows 10 1809+ and Windows 11)
        $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
        if ($wingetPath) {
            Write-Host "         Running: winget install PostgreSQL.PostgreSQL.$PgVersion ..." -ForegroundColor Gray
            winget install --id "PostgreSQL.PostgreSQL.$PgVersion" --accept-package-agreements --accept-source-agreements --silent
            $pgBinDir = "C:\Program Files\PostgreSQL\$PgVersion\bin"
            Start-Sleep -Seconds 5
            Write-OK "PostgreSQL installed"
        } else {
            # Fall back to direct download of the installer
            Write-Warn "winget not available. Downloading PostgreSQL installer ..."
            $pgInstaller = Join-Path $env:TEMP "postgresql-setup.exe"
            $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64.exe"
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $pgUrl -OutFile $pgInstaller -UseBasicParsing
            Write-Host "         Running PostgreSQL installer (unattended) ..." -ForegroundColor Gray
            & $pgInstaller --mode unattended --superpassword $PgSuperPwd --serverport $PgPort --install_runtimes 0
            Start-Sleep -Seconds 30
            Remove-Item $pgInstaller -ErrorAction SilentlyContinue
            $pgBinDir = "C:\Program Files\PostgreSQL\16\bin"
            Write-OK "PostgreSQL installed"
        }
    } catch {
        Write-Fail "PostgreSQL install failed: $_`nInstall PostgreSQL 16 manually from https://www.postgresql.org/download/windows/ then re-run this script."
    }
}

# Add pg bin to PATH for this session
$env:PATH = "$pgBinDir;$env:PATH"

# Ensure the PostgreSQL service is running
Write-Step "Ensuring PostgreSQL service is running ..."
$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService) {
    if ($pgService.Status -ne "Running") {
        Start-Service $pgService.Name
        Start-Sleep -Seconds 3
    }
    Write-OK "PostgreSQL service '$($pgService.Name)' is running"
} else {
    Write-Warn "Could not find a PostgreSQL Windows service. If Postgres is running another way, that is OK."
}

# ── 4. Create database + user ────────────────────────────────────────────────────
Write-Step "Creating database '$PgDatabase' and user '$PgUser' ..."

$psqlExe = Join-Path $pgBinDir "psql.exe"
if (-not (Test-Path $psqlExe)) {
    Write-Fail "psql.exe not found at $psqlExe."
}

# Write a pgpass.conf file so psql never prompts interactively.
# Format: hostname:port:database:username:password
function Set-PgPass {
    param([string]$Password)
    $pgpassDir  = Join-Path $env:APPDATA "postgresql"
    $pgpassFile = Join-Path $pgpassDir "pgpass.conf"
    New-Item -ItemType Directory -Force -Path $pgpassDir | Out-Null
    # One line covers all databases for the postgres superuser
    $line = "${PgHost}:${PgPort}:*:postgres:$Password"
    [System.IO.File]::WriteAllText($pgpassFile, $line, [System.Text.Encoding]::UTF8)
    $env:PGPASSFILE = $pgpassFile
}

function Invoke-Psql {
    param([string[]]$PsqlArgs)
    return & $psqlExe @PsqlArgs 2>&1
}

# Prompt for the postgres superuser password once, write pgpass.conf so ALL
# subsequent psql calls are completely silent (no interactive prompts).
Write-Host ""
Write-Host "  Enter the password for the PostgreSQL 'postgres' superuser." -ForegroundColor Yellow
Write-Host "  (If postgres has no password on this machine, just press Enter)" -ForegroundColor Gray
$securePwd = Read-Host -AsSecureString "  postgres password"
$pgSuperPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePwd))

Set-PgPass -Password $pgSuperPassword

# Verify the connection works before proceeding
$testArgs = @("-U", "postgres", "-h", $PgHost, "-p", $PgPort, "-tAc", "SELECT 1;")
$test = Invoke-Psql -PsqlArgs $testArgs
if ($test -notmatch "^\s*1") {
    Write-Fail "Could not connect to PostgreSQL as 'postgres'. Check the password and ensure the service is running."
}
Write-OK "Connected to PostgreSQL as superuser"

# All psql calls below use the pgpass file — no more prompts.

# Create the app role if it doesn't exist
$createRole = "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$PgUser') THEN CREATE ROLE $PgUser LOGIN PASSWORD '$PgPassword'; END IF; END `$`$;"
Invoke-Psql -PsqlArgs @("-U", "postgres", "-h", $PgHost, "-p", $PgPort, "-c", $createRole) | Out-Null

# Create the database if it doesn't exist
$dbCheck = Invoke-Psql -PsqlArgs @("-U", "postgres", "-h", $PgHost, "-p", $PgPort, "-tAc", "SELECT 1 FROM pg_database WHERE datname='$PgDatabase';")
if ($dbCheck -match "^\s*1") {
    Write-OK "Database '$PgDatabase' already exists"
} else {
    Invoke-Psql -PsqlArgs @("-U", "postgres", "-h", $PgHost, "-p", $PgPort, "-c", "CREATE DATABASE $PgDatabase OWNER $PgUser;") | Out-Null
    Write-OK "Database '$PgDatabase' created"
}

# Grant privileges (both commands run connected to default 'postgres' db — no -d flag needed)
Invoke-Psql -PsqlArgs @("-U", "postgres", "-h", $PgHost, "-p", $PgPort, "-c", "GRANT ALL PRIVILEGES ON DATABASE $PgDatabase TO $PgUser;") | Out-Null
# GRANT ON SCHEMA must run inside the target database
Invoke-Psql -PsqlArgs @("-U", "postgres", "-h", $PgHost, "-p", $PgPort, "-d", $PgDatabase, "-c", "GRANT ALL ON SCHEMA public TO $PgUser;") | Out-Null
Write-OK "User '$PgUser' has full access to '$PgDatabase'"

# ── 5. PHP ───────────────────────────────────────────────────────────────────────
Write-Step "Checking for PHP 8.x ..."
$phpCmd = $null

if (Test-Path $PhpBin) {
    $phpCmd = $PhpBin
    Write-OK "PHP already at $PhpBin"
} elseif (Get-Command php -ErrorAction SilentlyContinue) {
    $phpCmd = "php"
    Write-OK "PHP found in PATH"
} else {
    Write-Warn "PHP not found. Downloading PHP 8.3 NTS x64 ..."
    $phpZip = Join-Path $env:TEMP "php83.zip"
    $phpUrl = "https://windows.php.net/downloads/releases/php-8.3.20-nts-Win32-vs16-x64.zip"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $phpUrl -OutFile $phpZip -UseBasicParsing
        New-Item -ItemType Directory -Force -Path $PhpDir | Out-Null
        Expand-Archive -Path $phpZip -DestinationPath $PhpDir -Force
        Remove-Item $phpZip -ErrorAction SilentlyContinue

        $iniSrc = Join-Path $PhpDir "php.ini-production"
        $iniDst = Join-Path $PhpDir "php.ini"
        Copy-Item $iniSrc $iniDst -Force
        $extDir = Join-Path $PhpDir "ext"

        $iniContent = Get-Content $iniDst
        $iniContent = $iniContent -replace ';extension=pdo_pgsql',  'extension=pdo_pgsql'
        $iniContent = $iniContent -replace ';extension=pgsql',      'extension=pgsql'
        $iniContent = $iniContent -replace ';extension=mbstring',   'extension=mbstring'
        $iniContent = $iniContent -replace ';extension=openssl',    'extension=openssl'
        $iniContent = $iniContent -replace ';extension=fileinfo',   'extension=fileinfo'
        $iniContent = $iniContent -replace ';extension=tokenizer',  'extension=tokenizer'
        $iniContent = $iniContent -replace ';extension=ctype',      'extension=ctype'
        $iniContent = $iniContent -replace ';extension=pdo_sqlite', 'extension=pdo_sqlite'
        $iniContent = $iniContent -replace ';extension_dir = "ext"', "extension_dir = `"$extDir`""
        $iniContent | Set-Content $iniDst -Encoding UTF8

        $phpCmd = $PhpBin
        $oldPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
        if ($oldPath -notlike "*$PhpDir*") {
            [Environment]::SetEnvironmentVariable("PATH", "$PhpDir;$oldPath", "Machine")
            $env:PATH = "$PhpDir;$env:PATH"
        }
        Write-OK "PHP 8.3 installed at $PhpDir"
    } catch {
        Write-Fail "PHP download failed: $_`nInstall PHP 8.x manually from https://windows.php.net/download/"
    }
}

# Verify pdo_pgsql is enabled.
# Temporarily lower ErrorActionPreference so PHP's startup warnings don't abort the script.
$phpExtCheck = ""
$_eap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$phpExtCheck = & $phpCmd -m 2>$null
$ErrorActionPreference = $_eap
if ($phpExtCheck -notlike "*pdo_pgsql*") {
    Write-Warn "pdo_pgsql extension may not be enabled in PHP."
    Write-Warn "Open php.ini and ensure 'extension=pdo_pgsql' is uncommented, then re-run."
}

# ── 6. Composer ──────────────────────────────────────────────────────────────────
Write-Step "Checking for Composer ..."
$composerArgs = @()

if (Get-Command composer -ErrorAction SilentlyContinue) {
    $composerExe = "composer"
    Write-OK "Composer found in PATH"
} elseif (Test-Path $ComposerPhar) {
    $composerExe = $phpCmd
    $composerArgs = @($ComposerPhar)
    Write-OK "Composer phar found"
} else {
    Write-Warn "Composer not found. Downloading ..."
    try {
        $setup = Join-Path $env:TEMP "composer-setup.php"
        Invoke-WebRequest -Uri "https://getcomposer.org/installer" -OutFile $setup -UseBasicParsing
        & $phpCmd $setup --install-dir="$InstallDir" --filename="composer.phar"
        Remove-Item $setup -ErrorAction SilentlyContinue
        $composerExe = $phpCmd
        $composerArgs = @($ComposerPhar)
        Write-OK "Composer installed"
    } catch {
        Write-Fail "Composer download failed. Install from https://getcomposer.org/"
    }
}

# ── 7. Backend PHP dependencies ─────────────────────────────────────────────────
Write-Step "Installing backend PHP dependencies ..."
Push-Location $BackendDir
try {
    & $composerExe @composerArgs install --no-dev --optimize-autoloader --no-interaction
} finally {
    Pop-Location
}
Write-OK "Backend dependencies installed"

# ── 8. Write .env ────────────────────────────────────────────────────────────────
Write-Step "Writing backend .env ..."
$envFile = Join-Path $BackendDir ".env"

$envContent  = "APP_NAME=NexaPOS" + [Environment]::NewLine
$envContent += "APP_ENV=local" + [Environment]::NewLine
$envContent += "APP_KEY=" + [Environment]::NewLine
$envContent += "APP_DEBUG=false" + [Environment]::NewLine
$envContent += "APP_URL=http://localhost:8080" + [Environment]::NewLine
$envContent += "" + [Environment]::NewLine
$envContent += "DB_CONNECTION=pgsql" + [Environment]::NewLine
$envContent += "DB_HOST=$PgHost" + [Environment]::NewLine
$envContent += "DB_PORT=$PgPort" + [Environment]::NewLine
$envContent += "DB_DATABASE=$PgDatabase" + [Environment]::NewLine
$envContent += "DB_USERNAME=$PgUser" + [Environment]::NewLine
$envContent += "DB_PASSWORD=$PgPassword" + [Environment]::NewLine
$envContent += "" + [Environment]::NewLine
$envContent += "SESSION_DRIVER=database" + [Environment]::NewLine
$envContent += "QUEUE_CONNECTION=database" + [Environment]::NewLine
$envContent += "CACHE_STORE=database" + [Environment]::NewLine
$envContent += "LOG_CHANNEL=single" + [Environment]::NewLine
$envContent += "LOG_LEVEL=error" + [Environment]::NewLine

[System.IO.File]::WriteAllText($envFile, $envContent, [System.Text.Encoding]::UTF8)
Write-OK ".env written (PostgreSQL on ${PgHost}:${PgPort}/${PgDatabase})"

# ── 9. Generate app key ──────────────────────────────────────────────────────────
Write-Step "Generating application key ..."
& $phpCmd (Join-Path $BackendDir "artisan") key:generate --force
Write-OK "Application key generated"

# ── 10. Database migrations ──────────────────────────────────────────────────────
Write-Step "Running database migrations ..."
& $phpCmd (Join-Path $BackendDir "artisan") migrate --force
Write-OK "Database migrated"

# ── 11. Cache config ─────────────────────────────────────────────────────────────
Write-Step "Caching Laravel config ..."
& $phpCmd (Join-Path $BackendDir "artisan") config:cache
& $phpCmd (Join-Path $BackendDir "artisan") route:cache
Write-OK "Caches built"

# ── 12. Build frontend ───────────────────────────────────────────────────────────
Write-Step "Checking for Node.js ..."
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-OK "Node.js $(node --version)"
    Write-Step "Building frontend ..."
    Push-Location $FrontendDir
    try {
        $prodEnv  = "VITE_API_URL=http://localhost:8080/api" + [Environment]::NewLine
        $prodEnv += "VITE_APP_NAME=NexaPOS" + [Environment]::NewLine
        [System.IO.File]::WriteAllText(
            (Join-Path $FrontendDir ".env.production"),
            $prodEnv,
            [System.Text.Encoding]::UTF8
        )
        if (Test-Path (Join-Path $FrontendDir "package-lock.json")) {
            npm ci --silent
        } else {
            npm install --silent
        }
        npm run build
    } finally {
        Pop-Location
    }

    Write-Step "Copying frontend build to backend/public ..."
    $distDir   = Join-Path $FrontendDir "dist"
    $publicDir = Join-Path $BackendDir  "public"
    if (Test-Path $distDir) {
        Get-ChildItem -Path $distDir | ForEach-Object {
            if ($_.Name -ne "index.php") {
                Copy-Item -Path $_.FullName -Destination $publicDir -Recurse -Force
            }
        }
        Write-OK "Frontend deployed to $publicDir"
    } else {
        Write-Warn "frontend/dist not found. Run deploy-frontend.bat after a manual npm run build."
    }
} else {
    Write-Warn "Node.js not found. Skipping frontend build."
    Write-Warn "Install Node.js from https://nodejs.org/ and re-run, OR run deploy-frontend.bat manually."
}

# ── 13. Launcher batch file ──────────────────────────────────────────────────────
Write-Step "Creating launcher ..."
$launcherPath = Join-Path $InstallDir "start-pos.bat"

$bat  = "@echo off" + [Environment]::NewLine
$bat += "title NexaPOS - Local POS Server" + [Environment]::NewLine
$bat += "" + [Environment]::NewLine
$bat += "REM Ensure PostgreSQL service is running" + [Environment]::NewLine
$bat += "net start postgresql-x64-$PgVersion >nul 2>&1" + [Environment]::NewLine
$bat += "" + [Environment]::NewLine
$bat += "cd /d `"$BackendDir`"" + [Environment]::NewLine
$bat += "echo." + [Environment]::NewLine
$bat += "echo  NexaPOS is starting on http://localhost:8080" + [Environment]::NewLine
$bat += "echo  Database: PostgreSQL $PgDatabase on $PgHost" + [Environment]::NewLine
$bat += "echo  Close this window to stop the PHP server." + [Environment]::NewLine
$bat += "echo." + [Environment]::NewLine
$bat += "start `"`" http://localhost:8080/cashier" + [Environment]::NewLine
$bat += "`"$phpCmd`" artisan serve --host=127.0.0.1 --port=8080" + [Environment]::NewLine

[System.IO.File]::WriteAllText($launcherPath, $bat, [System.Text.Encoding]::ASCII)
Write-OK "Launcher created at $launcherPath"

# ── 14. Desktop shortcut ─────────────────────────────────────────────────────────
Write-Step "Creating desktop shortcut ..."
$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$env:PUBLIC\Desktop\NexaPOS.lnk")
$shortcut.TargetPath       = $launcherPath
$shortcut.WorkingDirectory = $InstallDir
$shortcut.WindowStyle      = 1
$shortcut.Description      = "Launch NexaPOS local POS system"
$shortcut.Save()
Write-OK "Desktop shortcut created"

# ── Done ─────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  =============================================" -ForegroundColor Green
Write-Host "       NEXAPOS SETUP COMPLETE!" -ForegroundColor Green
Write-Host "  =============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Database : PostgreSQL $PgDatabase @ ${PgHost}:${PgPort}" -ForegroundColor White
Write-Host "  App URL  : http://localhost:8080/cashier"             -ForegroundColor Cyan
Write-Host ""
Write-Host "  To launch: double-click 'NexaPOS' on the Desktop"    -ForegroundColor White
Write-Host "  OR run   : $launcherPath"                             -ForegroundColor Gray
Write-Host ""
Read-Host "Press Enter to exit"
