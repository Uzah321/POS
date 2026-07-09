<#
.SYNOPSIS
  Core POS - Fresh Machine Setup
  Copy this project folder to any Windows 10/11 machine, then run:
    powershell -ExecutionPolicy Bypass -File installer\setup-windows.ps1
  Run as Administrator. Internet required once (to download PHP if not present).
#>

param()
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptDir   = Split-Path $MyInvocation.MyCommand.Path
$Root        = Split-Path $ScriptDir -Parent
$BackendDir  = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$PhpDir      = "C:\POS\php"
$PhpBin      = "$PhpDir\php.exe"
$PhpIni      = "$PhpDir\php.ini"

function OK($m)   { Write-Host "  [ OK ] $m" -ForegroundColor Green }
function WAIT($m) { Write-Host "  [ .. ] $m" -ForegroundColor Yellow }
function FAIL($m) {
    Write-Host ""
    Write-Host "  [FAIL] $m" -ForegroundColor Red
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
}

Clear-Host
Write-Host ""
Write-Host "  Core POS - Fresh Machine Setup" -ForegroundColor Cyan
Write-Host "  ==============================" -ForegroundColor Cyan
Write-Host "  Project  : $Root" -ForegroundColor Gray
Write-Host "  PHP      : $PhpDir" -ForegroundColor Gray
Write-Host ""

# ── 1. Require Administrator ──────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    FAIL "Please run as Administrator.`n  Right-click PowerShell -> Run as Administrator, then re-run this script."
}
OK "Running as Administrator"

# ── 2. PHP 8.3 NTS x64 ───────────────────────────────────────────────────────
if (Test-Path $PhpBin) {
    OK "PHP already at $PhpDir"
} else {
    WAIT "Downloading PHP 8.3 NTS x64 (~30 MB)..."
    New-Item -ItemType Directory -Force -Path $PhpDir | Out-Null
    $phpZip = "$env:TEMP\php83-nts.zip"
    $got = $false
    foreach ($url in @(
        "https://windows.php.net/downloads/releases/php-8.3.22-nts-Win32-vs16-x64.zip",
        "https://windows.php.net/downloads/releases/php-8.3.21-nts-Win32-vs16-x64.zip",
        "https://windows.php.net/downloads/releases/php-8.3.20-nts-Win32-vs16-x64.zip"
    )) {
        try {
            Write-Host "    Trying $url" -ForegroundColor DarkGray
            Invoke-WebRequest -Uri $url -OutFile $phpZip -UseBasicParsing
            $got = $true; break
        } catch {}
    }
    if (-not $got) { FAIL "Could not download PHP. Check your internet connection, then re-run." }
    Expand-Archive -Path $phpZip -DestinationPath $PhpDir -Force
    Remove-Item $phpZip -Force
    OK "PHP 8.3 downloaded to $PhpDir"
}

# ── 3. Configure PHP for SQLite ───────────────────────────────────────────────
WAIT "Configuring PHP extensions..."
$iniSrc = if (Test-Path "$PhpDir\php.ini") { "$PhpDir\php.ini" } `
          elseif (Test-Path "$PhpDir\php.ini-production") { "$PhpDir\php.ini-production" } `
          else { "$PhpDir\php.ini-development" }
