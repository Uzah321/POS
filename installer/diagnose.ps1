<#
  Run this on the machine showing errors.
  Copy and paste the output back so we can fix it.
#>

$App = "C:\POS"
$php = "$App\php\php.exe"
$ini = "$App\php\php.ini"
$artisan = "$App\backend\artisan"
$mariaService = "CoreMariaDB"

Write-Host "`n===== CORE POS v1.2 DIAGNOSTIC =====" -ForegroundColor Cyan

# 1. .env
Write-Host "`n--- .env ---" -ForegroundColor Yellow
$envFile = "$App\backend\.env"
if (Test-Path $envFile) { Get-Content $envFile } else { Write-Host "MISSING - install.ps1 did not create it" -ForegroundColor Red }

# 2. MariaDB local service
Write-Host "`n--- MariaDB service ---" -ForegroundColor Yellow
$svc = Get-Service -Name $mariaService -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "$($svc.Name)  $($svc.Status)" -ForegroundColor Green
} else {
    Write-Host "MISSING  $mariaService" -ForegroundColor Red
}

# 3. Writable folder check
Write-Host "`n--- Writable folders ---" -ForegroundColor Yellow
foreach ($path in @("$App\backend\storage", "$App\backend\bootstrap\cache")) {
    if (!(Test-Path $path)) {
        Write-Host "MISSING  $path" -ForegroundColor Red
        continue
    }

    $probe = Join-Path $path ("write-test-" + [guid]::NewGuid().ToString("N") + ".tmp")
    try {
        Set-Content -Path $probe -Value "ok" -Encoding ASCII
        Remove-Item $probe -Force -ErrorAction SilentlyContinue
        Write-Host "WRITABLE  $path" -ForegroundColor Green
    } catch {
        Write-Host "NOT WRITABLE  $path" -ForegroundColor Red
        Write-Host $_.Exception.Message
    }
}

# 4. PHP extension test
Write-Host "`n--- PHP extensions ---" -ForegroundColor Yellow
if (Test-Path $php) {
    foreach ($ext in @('pdo_mysql','mysqli','mbstring','openssl','fileinfo','curl')) {
        $r = & $php -c $ini -r "echo extension_loaded('$ext') ? '[OK] $ext' : '[MISSING] $ext'; echo PHP_EOL;" 2>&1
        Write-Host $r
    }
} else {
    Write-Host "php.exe not found at $php" -ForegroundColor Red
}

# 5. Laravel bootstrap / DB check
Write-Host "`n--- Laravel bootstrap / DB check ---" -ForegroundColor Yellow
if ((Test-Path $php) -and (Test-Path $artisan)) {
    & $php -c $ini $artisan migrate:status --no-interaction 2>&1 | Select-Object -Last 40
} else {
    Write-Host "php.exe or artisan missing" -ForegroundColor Red
}

# 6. Laravel log (last 60 lines)
Write-Host "`n--- Laravel error log (last 60 lines) ---" -ForegroundColor Yellow
$log = "$App\backend\storage\logs\laravel.log"
if (Test-Path $log) {
    Get-Content $log | Select-Object -Last 60
} else {
    Write-Host "No laravel.log found - app may have never started successfully" -ForegroundColor Red
}

# 7. Embedded server log
Write-Host "`n--- Embedded server log (last 60 lines) ---" -ForegroundColor Yellow
$serverLog = "$App\backend\storage\logs\server.log"
if (Test-Path $serverLog) {
    Get-Content $serverLog | Select-Object -Last 60
} else {
    Write-Host "No server.log found yet" -ForegroundColor Yellow
}

Write-Host "`n===== END DIAGNOSTIC =====" -ForegroundColor Cyan
