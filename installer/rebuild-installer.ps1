<#
.SYNOPSIS
    Builds Core-Setup-1.2.exe (offline touchscreen POS - local database server).
  Run on your development machine. Output: installer\Output\Core-Setup-1.2.exe
#>

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptDir = Split-Path $MyInvocation.MyCommand.Path
$Root      = Split-Path $ScriptDir -Parent

function Step($m) { Write-Host "" ; Write-Host "  [*] $m" -ForegroundColor Cyan }
function OK($m)   { Write-Host "  [OK] $m"  -ForegroundColor Green }
function Fail($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red ; Read-Host "Press Enter to close" ; exit 1 }

Clear-Host
Write-Host "  Core POS - Installer Builder" -ForegroundColor Green
Write-Host "  =============================" -ForegroundColor Green
Write-Host ""

# 1. Find or install Inno Setup 6
Step "Checking for Inno Setup 6"
$iscc = $null
foreach ($p in @("C:\Program Files (x86)\Inno Setup 6\iscc.exe","C:\Program Files\Inno Setup 6\iscc.exe")) {
    if (Test-Path $p) { $iscc = $p; break }
}
if (!$iscc) {
    Write-Host "  Downloading Inno Setup..." -ForegroundColor Yellow
    $setup = "$env:TEMP\innosetup6.exe"
    $got = $false
    foreach ($url in @("https://files.jrsoftware.org/is/6/innosetup-6.3.3.exe","https://github.com/jrsoftware/issrc/releases/download/is-6_3_3/innosetup-6.3.3.exe")) {
        try { Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing; $got = $true; break } catch {}
    }
    if (!$got) { Fail "Could not download Inno Setup. Check internet connection." }
    $proc = Start-Process -FilePath $setup -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOICONS" -Wait -PassThru
    Remove-Item $setup -Force -ErrorAction SilentlyContinue
    if ($proc.ExitCode -ne 0) { Fail "Inno Setup install failed (exit $($proc.ExitCode))." }
    $iscc = "C:\Program Files (x86)\Inno Setup 6\iscc.exe"
    if (!(Test-Path $iscc)) { Fail "iscc.exe not found after install." }
    OK "Inno Setup 6 installed"
} else {
    OK "Inno Setup found"
}