$ini = [System.IO.File]::ReadAllText($iniSrc)
foreach ($ext in @('pdo_sqlite','sqlite3','mbstring','openssl','fileinfo','curl','zip','intl','sodium','gd')) {
    $ini = $ini -replace ";extension=$ext", "extension=$ext"
}
$ini = $ini -replace '(?m)^[; ]*extension_dir\s*=\s*"[^"]*"', "extension_dir = `"$PhpDir\ext`""
[System.IO.File]::WriteAllText($PhpIni, $ini, [System.Text.Encoding]::UTF8)
OK "PHP configured (SQLite, mbstring, openssl, curl...)"

# ── 4. Visual C++ Runtime (required by PHP 8.3) ───────────────────────────────
WAIT "Installing Visual C++ Runtime..."
$vcRedist = "$ScriptDir\redist\vc_redist.x64.exe"
$vcTmp    = "$env:TEMP\vc_redist.x64.exe"
$vcTarget = if (Test-Path $vcRedist) { $vcRedist } else { $null }

if (-not $vcTarget) {
    try {
        Write-Host "    Downloading VC++ Redistributable (~25 MB)..." -ForegroundColor DarkGray
        Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vc_redist.x64.exe" -OutFile $vcTmp -UseBasicParsing
        $vcTarget = $vcTmp
    } catch {
        Write-Host "  (VC++ download skipped - PHP may fail if runtime is missing)" -ForegroundColor Yellow
    }
}
if ($vcTarget) {
    Start-Process -FilePath $vcTarget -ArgumentList "/install /quiet /norestart" -Wait -ErrorAction SilentlyContinue
    Remove-Item $vcTmp -Force -ErrorAction SilentlyContinue
    OK "Visual C++ Runtime installed"
}

# ── 5. Backend PHP dependencies ───────────────────────────────────────────────
WAIT "Checking backend dependencies..."
if (Test-Path "$BackendDir\vendor\autoload.php") {
    OK "vendor/ already present"
} else {
    WAIT "Running composer install (downloads PHP packages)..."
    $composerExe  = $null
    $composerArgs = @()

    if (Get-Command composer -ErrorAction SilentlyContinue) {
        $composerExe = "composer"
    } else {
        # Download composer.phar and run with bundled PHP
        $composerPhar = "$env:TEMP\composer.phar"
        try {
            Invoke-WebRequest -Uri "https://getcomposer.org/download/latest-stable/composer.phar" -OutFile $composerPhar -UseBasicParsing
            $composerExe  = $PhpBin
            $composerArgs = @("-c", $PhpIni, $composerPhar)
        } catch {
            FAIL "Composer not found and could not be downloaded.`n  Install Composer from https://getcomposer.org/download/ then re-run."
        }
    }

    Push-Location $BackendDir
    try {
        & $composerExe @composerArgs install --no-dev --optimize-autoloader --no-interaction
        if ($LASTEXITCODE -ne 0) { FAIL "composer install failed. Check the output above." }
    } finally { Pop-Location }

    if (-not (Test-Path "$BackendDir\vendor\autoload.php")) { FAIL "composer install completed but vendor/autoload.php is missing." }
    OK "PHP dependencies installed"
}

# ── 6. Frontend ───────────────────────────────────────────────────────────────
WAIT "Checking frontend build..."
if (Test-Path "$BackendDir\public\index.html") {
    OK "Frontend already built (backend/public/index.html found)"
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
    WAIT "Building frontend with Node.js $(node --version)..."
    Push-Location $FrontendDir
    try {
        $prodEnv = "VITE_API_URL=http://localhost:8080/api`nVITE_APP_NAME=Core`n"
        [System.IO.File]::WriteAllText("$FrontendDir\.env.production", $prodEnv, [System.Text.Encoding]::UTF8)
        if (Test-Path "$FrontendDir\package-lock.json") { npm ci --silent } else { npm install --silent }
        if ($LASTEXITCODE -ne 0) { FAIL "npm install failed." }
        npm run build
        if ($LASTEXITCODE -ne 0) { FAIL "npm run build failed." }
    } finally { Pop-Location }
    if (-not (Test-Path "$BackendDir\public\index.html")) { FAIL "Frontend build did not produce backend/public/index.html." }
    OK "Frontend built"
} else {
    FAIL "Frontend is not built and Node.js is not installed.`n  Option A: Install Node.js from https://nodejs.org/ and re-run.`n  Option B: Copy a pre-built backend/public/ folder from another machine."
}

# ── 7. SQLite database file ───────────────────────────────────────────────────
WAIT "Creating SQLite database..."
$dbDir  = "$BackendDir\database"
$dbFile = "$dbDir\database.sqlite"
$dbAlreadyExisted = (Test-Path $dbFile) -and ((Get-Item $dbFile).Length -gt 0)
if (-not (Test-Path $dbDir))  { New-Item -ItemType Directory -Force -Path $dbDir | Out-Null }
if (-not (Test-Path $dbFile)) { New-Item -ItemType File     -Force -Path $dbFile | Out-Null }
OK "SQLite database file ready"

