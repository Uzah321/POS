<#
.SYNOPSIS
  Run this script ONCE on this machine to download PHP and prepare all assets
  needed to build the Core self-contained installer .exe.
  After this runs successfully, compile POS.iss with Inno Setup 6.
#>

param()
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root        = Split-Path $PSScriptRoot -Parent
$RedistDir   = "$PSScriptRoot\redist"
$PhpDir      = "$RedistDir\php"

function OK($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function WAIT($m) { Write-Host "  [...] $m" -ForegroundColor Yellow }
function ERR($m)  { Write-Host "`n  [ERROR] $m`n" -ForegroundColor Red; exit 1 }

Clear-Host
Write-Host ""
Write-Host "  Core POS - Installer Preparation" -ForegroundColor Cyan
Write-Host "  =================================" -ForegroundColor Cyan
Write-Host ""

# -- 1. Verify backend vendor is installed ------------------------------------
WAIT "Checking backend/vendor..."
if (!(Test-Path "$Root\backend\vendor\autoload.php")) {
    ERR "backend\vendor\ not found.`n     Run: cd backend && composer install --no-dev --optimize-autoloader"
}
OK "backend/vendor verified"

# -- 2. Verify frontend is built and deployed ---------------------------------
WAIT "Checking backend/public/index.html..."
if (!(Test-Path "$Root\backend\public\index.html")) {
    ERR "backend\public\index.html not found.`n     Run: cd frontend && npm run build`n     Then: installer\deploy-frontend.bat"
}
OK "Frontend assets verified"

# -- 3. Create redist directory -----------------------------------------------
if (!(Test-Path $RedistDir)) { New-Item -ItemType Directory -Path $RedistDir -Force | Out-Null }

# -- 4. Download PHP 8.3 NTS x64 ---------------------------------------------
if (Test-Path "$PhpDir\php.exe") {
    OK "PHP already in installer\redist\php\ - skipping download"
} else {
    WAIT "Downloading PHP 8.3 NTS x64 (~30 MB)..."
    $PhpZip = "$RedistDir\php-nts.zip"

    $phpUrls = @(
        "https://windows.php.net/downloads/releases/php-8.3.22-nts-Win32-vs16-x64.zip",
        "https://windows.php.net/downloads/releases/php-8.3.21-nts-Win32-vs16-x64.zip",
        "https://windows.php.net/downloads/releases/php-8.3.20-nts-Win32-vs16-x64.zip"
    )
    $downloaded = $false
    foreach ($url in $phpUrls) {
        try {
            Write-Host "    Trying $url" -ForegroundColor DarkGray
            Invoke-WebRequest -Uri $url -OutFile $PhpZip -UseBasicParsing
            $downloaded = $true
            break
        } catch { }
    }
    if (!$downloaded) {
        ERR "Could not download PHP automatically.`n     Please download the PHP 8.3 NTS x64 ZIP from https://windows.php.net/download/`n     and extract it to: $PhpDir"
    }

    WAIT "Extracting PHP..."
    if (!(Test-Path $PhpDir)) { New-Item -ItemType Directory -Path $PhpDir -Force | Out-Null }
    Expand-Archive -Path $PhpZip -DestinationPath $PhpDir -Force
    Remove-Item $PhpZip -Force
    OK "PHP extracted to installer\redist\php\"
}

# -- 5. Build php.ini with required extensions enabled -------------------------
WAIT "Building php.ini..."
$iniSrc = if (Test-Path "$PhpDir\php.ini-production") { "$PhpDir\php.ini-production" } else { "$PhpDir\php.ini-development" }
$ini = Get-Content $iniSrc -Raw

$ini = $ini -replace ';extension=pdo_mysql',  'extension=pdo_mysql'
$ini = $ini -replace ';extension=mysqli',     'extension=mysqli'
$ini = $ini -replace ';extension=pdo_sqlite', 'extension=pdo_sqlite'
$ini = $ini -replace ';extension=sqlite3',    'extension=sqlite3'
$ini = $ini -replace ';extension=mbstring',   'extension=mbstring'
$ini = $ini -replace ';extension=openssl',    'extension=openssl'
$ini = $ini -replace ';extension=fileinfo',   'extension=fileinfo'
$ini = $ini -replace ';extension=curl',       'extension=curl'
$ini = $ini -replace ';extension=zip',        'extension=zip'
$ini = $ini -replace ';extension=intl',       'extension=intl'
$ini = $ini -replace ';extension=sodium',     'extension=sodium'
$ini = $ini -replace ';extension=gd',         'extension=gd'

# Set absolute extension_dir so PHP finds the DLLs regardless of working directory.
# php.ini-production ships with this line commented as '; extension_dir = "ext"'.
$ini = $ini -replace '(?m)^[; ]*extension_dir\s*=\s*"ext"\s*$', 'extension_dir = "C:\POS\php\ext"'

# Keep OPcache disabled for the bundled CLI server. On some Windows builds,
# loading the extension can stop PHP with an ASLR opcode-handler fatal error.
$ini = $ini -replace '(?m)^[; ]*zend_extension\s*=\s*opcache\s*$', ';zend_extension=opcache'
$ini = $ini -replace '(?m)^[; ]*opcache\.enable\s*=.*$', 'opcache.enable=0'
$ini = $ini -replace '(?m)^[; ]*opcache\.enable_cli\s*=.*$', 'opcache.enable_cli=0'

[System.IO.File]::WriteAllText("$PhpDir\php.ini", $ini)
OK "php.ini configured (extensions enabled)"

# -- Done ---------------------------------------------------------------------
Write-Host ""
Write-Host "  All files ready!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "  1. Install Inno Setup 6 (free): https://jrsoftware.org/isdl.php" -ForegroundColor White
Write-Host "  2. Compile the installer (one of):" -ForegroundColor White
Write-Host "       iscc `"$PSScriptRoot\POS.iss`"" -ForegroundColor Gray
Write-Host "       OR open POS.iss in Inno Setup IDE and press F9" -ForegroundColor Gray
Write-Host "  3. Installer output: $PSScriptRoot\Output\Core-Setup.exe" -ForegroundColor White
Write-Host ""