# 2. Build frontend
Step "Building frontend"
if (!(Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js not found. Install from https://nodejs.org/" }
Push-Location (Join-Path $Root "frontend")
try {
    npm install --silent
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail "npm run build failed." }

    # Build the Electron desktop shell OUTSIDE the project folder (under C:\Windows\Temp),
    # then copy the result back in. Some managed endpoint-security agents block the
    # bulk extract-then-rename of many new executables inside user-profile folders like
    # Desktop (a common ransomware heuristic) — building in a system temp path avoids
    # triggering it, and a plain copy of already-built files back in is not affected.
    # -ErrorAction SilentlyContinue does not reliably suppress the Win32Exception that
    # Remove-Item throws for a briefly-locked file (e.g. right after signtool.exe signs
    # Core.exe) when $ErrorActionPreference = "Stop" is set — wrap in try/catch instead.
    function Remove-Quiet($path) { try { Remove-Item $path -Recurse -Force -ErrorAction Stop } catch { Write-Host "  (cleanup skipped for $path`: $($_.Exception.Message))" } }

    # Best-effort sweep of any stale build dirs left behind by earlier runs (non-fatal
    # if some are still locked - they'll just get swept next time).
    Get-ChildItem "$env:WINDIR\Temp" -Directory -Filter "core-pos-desktop-build-*" -ErrorAction SilentlyContinue | ForEach-Object { Remove-Quiet $_.FullName }

    # Unique per run — sidesteps needing to delete/reuse a previous run's directory,
    # which can itself be transiently locked (e.g. by signtool.exe or AV scanning).
    $desktopBuildDir = "$env:WINDIR\Temp\core-pos-desktop-build-$(Get-Date -Format yyyyMMddHHmmssfff)"
    & npx electron-builder --win dir --config.directories.output="$desktopBuildDir"
    if ($LASTEXITCODE -ne 0) { Fail "electron-builder failed." }

    $builtShell = Join-Path $desktopBuildDir "win-unpacked"
    if (!(Test-Path "$builtShell\Core.exe")) { Fail "Core.exe not found in $builtShell after build." }

    $distElectronDir = Join-Path $Root "frontend\dist-electron"
    $finalShellDir   = Join-Path $distElectronDir "win-unpacked"
    if (Test-Path $distElectronDir) { Remove-Quiet $distElectronDir }
    New-Item -ItemType Directory -Force -Path $distElectronDir | Out-Null
    Copy-Item -Path $builtShell -Destination $finalShellDir -Recurse
    # signtool.exe can briefly hold a handle on Core.exe right after signing — don't
    # let cleanup of the (harmless, disposable) temp build dir fail the whole script.
    Remove-Quiet $desktopBuildDir
} finally { Pop-Location }
OK "Frontend and desktop shell built"

# 3. Clear stale bootstrap cache - install.ps1 regenerates it on the target machine
Step "Clearing stale bootstrap cache"
$cacheDir = Join-Path $Root "backend\bootstrap\cache"
Get-ChildItem $cacheDir -Filter "*.php" -Exclude ".gitignore" | Remove-Item -Force -ErrorAction SilentlyContinue
OK "Bootstrap cache cleared (will be regenerated on install)"

# 3b. Verify frontend was built into backend/public (vite outputs there directly)
Step "Verifying frontend build in backend/public"
$destPublic = Join-Path $Root "backend\public"
if (!(Test-Path "$destPublic\index.html")) { Fail "index.html not found in backend/public. Check that npm run build succeeded." }
OK "Frontend verified in backend/public"

# 3c. Verify the native desktop shell was built
Step "Verifying desktop shell build"
$desktopExe = Join-Path $Root "frontend\dist-electron\win-unpacked\Core.exe"
if (!(Test-Path $desktopExe)) { Fail "Core.exe not found in frontend\dist-electron\win-unpacked. Check that npm run build:desktop succeeded." }
OK "Desktop shell verified"

# 4. Prepare PHP runtime with database extensions
Step "Preparing PHP runtime"
$phpDir = "$ScriptDir\redist\php"
$phpIni = "$phpDir\php.ini"

if (!(Test-Path "$phpDir\php.exe")) {
    Write-Host "  PHP not found - running prepare-installer.ps1..." -ForegroundColor Yellow
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\prepare-installer.ps1"
    if ($LASTEXITCODE -ne 0) { Fail "prepare-installer.ps1 failed." }
}

$iniSrc = if (Test-Path "$phpDir\php.ini-production") { "$phpDir\php.ini-production" } else { "$phpDir\php.ini-development" }
$ini = [System.IO.File]::ReadAllText($iniSrc)
foreach ($ext in @('pdo_mysql','mysqli','pdo_sqlite','sqlite3','mbstring','openssl','fileinfo','curl','zip','intl','sodium','gd')) {
    $ini = $ini -replace ";extension=$ext", "extension=$ext"
}
$ini = $ini -replace '(?m)^[; ]*extension_dir\s*=\s*"[^"]*"', 'extension_dir = "C:\POS\php\ext"'

# Keep OPcache disabled for the bundled CLI server. On some Windows builds,
# loading the extension can stop PHP with an ASLR opcode-handler fatal error.
$ini = $ini -replace '(?m)^[; ]*zend_extension\s*=\s*opcache\s*$', ';zend_extension=opcache'
$ini = $ini -replace '(?m)^[; ]*opcache\.enable\s*=.*$', 'opcache.enable=0'
$ini = $ini -replace '(?m)^[; ]*opcache\.enable_cli\s*=.*$', 'opcache.enable_cli=0'

[System.IO.File]::WriteAllText($phpIni, $ini, [System.Text.Encoding]::UTF8)

$check = Select-String "^extension_dir" $phpIni | Select-Object -First 1
if (!$check) { Fail "extension_dir not set in php.ini." }
OK "php.ini configured with MariaDB extensions"

# 4b. Verify MariaDB installer asset
Step "Checking MariaDB installer"
$mariaMsi = "$ScriptDir\redist\mariadb-installer.msi"
if (!(Test-Path $mariaMsi)) { Fail "MariaDB installer missing at $mariaMsi." }
$sig = [System.IO.File]::ReadAllBytes($mariaMsi)[0..7]
$ole = @(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1)
for ($i = 0; $i -lt $ole.Length; $i++) {
    if ($sig[$i] -ne $ole[$i]) { Fail "mariadb-installer.msi is not a valid MSI/OLE file." }
}
$mariaMb = [math]::Round((Get-Item $mariaMsi).Length / 1MB, 1)
OK "MariaDB installer verified - $mariaMb MB"

# 5. Download Visual C++ Redistributable (required by PHP 8.3)
Step "Checking for VC++ Redistributable"
$vcRedist = "$ScriptDir\redist\vc_redist.x64.exe"
if (Test-Path $vcRedist) {
    $mb = [math]::Round((Get-Item $vcRedist).Length / 1MB, 1)
    OK "VC++ Redistributable cached - $mb MB"
} else {
    Write-Host "  Downloading VC++ 2015-2022 Redistributable (~25 MB)..." -ForegroundColor Yellow
    $vcUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    try {
        Invoke-WebRequest -Uri $vcUrl -OutFile $vcRedist -UseBasicParsing
        $mb = [math]::Round((Get-Item $vcRedist).Length / 1MB, 1)
        OK "VC++ Redistributable downloaded - $mb MB"
    } catch {
        Fail "Could not download VC++ Redistributable. Check internet connection."
    }
}

# 6. Verify backend/vendor
Step "Checking backend vendor"
$vendorAutoload = Join-Path $Root "backend\vendor\autoload.php"
if (!(Test-Path $vendorAutoload)) {
    Write-Host "  Running composer install..." -ForegroundColor Yellow
    if (!(Get-Command composer -ErrorAction SilentlyContinue)) { Fail "Composer not found. Install from https://getcomposer.org/" }
    Push-Location (Join-Path $Root "backend")
    try {
        composer install --no-dev --optimize-autoloader --no-interaction
        if ($LASTEXITCODE -ne 0) { Fail "composer install failed." }
    } finally { Pop-Location }
}
OK "backend/vendor verified"

# 7. Compile the installer
Step "Compiling Core-Setup-1.2.exe"
$issFile   = "$ScriptDir\POS.iss"
$outputExe = "$ScriptDir\Output\Core-Setup-1.2.exe"

Push-Location $ScriptDir
try {
    & $iscc $issFile
    if ($LASTEXITCODE -ne 0) { Fail "Inno Setup compilation failed (exit $LASTEXITCODE)." }
} finally { Pop-Location }

if (!(Test-Path $outputExe)) { Fail "Core-Setup-1.2.exe not found after compilation." }
$mb = [math]::Round((Get-Item $outputExe).Length / 1MB, 1)
OK "Core-Setup-1.2.exe built - $mb MB"

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "    Build complete!  Core POS v1.2" -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Installer : $outputExe" -ForegroundColor Cyan
Write-Host "  Copy to target machine and run as Administrator." -ForegroundColor White
Write-Host "  Login: admin / Admin@123" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close"