# ── 8. Write .env ─────────────────────────────────────────────────────────────
WAIT "Writing application config..."
$envFile = "$BackendDir\.env"
$dbFwd   = $dbFile.Replace('\', '/')
$existingAppKey = ""
if (Test-Path $envFile) {
    $existingEnv = Get-Content $envFile -Raw
    if ($existingEnv -match '(?m)^APP_KEY=(base64:[^\r\n]+)') { $existingAppKey = $matches[1] }
}
$envText = @"
APP_NAME=Core
APP_ENV=production
APP_KEY=$existingAppKey
APP_DEBUG=false
APP_URL=http://localhost:8080
LOG_CHANNEL=single
LOG_LEVEL=error
DB_CONNECTION=sqlite
DB_DATABASE=$dbFwd
SESSION_DRIVER=file
QUEUE_CONNECTION=sync
CACHE_STORE=file
"@
[System.IO.File]::WriteAllText($envFile, $envText.TrimStart(), [System.Text.Encoding]::UTF8)
OK ".env written"

# ── 9. Storage permissions ────────────────────────────────────────────────────
WAIT "Setting storage permissions..."
foreach ($path in @(
    "$BackendDir\storage",
    "$BackendDir\storage\logs",
    "$BackendDir\storage\framework",
    "$BackendDir\storage\framework\cache",
    "$BackendDir\storage\framework\sessions",
    "$BackendDir\storage\framework\views",
    "$BackendDir\storage\app",
    "$BackendDir\bootstrap\cache",
    $dbDir
)) {
    if (-not (Test-Path $path)) { New-Item -ItemType Directory -Force -Path $path | Out-Null }
    & icacls $path /grant "*S-1-5-32-545:(OI)(CI)M" /T /C 2>&1 | Out-Null
}
OK "Storage folders are writable"

# ── 10. Artisan setup ─────────────────────────────────────────────────────────
function Artisan { return & $PhpBin -c $PhpIni "$BackendDir\artisan" @args 2>&1 }

WAIT "Clearing bootstrap cache..."
Get-ChildItem "$BackendDir\bootstrap\cache" -Filter "*.php" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
OK "Bootstrap cache cleared"

$envCheck = Get-Content $envFile -Raw
if ($envCheck -match 'APP_KEY=base64:') {
    OK "Application key preserved"
} else {
    WAIT "Generating application key..."
    Artisan key:generate --force | Out-Null
    $envCheck = Get-Content $envFile -Raw
    if ($envCheck -notmatch 'APP_KEY=base64:') { FAIL "key:generate failed - check PHP extensions are loading." }
    OK "Application key generated"
}

WAIT "Applying database migrations..."
$out = Artisan migrate --force
if ($LASTEXITCODE -ne 0) { FAIL "Migrations failed.`n$out" }
OK "Database schema is up to date"

WAIT "Applying default data (preserves existing records)..."
$out = Artisan db:seed --force
if ($LASTEXITCODE -ne 0) { FAIL "Seeder failed.`n$out" }
if ($dbAlreadyExisted) {
    OK "Default data ready - existing data preserved"
} else {
    OK "Default data loaded (admin / Admin@123)"
}

WAIT "Caching application for performance..."
Artisan config:cache | Out-Null
Artisan route:cache  | Out-Null
Artisan view:cache   | Out-Null
OK "Application cached"

# ── 11. PHPRC environment variable ────────────────────────────────────────────
try {
    [System.Environment]::SetEnvironmentVariable("PHPRC", $PhpDir, "Machine")
    OK "PHPRC system variable set"
} catch {
    Write-Host "  (PHPRC not set as system var - OK, extensions still load)" -ForegroundColor Yellow
}

# ── 12. Create start-pos.bat launcher ────────────────────────────────────────
WAIT "Creating launcher..."
$launcherPath = "$Root\start-pos.bat"
$bat  = "@echo off`r`n"
$bat += "title Core POS`r`n"
$bat += "set PHPRC=$PhpDir`r`n"
$bat += "if exist `"$Root\desktop\Core.exe`" (`r`n"
$bat += "    start `"`" `"$Root\desktop\Core.exe`"`r`n"
$bat += "    exit /b 0`r`n"
$bat += ")`r`n"
$bat += "echo Core desktop app is missing. Please reinstall Core.`r`n"
$bat += "pause`r`n"
[System.IO.File]::WriteAllText($launcherPath, $bat, [System.Text.Encoding]::ASCII)
OK "Launcher created: $launcherPath"

# ── 13. Task Scheduler auto-start at login ────────────────────────────────────
WAIT "Registering auto-start (Core POS Server)..."
try {
    $action    = New-ScheduledTaskAction `
                     -Execute   "$PhpBin" `
                     -Argument  "-c `"$PhpIni`" `"$BackendDir\artisan`" serve --host=127.0.0.1 --port=8080" `
                     -WorkingDirectory $BackendDir
    $trigger   = New-ScheduledTaskTrigger -AtLogon
    $settings  = New-ScheduledTaskSettingsSet `
                     -ExecutionTimeLimit  (New-TimeSpan -Seconds 0) `
                     -RestartCount        5 `
                     -RestartInterval     (New-TimeSpan -Minutes 1) `
                     -StartWhenAvailable `
                     -MultipleInstances   IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName "Core POS Server" -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName "Core POS Server" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    OK "Auto-start registered - Core POS starts with Windows"
} catch {
    Write-Host "  (Auto-start skipped: $($_.Exception.Message))" -ForegroundColor Yellow
}

# ── 14. Smoke test ────────────────────────────────────────────────────────────
WAIT "Running startup smoke test (verifying PHP + SQLite + login)..."
$smokePort      = 18081
$smokeBase      = "http://127.0.0.1:$smokePort"
$smokeCurrUrl   = "$smokeBase/api/currencies"
$smokeLoginUrl  = "$smokeBase/api/auth/login"
$smokeOut       = "$BackendDir\storage\logs\smoke-stdout.log"
$smokeErr       = "$BackendDir\storage\logs\smoke-stderr.log"
Remove-Item $smokeOut,$smokeErr -Force -ErrorAction SilentlyContinue

$smokeProc = Start-Process -FilePath $PhpBin -ArgumentList @(
    "-c",$PhpIni,"$BackendDir\artisan","serve","--host=127.0.0.1","--port=$smokePort"
) -WorkingDirectory $BackendDir -RedirectStandardOutput $smokeOut -RedirectStandardError $smokeErr -PassThru -WindowStyle Hidden

# Phase 1: wait for server to respond
$serverUp = $false
try {
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri $smokeCurrUrl -UseBasicParsing -TimeoutSec 5 -Headers @{ Accept="application/json" }
            $c = [int]$r.StatusCode
            if ($c -eq 200 -or $c -eq 401) { $serverUp = $true; break }
            if ($c -eq 500) { break }
        } catch {
            if ($_.Exception.Response) {
                $c = [int]$_.Exception.Response.StatusCode
                if ($c -eq 200 -or $c -eq 401) { $serverUp = $true; break }
                if ($c -eq 500) { break }
            }
        }
        if ($smokeProc.HasExited) { break }
    }
} catch {}

if (-not $serverUp) {
    if ($smokeProc -and -not $smokeProc.HasExited) { Stop-Process -Id $smokeProc.Id -Force -ErrorAction SilentlyContinue }
    $logTail = if (Test-Path "$BackendDir\storage\logs\laravel.log") { (Get-Content "$BackendDir\storage\logs\laravel.log" | Select-Object -Last 20) -join "`n" } else { "No laravel.log" }
    FAIL "Server did not start.`n`nLaravel log:`n$logTail"
}
OK "Server is up (PHP + SQLite responding)"

# Phase 2: test actual admin login
WAIT "Verifying admin login credentials..."
$loginOk = $false
try {
    $body = '{"username":"admin","password":"Admin@123"}'
    $r    = Invoke-WebRequest -Uri $smokeLoginUrl -Method POST -Body $body `
                -ContentType "application/json" -UseBasicParsing -TimeoutSec 15 `
                -Headers @{ Accept="application/json" }
    $json = $r.Content | ConvertFrom-Json
    if ($json.data.token -or $json.success -eq $true) { $loginOk = $true }
} catch { $loginOk = $false }

if ($smokeProc -and -not $smokeProc.HasExited) {
    Stop-Process -Id $smokeProc.Id -Force -ErrorAction SilentlyContinue
}

if (-not $loginOk) {
    $logTail = if (Test-Path "$BackendDir\storage\logs\laravel.log") { (Get-Content "$BackendDir\storage\logs\laravel.log" | Select-Object -Last 30) -join "`n" } else { "No laravel.log" }
    FAIL "Admin login test failed (admin / Admin@123 was rejected).`n`nLaravel log:`n$logTail"
}
OK "Admin login verified (credentials work)"

# ── 15. Desktop shortcut ──────────────────────────────────────────────────────
WAIT "Creating desktop shortcut..."
try {
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut("$env:PUBLIC\Desktop\Core.lnk")
    $lnk.TargetPath       = "$Root\desktop\Core.exe"
    $lnk.WorkingDirectory = $Root
    $lnk.Description      = "Core POS Point of Sale"
    $lnk.IconLocation     = "$Root\desktop\Core.exe,0"
    $lnk.Save()
    OK "Desktop shortcut created"
} catch {
    Write-Host "  (Shortcut skipped: $($_.Exception.Message))" -ForegroundColor Yellow
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host "    Core POS setup complete!" -ForegroundColor Green
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Login    : admin / Admin@123" -ForegroundColor Cyan
Write-Host "  Launch   : double-click 'Core' on the Desktop" -ForegroundColor White
Write-Host "  OR run   : $launcherPath" -ForegroundColor Gray
Write-Host ""
Read-Host "  Press Enter to close"
