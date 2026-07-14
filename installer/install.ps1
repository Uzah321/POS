<#
.SYNOPSIS
  Core POS post-install setup. Called by Inno Setup after extracting all files.
    Configures PHP, installs local MariaDB, runs migrations and seeds.

.DESCRIPTION
  Supports two roles for LAN deployments where several tills share one database:

    Main Server  - installs MariaDB locally (as today), opens it up for LAN
                   clients, and provisions the schema + seed data. Do this on
                   exactly ONE machine, first.

    Workstation  - skips installing MariaDB locally; instead points this
                   machine's backend at the Main Server's shared database over
                   the network. Run the Main Server install first, then run
                   this on every other till, supplying its IP/hostname.

  Pass -ServerMode to skip the interactive prompt (e.g. for scripted installs):
    -ServerMode main
    -ServerMode workstation -ServerHost 192.168.1.10 -ServerPort 3307
#>
param(
    [string]$AppDir = "C:\POS",
    [ValidateSet("", "main", "workstation")]
    [string]$ServerMode = "",
    [string]$ServerHost = "",
    [string]$ServerPort = ""
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Core POS Setup"

function Log($m)  { Write-Host "  $m" }
function OK($m)   { Write-Host "  [OK] $m"    -ForegroundColor Green }
function WAIT($m) { Write-Host "  [...] $m"   -ForegroundColor Yellow }
function ERR($m)  {
    Write-Host ""
    Write-Host "  [ERROR] $m" -ForegroundColor Red
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
}
function Set-Or-AddEnvValue([string]$text, [string]$key, [string]$value) {
    if ($text -match "(?m)^$key=") {
        $replacement = [System.Text.RegularExpressions.MatchEvaluator]{ param($match) "$key=$value" }
        return [Regex]::Replace($text, "(?m)^$key=.*$", $replacement)
    }

    if ($text.Length -gt 0 -and !$text.EndsWith("`r`n") -and !$text.EndsWith("`n")) {
        $text += "`r`n"
    }

    return $text + "$key=$value`r`n"
}

function Stop-CoreServerProcesses {
    Stop-ScheduledTask -TaskName "Core POS Server" -ErrorAction SilentlyContinue

    try {
        Get-CimInstance Win32_Process -Filter "Name = 'php.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $php) } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch {}
}

function Test-LocalCoreServer([int]$port = 8080, [int]$attempts = 20) {
    $url = "http://127.0.0.1:$port/api/currencies"

    for ($attempt = 0; $attempt -lt $attempts; $attempt++) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -Headers @{ "Accept" = "application/json" }
            $c = [int]$r.StatusCode
            if ($c -eq 200 -or $c -eq 401) { return $true }
        } catch {
            if ($_.Exception.Response) {
                $c = [int]$_.Exception.Response.StatusCode
                if ($c -eq 200 -or $c -eq 401) { return $true }
            }
        }
        Start-Sleep -Seconds 1
    }

    return $false
}

Clear-Host
Write-Host ""
Write-Host "  Core POS v1.2 - First-Time Setup" -ForegroundColor Cyan
Write-Host "  =================================" -ForegroundColor Cyan
Write-Host "  Installing to: $AppDir" -ForegroundColor Gray
Write-Host ""

# STEP 0: Main Server vs Workstation
# Lets several tills on the same LAN share one database. Main Server installs
# MariaDB locally and opens it to the network; Workstation skips its own
# database entirely and points at the Main Server's shared one instead.
if ($ServerMode -eq "") {
    Write-Host "  Is this machine the MAIN SERVER or a WORKSTATION?" -ForegroundColor Cyan
    Write-Host "    [1] Main Server  - hosts the shared database (set this up on ONE machine first)" -ForegroundColor White
    Write-Host "    [2] Workstation  - connects to an existing Main Server on this network" -ForegroundColor White
    Write-Host ""
    $choice = Read-Host "  Enter 1 or 2 (press Enter for 1 - Main Server)"
    if ($choice.Trim() -eq "2") { $ServerMode = "workstation" } else { $ServerMode = "main" }
    Write-Host ""
}
$isWorkstation = ($ServerMode -eq "workstation")

if ($isWorkstation) {
    if ($ServerHost -eq "") {
        $ServerHost = Read-Host "  Enter the Main Server's IP address or hostname (e.g. 192.168.1.10)"
    }
    if ($ServerHost.Trim() -eq "") { ERR "A Main Server address is required for a Workstation install." }
    $ServerHost = $ServerHost.Trim()
    if ($ServerPort.Trim() -eq "") { $ServerPort = "3307" }
    Write-Host ""
    Write-Host "  Workstation mode: connecting to shared database at ${ServerHost}:${ServerPort}" -ForegroundColor Gray
} else {
    Write-Host "  Main Server mode: this machine will host the shared database" -ForegroundColor Gray
}
Write-Host ""

$php         = "$AppDir\php\php.exe"
$phpIni      = "$AppDir\php\php.ini"
$artisan     = "$AppDir\backend\artisan"
$envFile     = "$AppDir\backend\.env"
$vcRedist    = "$AppDir\redist\vc_redist.x64.exe"
$mariaMsi    = "$AppDir\redist\mariadb-installer.msi"
$laravelLog  = "$AppDir\backend\storage\logs\laravel.log"
$mariaInstallLog = "$AppDir\mariadb-install.log"
$mariaUninstallLog = "$AppDir\mariadb-uninstall.log"

$dbHost          = if ($isWorkstation) { $ServerHost } else { "127.0.0.1" }
$dbPort          = if ($isWorkstation) { $ServerPort } else { "3307" }
$dbName          = "core_pos"
$dbUser          = "core_pos"
$dbPassword      = "CorePosDb@2026"
$mariaRootPass   = "CoreRoot@2026"
$mariaService    = "CoreMariaDB"
$mariaInstallDir = "$AppDir\MariaDB"
$mariaDataDir    = "$AppDir\MariaDB\data"
$dbLanAllowHost  = "%"

$phpRuntimeArgs = @(
    "-n",
    "-d", "extension_dir=$AppDir\php\ext",
    "-d", "extension=pdo_mysql",
    "-d", "extension=mysqli",
    "-d", "extension=pdo_sqlite",
    "-d", "extension=sqlite3",
    "-d", "extension=mbstring",
    "-d", "extension=openssl",
    "-d", "extension=fileinfo",
    "-d", "extension=curl",
    "-d", "extension=zip",
    "-d", "extension=intl",
    "-d", "extension=sodium",
    "-d", "extension=gd",
    "-d", "date.timezone=UTC",
    "-d", "opcache.enable=0",
    "-d", "opcache.enable_cli=0"
)

function Get-PhpRuntimeArgumentString {
    return '-n -d "extension_dir=' + $AppDir + '\php\ext" -d extension=pdo_mysql -d extension=mysqli -d extension=pdo_sqlite -d extension=sqlite3 -d extension=mbstring -d extension=openssl -d extension=fileinfo -d extension=curl -d extension=zip -d extension=intl -d extension=sodium -d extension=gd -d date.timezone=UTC -d opcache.enable=0 -d opcache.enable_cli=0'
}

function Test-MsiSuccessExitCode([int]$exitCode) {
    return ($exitCode -eq 0 -or $exitCode -eq 3010)
}

function Invoke-MariaDbMsiInstall {
    if (!(Test-Path $mariaMsi)) { ERR "MariaDB installer missing at $mariaMsi. The installer package is incomplete." }

    $msiArgs = @(
        "/i", "`"$mariaMsi`"",
        "/qn", "/norestart", "/L*v", "`"$mariaInstallLog`"",
        "SERVICENAME=$mariaService",
        "PASSWORD=$mariaRootPass",
        "PORT=$dbPort",
        "UTF8=1",
        "INSTALLDIR=`"$mariaInstallDir`"",
        "DATADIR=`"$mariaDataDir`""
    ) -join " "

    $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
    if (!(Test-MsiSuccessExitCode -exitCode $proc.ExitCode)) { ERR "MariaDB installation failed with exit code $($proc.ExitCode)." }
}

function Invoke-MariaDbMsiUninstall {
    if (!(Test-Path $mariaMsi)) { return }

    $msiArgs = @(
        "/x", "`"$mariaMsi`"",
        "/qn", "/norestart", "/L*v", "`"$mariaUninstallLog`""
    ) -join " "

    $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru -ErrorAction SilentlyContinue
    if ($proc -and (@(0, 1605, 1614, 3010) -notcontains [int]$proc.ExitCode)) {
        Log "(MariaDB cleanup returned exit code $($proc.ExitCode); continuing with install retry)"
    }
}

function Find-MySqlClient {
    $candidates = @(
        "$mariaInstallDir\bin\mysql.exe",
        "$AppDir\MariaDB\bin\mysql.exe"
    )

    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }

    $matches = Get-ChildItem "C:\Program Files\MariaDB*\bin\mysql.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending
    if ($matches) { return $matches[0].FullName }

    return $null
}

function Find-MySqlDumpClient {
    $candidates = @(
        "$mariaInstallDir\bin\mysqldump.exe",
        "$AppDir\MariaDB\bin\mysqldump.exe"
    )

    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }

    $matches = Get-ChildItem "C:\Program Files\MariaDB*\bin\mysqldump.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending
    if ($matches) { return $matches[0].FullName }

    return $null
}

function Invoke-MySql([string]$sql, [string]$user = "root", [string]$password = $mariaRootPass) {
    $mysql = Find-MySqlClient
    if (!$mysql) { ERR "mysql.exe not found after MariaDB installation." }

    $args = @(
        "--protocol=tcp",
        "--host=$dbHost",
        "--port=$dbPort",
        "--user=$user",
        "--password=$password",
        "--execute=$sql"
    )
    $out = & $mysql @args 2>&1
    if ($LASTEXITCODE -ne 0) { ERR "MariaDB command failed.`n$out" }
    return $out
}

function Invoke-MySqlScalar([string]$sql, [string]$user = "root", [string]$password = $mariaRootPass) {
    $mysql = Find-MySqlClient
    if (!$mysql) { return $null }

    $args = @(
        "--batch",
        "--skip-column-names",
        "--protocol=tcp",
        "--host=$dbHost",
        "--port=$dbPort",
        "--user=$user",
        "--password=$password",
        "--execute=$sql"
    )
    $out = & $mysql @args 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    return (($out | Out-String).Trim())
}

function Test-CoreDatabaseExists {
    $out = Invoke-MySqlScalar "SELECT COUNT(*) FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '$dbName';"
    return ($out -match '^\s*[1-9]')
}

function Test-CoreTableExists([string]$tableName) {
    $out = Invoke-MySqlScalar "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '$dbName' AND TABLE_NAME = '$tableName';"
    return ($out -match '^\s*[1-9]')
}

function Get-CoreTableRowCount([string]$tableName) {
    $out = Invoke-MySqlScalar "SELECT COUNT(*) FROM $dbName.$tableName;"
    if ($out -match '^\s*(\d+)') { return [int]$matches[1] }
    return 0
}

function Backup-CoreDatabaseForUpdate {
    $mysqldump = Find-MySqlDumpClient
    if (!$mysqldump) { ERR "mysqldump.exe not found. Refusing to update without a database backup." }

    $backupDir = Join-Path $AppDir "backups"
    if (!(Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupFile = Join-Path $backupDir "core_pos-before-update-$stamp.sql"
    $backupErr = Join-Path $backupDir "core_pos-before-update-$stamp.err.log"

    $args = @(
        "--protocol=tcp",
        "--host=$dbHost",
        "--port=$dbPort",
        "--user=root",
        "--password=$mariaRootPass",
        "--single-transaction",
        "--routines",
        "--events",
        "--databases",
        $dbName
    )

    $proc = Start-Process -FilePath $mysqldump -ArgumentList $args -RedirectStandardOutput $backupFile -RedirectStandardError $backupErr -WindowStyle Hidden -Wait -PassThru
    if ($proc.ExitCode -ne 0 -or !(Test-Path $backupFile) -or (Get-Item $backupFile).Length -eq 0) {
        $backupTail = if (Test-Path $backupErr) { (Get-Content $backupErr | Select-Object -Last 20) -join "`n" } else { "No backup error log" }
        ERR "Could not create database backup before update. Existing database was not changed.`n`n$backupTail"
    }

    Remove-Item $backupErr -Force -ErrorAction SilentlyContinue
    OK "Database backup created: $backupFile"
}

function Wait-ForMariaDb {
    $candidatePorts = @([int]$dbPort, 3306) | Select-Object -Unique

    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        foreach ($port in $candidatePorts) {
            try {
                $client = New-Object System.Net.Sockets.TcpClient
                $iar = $client.BeginConnect($dbHost, [int]$port, $null, $null)
                if ($iar.AsyncWaitHandle.WaitOne(1000, $false)) {
                    $client.EndConnect($iar)
                    $client.Close()
                    $script:dbPort = [string]$port
                    return $true
                }
                $client.Close()
            } catch {}
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Resolve-MariaDbServiceName {
    $preferred = Get-Service -Name $mariaService -ErrorAction SilentlyContinue
    if ($preferred) { return $preferred.Name }

    foreach ($name in @('MariaDB', 'MySQL')) {
        $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($svc) { return $svc.Name }
    }

    $match = Get-Service -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '*MariaDB*' -or $_.DisplayName -like '*MariaDB*' } |
        Select-Object -First 1
    if ($match) { return $match.Name }

    return $null
}

function Get-MariaDbDiagnostics {
    $parts = New-Object System.Collections.Generic.List[string]
    $parts.Add("Requested service: $mariaService")
    $parts.Add("Current service: $mariaService")
    $parts.Add("Requested ports checked: $dbPort, 3306")

    try {
        $services = Get-Service -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*MariaDB*' -or $_.DisplayName -like '*MariaDB*' -or $_.Name -like '*MySQL*' -or $_.DisplayName -like '*MySQL*' } |
            Select-Object Name, Status, DisplayName
        $parts.Add("Services:`n" + (($services | Format-Table -AutoSize | Out-String).Trim()))
    } catch {}

    try {
        $ports = netstat -ano | Select-String ':3306|:3307'
        $parts.Add("Ports:`n" + (($ports | Out-String).Trim()))
    } catch {}

    if (Test-Path $mariaInstallLog) {
        $parts.Add("MariaDB MSI log tail:`n" + ((Get-Content $mariaInstallLog | Select-Object -Last 40) -join "`n"))
    }

    if (Test-Path $mariaUninstallLog) {
        $parts.Add("MariaDB MSI cleanup log tail:`n" + ((Get-Content $mariaUninstallLog | Select-Object -Last 40) -join "`n"))
    }

    $errLogs = @()
    foreach ($path in @($mariaDataDir, "$mariaInstallDir\data", "C:\Program Files\MariaDB*\data")) {
        $errLogs += Get-ChildItem $path -Filter "*.err" -ErrorAction SilentlyContinue
    }
    foreach ($log in ($errLogs | Select-Object -First 3)) {
        $parts.Add("MariaDB error log ($($log.FullName)):`n" + ((Get-Content $log.FullName | Select-Object -Last 40) -join "`n"))
    }

    return ($parts -join "`n`n")
}

function Ensure-MariaDbService {
    $preferred = Get-Service -Name $mariaService -ErrorAction SilentlyContinue
    if ($preferred) { return $preferred.Name }

    Invoke-MariaDbMsiInstall

    $resolvedService = Resolve-MariaDbServiceName
    if ($resolvedService) { return $resolvedService }

    Log "(MariaDB MSI completed but no service was created; clearing stale MSI registration and retrying)"
    Invoke-MariaDbMsiUninstall
    Invoke-MariaDbMsiInstall

    $resolvedService = Resolve-MariaDbServiceName
    if ($resolvedService) { return $resolvedService }

    ERR "MariaDB service was not found after installation.`n`n$(Get-MariaDbDiagnostics)"
}

function Test-RemoteDbReachable([string]$targetHost, [int]$port, [int]$attempts = 30) {
    for ($attempt = 0; $attempt -lt $attempts; $attempt++) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $iar = $client.BeginConnect($targetHost, $port, $null, $null)
            if ($iar.AsyncWaitHandle.WaitOne(1500, $false)) {
                $client.EndConnect($iar)
                $client.Close()
                return $true
            }
            $client.Close()
        } catch {}
        Start-Sleep -Seconds 1
    }
    return $false
}

function Find-MariaDbConfigFile {
    $candidates = @(
        "$mariaDataDir\my.ini",
        "$mariaInstallDir\my.ini",
        "$mariaInstallDir\data\my.ini"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }

    $matches = Get-ChildItem "C:\Program Files\MariaDB*\data\my.ini", "C:\Program Files\MariaDB*\my.ini" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending
    if ($matches) { return $matches[0].FullName }

    return $null
}

function Enable-MariaDbLanAccess {
    # MariaDB's Windows packages often ship with an explicit loopback-only
    # bind-address for security-by-default. Open it to all interfaces so
    # Workstation installs on the LAN can reach it; Windows Firewall (below)
    # and the DB user's own credentials remain the real access boundary.
    $configFile = Find-MariaDbConfigFile
    if (!$configFile) {
        Log "(Could not locate MariaDB's my.ini - skipping bind-address change; LAN access may still work if this build already listens on all interfaces)"
        return
    }

    $cfg = [System.IO.File]::ReadAllText($configFile)
    if ($cfg -match '(?m)^\s*bind-address\s*=\s*0\.0\.0\.0\s*$') {
        Log "(MariaDB already configured to listen on all interfaces)"
        return
    }

    if ($cfg -match '(?m)^\s*bind-address\s*=.*$') {
        $cfg = [Regex]::Replace($cfg, '(?m)^\s*bind-address\s*=.*$', 'bind-address=0.0.0.0')
    } elseif ($cfg -match '(?m)^\[mysqld\]\s*$') {
        $cfg = [Regex]::Replace($cfg, '(?m)^\[mysqld\]\s*$', "[mysqld]`r`nbind-address=0.0.0.0", 1)
    } else {
        $cfg += "`r`n[mysqld]`r`nbind-address=0.0.0.0`r`n"
    }

    [System.IO.File]::WriteAllText($configFile, $cfg, [System.Text.Encoding]::UTF8)

    try {
        Restart-Service -Name $mariaService -Force -ErrorAction Stop
        if (!(Wait-ForMariaDb)) { ERR "MariaDB did not come back up after enabling LAN access.`n`n$(Get-MariaDbDiagnostics)" }
        OK "MariaDB is now listening on all network interfaces"
    } catch {
        ERR "Could not restart MariaDB after enabling LAN access: $($_.Exception.Message)"
    }
}

function Open-MariaDbFirewallPort {
    try {
        $fwRuleName = "Core POS Database (port $dbPort)"
        if (-not (Get-NetFirewallRule -DisplayName $fwRuleName -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule `
                -DisplayName $fwRuleName `
                -Direction Inbound `
                -Action Allow `
                -Protocol TCP `
                -LocalPort $dbPort `
                -Profile Domain,Private | Out-Null
            OK "Firewall rule added - Workstations on this network can reach the shared database"
        } else {
            OK "Database firewall rule already present"
        }
    } catch {
        Log "(Firewall rule skipped: $($_.Exception.Message) - Workstations may need a manual firewall exception for port $dbPort)"
    }
}

function Show-LanAddressForWorkstations {
    try {
        $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.IPAddress -notlike '127.*' -and
                $_.IPAddress -notlike '169.254.*' -and
                $_.PrefixOrigin -ne 'WellKnown'
            } |
            Select-Object -ExpandProperty IPAddress
        if ($ips) {
            Write-Host ""
            Write-Host "  This machine's network address(es) - use one of these when installing" -ForegroundColor Cyan
            Write-Host "  Core as a Workstation on other tills:" -ForegroundColor Cyan
            foreach ($ip in $ips) { Write-Host "    $ip" -ForegroundColor White }
        }
    } catch {}
}

# STEP 1: Verify PHP
WAIT "Checking PHP runtime..."
if (!(Test-Path $php)) { ERR "PHP not found at $php. The installer package may be incomplete." }
OK "PHP found"

WAIT "Stopping previous local server if running..."
Stop-CoreServerProcesses
OK "Previous local server stopped"

# STEP 1b: Install Visual C++ Redistributable (required by PHP 8.3)
WAIT "Installing Visual C++ Runtime..."
if (Test-Path $vcRedist) {
    Start-Process -FilePath $vcRedist -ArgumentList "/install /quiet /norestart" -Wait -ErrorAction SilentlyContinue
    Remove-Item $vcRedist -Force -ErrorAction SilentlyContinue
    OK "Visual C++ Runtime installed"
} else {
    OK "Visual C++ Runtime already present (or installer not bundled)"
}

# STEP 2: Configure PHP extensions for MariaDB
WAIT "Configuring PHP extensions..."
$ini = [System.IO.File]::ReadAllText($phpIni)

$ini = $ini -replace '(?m)^[; ]*extension_dir\s*=\s*"[^"]*"', "extension_dir = `"$AppDir\php\ext`""
foreach ($ext in @('pdo_mysql','mysqli','pdo_sqlite','sqlite3','mbstring','openssl','fileinfo','curl','zip','intl','sodium','gd')) {
    $ini = $ini -replace ";extension=$ext", "extension=$ext"
}

# Keep OPcache disabled for the bundled CLI server. On some Windows builds,
# loading the extension can stop PHP with an ASLR opcode-handler fatal error.
$ini = $ini -replace '(?m)^[; ]*zend_extension\s*=\s*opcache\s*$', ";zend_extension=opcache"
$ini = $ini -replace '(?m)^[; ]*opcache\.enable\s*=.*$', "opcache.enable=0"
$ini = $ini -replace '(?m)^[; ]*opcache\.enable_cli\s*=.*$', "opcache.enable_cli=0"

[System.IO.File]::WriteAllText($phpIni, $ini, [System.Text.Encoding]::UTF8)
OK "PHP configured for MariaDB"

# STEP 3: Database - install locally (Main Server) or connect to the shared one (Workstation)
if ($isWorkstation) {
    WAIT "Connecting to Main Server database at ${dbHost}:${dbPort}..."
    if (!(Test-RemoteDbReachable -targetHost $dbHost -port ([int]$dbPort))) {
        ERR ("Could not reach the Main Server's database at ${dbHost}:${dbPort}.`n`n" +
             "Check that:`n" +
             "  - The Main Server machine is turned on and Core is installed there as 'Main Server'`n" +
             "  - Both machines are on the same network`n" +
             "  - Windows Firewall on the Main Server allows port $dbPort (its installer opens this automatically)")
    }
    OK "Connected to shared database at ${dbHost}:${dbPort}"
    $isUpdateInstall = $false
} else {
    WAIT "Installing local MariaDB database server..."
    $resolvedService = Ensure-MariaDbService
    $mariaService = $resolvedService

    try {
        Set-Service -Name $mariaService -StartupType Automatic -ErrorAction Stop
    } catch {
        Log "(MariaDB startup type was not changed: $($_.Exception.Message))"
    }

    try {
        Start-Service -Name $mariaService -ErrorAction Stop
    } catch {
        Log "(MariaDB service start reported: $($_.Exception.Message))"
    }

    if (!(Wait-ForMariaDb)) { ERR "MariaDB service did not start on ${dbHost}:${dbPort} or ${dbHost}:3306.`n`n$(Get-MariaDbDiagnostics)" }
    OK "MariaDB service is running locally on port $dbPort"

    WAIT "Opening the database for other tills on this network..."
    Enable-MariaDbLanAccess
    Open-MariaDbFirewallPort

    $databaseExistedBeforeSetup = Test-CoreDatabaseExists
    $usersExistedBeforeSetup = $false
    if ($databaseExistedBeforeSetup -and (Test-CoreTableExists "users")) {
        $usersExistedBeforeSetup = ((Get-CoreTableRowCount "users") -gt 0)
    }
    $isUpdateInstall = ($databaseExistedBeforeSetup -and $usersExistedBeforeSetup)

    WAIT "Preparing Core database and user..."
    $setupSql = @"
CREATE DATABASE IF NOT EXISTS $dbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$dbUser'@'127.0.0.1' IDENTIFIED BY '$dbPassword';
CREATE USER IF NOT EXISTS '$dbUser'@'localhost' IDENTIFIED BY '$dbPassword';
CREATE USER IF NOT EXISTS '$dbUser'@'$dbLanAllowHost' IDENTIFIED BY '$dbPassword';
ALTER USER '$dbUser'@'127.0.0.1' IDENTIFIED BY '$dbPassword';
ALTER USER '$dbUser'@'localhost' IDENTIFIED BY '$dbPassword';
ALTER USER '$dbUser'@'$dbLanAllowHost' IDENTIFIED BY '$dbPassword';
GRANT ALL PRIVILEGES ON $dbName.* TO '$dbUser'@'127.0.0.1';
GRANT ALL PRIVILEGES ON $dbName.* TO '$dbUser'@'localhost';
GRANT ALL PRIVILEGES ON $dbName.* TO '$dbUser'@'$dbLanAllowHost';
FLUSH PRIVILEGES;
"@
    Invoke-MySql $setupSql | Out-Null
    if ($databaseExistedBeforeSetup) {
        OK "MariaDB database ready - existing data preserved"
    } else {
        OK "MariaDB database ready"
    }

    if ($isUpdateInstall) {
        WAIT "Backing up existing database before update..."
        Backup-CoreDatabaseForUpdate
    }
}

# STEP 4: Write .env
WAIT "Writing application configuration..."
$envText = if (Test-Path $envFile) { Get-Content $envFile -Raw } else { "" }

# Remove any stale MySQL/PostgreSQL settings
$envText = [Regex]::Replace($envText, "(?m)^DB_HOST=.*$", "")
$envText = [Regex]::Replace($envText, "(?m)^DB_PORT=.*$", "")
$envText = [Regex]::Replace($envText, "(?m)^DB_DATABASE=.*$", "")
$envText = [Regex]::Replace($envText, "(?m)^DB_USERNAME=.*$", "")
$envText = [Regex]::Replace($envText, "(?m)^DB_PASSWORD=.*$", "")

$envText = Set-Or-AddEnvValue $envText "APP_NAME" "Core"
$envText = Set-Or-AddEnvValue $envText "APP_ENV" "production"
$envText = Set-Or-AddEnvValue $envText "APP_DEBUG" "false"
$envText = Set-Or-AddEnvValue $envText "APP_URL" "http://127.0.0.1:8080"
$envText = Set-Or-AddEnvValue $envText "FRONTEND_URL" "http://127.0.0.1:8080"
$envText = Set-Or-AddEnvValue $envText "OFFLINE_MODE" "true"
$envText = Set-Or-AddEnvValue $envText "LOG_CHANNEL" "single"
$envText = Set-Or-AddEnvValue $envText "LOG_LEVEL" "error"
$envText = Set-Or-AddEnvValue $envText "DB_CONNECTION" "mariadb"
$envText = Set-Or-AddEnvValue $envText "DB_HOST" $dbHost
$envText = Set-Or-AddEnvValue $envText "DB_PORT" $dbPort
$envText = Set-Or-AddEnvValue $envText "DB_DATABASE" $dbName
$envText = Set-Or-AddEnvValue $envText "DB_USERNAME" $dbUser
$envText = Set-Or-AddEnvValue $envText "DB_PASSWORD" $dbPassword
$envText = Set-Or-AddEnvValue $envText "DB_CHARSET" "utf8mb4"
$envText = Set-Or-AddEnvValue $envText "DB_COLLATION" "utf8mb4_unicode_ci"
if (-not $isWorkstation) {
    # Workstations have no local mysqldump.exe (no local MariaDB install) - backups
    # of the shared database should be taken from the Main Server instead.
    $envText = Set-Or-AddEnvValue $envText "DB_DUMP_PATH" "$mariaInstallDir\bin\mysqldump.exe"
}
$envText = Set-Or-AddEnvValue $envText "SESSION_DRIVER" "file"
$envText = Set-Or-AddEnvValue $envText "QUEUE_CONNECTION" "sync"
$envText = Set-Or-AddEnvValue $envText "CACHE_STORE" "file"
$envText = Set-Or-AddEnvValue $envText "FILESYSTEM_DISK" "local"
$envText = Set-Or-AddEnvValue $envText "MAIL_MAILER" "log"
$envText = Set-Or-AddEnvValue $envText "BROADCAST_CONNECTION" "log"

if ($envText -notmatch '(?m)^APP_KEY=') {
    $envText += "APP_KEY=`r`n"
}

[System.IO.File]::WriteAllText($envFile, $envText, [System.Text.Encoding]::UTF8)
if (!(Test-Path $envFile)) { ERR "Configuration file could not be created at $envFile." }

$envText = Get-Content $envFile -Raw
if ($envText -notmatch '(?m)^DB_CONNECTION=mariadb') {
    ERR "Configuration file at $envFile does not have DB_CONNECTION=mariadb."
}
OK "Configuration written"

# STEP 5: Grant write access to Laravel runtime directories
WAIT "Granting application write permissions..."
$writablePaths = @(
    "$AppDir\backend\storage",
    "$AppDir\backend\bootstrap\cache"
)

foreach ($path in $writablePaths) {
    if (!(Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }

    $grantResult = & icacls $path /grant "*S-1-5-32-545:(OI)(CI)M" /T /C 2>&1
    if ($LASTEXITCODE -ne 0) {
        ERR "Could not grant write permission on $($path).`n$grantResult"
    }
}
OK "Application folders are writable"

# STEP 6: Artisan setup
function artisan($cmd) {
    $args = @($phpRuntimeArgs + @($artisan) + $cmd)
    $result = & $php @args 2>&1
    return $result
}

# Clear any stale bootstrap cache from a previous install or bundled artifacts
# so artisan always reads from .env rather than from an old cached config
WAIT "Clearing bootstrap cache..."
Get-ChildItem "$AppDir\backend\bootstrap\cache" -Filter "*.php" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
OK "Bootstrap cache cleared"

$envText = Get-Content $envFile -Raw
if ($envText -match '(?m)^APP_KEY=base64:') {
    OK "Application key preserved"
} else {
    WAIT "Generating application key..."
    artisan @("key:generate", "--force") | Out-Null
    $envText = Get-Content $envFile -Raw
    if ($envText -notmatch 'APP_KEY=base64:') { ERR "key:generate failed. Check PHP logs." }
    OK "Application key set"
}

if ($isWorkstation) {
    Log "(Skipping migrations/seeding - this Workstation shares the Main Server's already-provisioned database)"
} else {
    WAIT "Applying database migrations..."
    $out = artisan @("migrate", "--force")
    if ($LASTEXITCODE -ne 0 -and $out -notmatch "Nothing to migrate") { ERR "Migrations failed.`n$out" }
    OK "Database schema is up to date"

    WAIT "Applying default data (preserves existing records)..."
    $out = artisan @("db:seed", "--force")
    if ($LASTEXITCODE -ne 0) { ERR "Seeder failed.`n$out" }
    OK "Default data ready"
}

WAIT "Caching application..."
$cfgOut = artisan @("config:cache")
if ($LASTEXITCODE -ne 0) { ERR "config:cache failed - check .env and PHP extensions.`n$cfgOut" }
artisan @("route:cache")  | Out-Null
artisan @("view:cache")   | Out-Null
OK "Application cached"

# STEP 7: Create start-pos.bat
WAIT "Creating launcher script..."
$bat  = "@echo off" + [char]13 + [char]10
$bat += "title Core POS" + [char]13 + [char]10
$bat += "set PHPRC=$AppDir\php" + [char]13 + [char]10
$bat += "" + [char]13 + [char]10
$bat += "if exist `"$AppDir\desktop\Core.exe`" (" + [char]13 + [char]10
$bat += "    start `"`" `"$AppDir\desktop\Core.exe`"" + [char]13 + [char]10
$bat += "    exit /b 0" + [char]13 + [char]10
$bat += ")" + [char]13 + [char]10
$bat += "" + [char]13 + [char]10
$bat += "echo Core desktop app is missing. Please reinstall Core." + [char]13 + [char]10
$bat += "pause"
[System.IO.File]::WriteAllText("$AppDir\start-pos.bat", $bat, [System.Text.Encoding]::ASCII)
OK "Launcher script written"

# STEP 7b: Set PHPRC system env var so all PHP child processes find php.ini automatically
WAIT "Configuring PHP environment..."
try {
    [System.Environment]::SetEnvironmentVariable("PHPRC", "$AppDir\php", "Machine")
    OK "PHPRC set - PHP extensions will load correctly"
} catch {
    Log "(PHPRC not set as Machine var - this is OK, extensions still load from exe directory)"
}

# STEP 7c: Register Windows Task Scheduler to auto-start PHP server on login
WAIT "Registering auto-start service (runs at Windows login)..."
try {
    $taskName   = "Core POS Server"
    # Bind 0.0.0.0 (not just 127.0.0.1) so the Kitchen Display and Queue Display
    # screens can be opened from other devices on the same LAN.
    $phpArgs    = (Get-PhpRuntimeArgumentString) + " `"$AppDir\backend\artisan`" serve --host=0.0.0.0 --port=8080"

    $action   = New-ScheduledTaskAction `
                    -Execute "$AppDir\php\php.exe" `
                    -Argument $phpArgs `
                    -WorkingDirectory "$AppDir\backend"

    $trigger  = New-ScheduledTaskTrigger -AtLogon

    $settings = New-ScheduledTaskSettingsSet `
                    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
                    -RestartCount 5 `
                    -RestartInterval (New-TimeSpan -Minutes 1) `
                    -StartWhenAvailable `
                    -MultipleInstances IgnoreNew

    # Run as BUILTIN\Users so it starts for any logged-in user
    $principal = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Users" -RunLevel Highest

    Register-ScheduledTask `
        -TaskName   $taskName `
        -Action     $action `
        -Trigger    $trigger `
        -Settings   $settings `
        -Principal  $principal `
        -Force | Out-Null

    # Start it immediately so we don't need a reboot
    Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (Test-LocalCoreServer -port 8080 -attempts 20) {
        OK "Auto-start registered - Core POS server is running locally"
    } else {
        OK "Auto-start registered - desktop app will start the local server on launch"
    }
} catch {
    Log "(Auto-start skipped: $($_.Exception.Message))"
}

# STEP 7d: Open Windows Firewall for LAN access — Kitchen Display and Queue Display
# screens are meant to be opened on other devices (tablets, second monitors) on the
# same network, so port 8080 needs to accept inbound connections from the LAN.
WAIT "Allowing Core POS through Windows Firewall (for Kitchen/Queue displays)..."
try {
    $fwRuleName = "Core POS Server (port 8080)"
    if (-not (Get-NetFirewallRule -DisplayName $fwRuleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule `
            -DisplayName $fwRuleName `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort 8080 `
            -Profile Domain,Private | Out-Null
        OK "Firewall rule added - other devices on this network can reach Core POS"
    } else {
        OK "Firewall rule already present"
    }
} catch {
    Log "(Firewall rule skipped: $($_.Exception.Message) - Kitchen/Queue displays on other devices may need a manual firewall exception for port 8080)"
}

# STEP 8: Run startup smoke test - tests PHP, MariaDB, AND actual admin login
WAIT "Running startup smoke test..."
$smokePort      = 18080
$smokeBase      = "http://127.0.0.1:$smokePort"
$smokeCurrUrl   = "$smokeBase/api/currencies"
$smokeLoginUrl  = "$smokeBase/api/auth/login"
$smokeOutLog    = "$AppDir\backend\storage\logs\smoke-stdout.log"
$smokeErrLog    = "$AppDir\backend\storage\logs\smoke-stderr.log"

Remove-Item $smokeOutLog, $smokeErrLog -Force -ErrorAction SilentlyContinue

$smokeArgs = @($phpRuntimeArgs + @(
    $artisan,
    "serve",
    "--host=127.0.0.1",
    "--port=$smokePort"
))
$smokeProc = Start-Process -FilePath $php -ArgumentList $smokeArgs -WorkingDirectory "$AppDir\backend" -RedirectStandardOutput $smokeOutLog -RedirectStandardError $smokeErrLog -PassThru -WindowStyle Hidden

# Phase 1: wait for the server to be reachable (currencies is a public endpoint)
$serverUp = $false
try {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri $smokeCurrUrl -UseBasicParsing -TimeoutSec 5 `
                     -Headers @{ "Accept" = "application/json" }
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

if (!$serverUp) {
    if ($smokeProc -and !$smokeProc.HasExited) { Stop-Process -Id $smokeProc.Id -Force -ErrorAction SilentlyContinue }
    $laravelTail  = if (Test-Path $laravelLog)  { (Get-Content $laravelLog  | Select-Object -Last 20) -join "`n" } else { "No laravel.log" }
    $smokeErrTail = if (Test-Path $smokeErrLog) { (Get-Content $smokeErrLog | Select-Object -Last 20) -join "`n" } else { "No smoke stderr log" }
    ERR "Server did not start - PHP or MariaDB issue.`n`nLaravel log:`n$laravelTail`n`nPHP stderr:`n$smokeErrTail"
}
OK "Server is up (PHP + MariaDB responding)"

if ($isUpdateInstall) {
    if ($smokeProc -and !$smokeProc.HasExited) {
        Stop-Process -Id $smokeProc.Id -Force -ErrorAction SilentlyContinue
    }
    OK "Existing login credentials preserved"
} else {
    # Phase 2: test actual admin login with the seeded credentials on first install
    WAIT "Verifying admin login credentials..."
    $loginOk = $false
    try {
        $body = '{"username":"admin","password":"Admin@123"}'
        $r = Invoke-WebRequest -Uri $smokeLoginUrl -Method POST -Body $body `
                 -ContentType "application/json" -UseBasicParsing -TimeoutSec 15 `
                 -Headers @{ "Accept" = "application/json" }
        $json = $r.Content | ConvertFrom-Json
        if ($json.data.token -or $json.success -eq $true) { $loginOk = $true }
    } catch {
        $loginOk = $false
    }

    if ($smokeProc -and !$smokeProc.HasExited) {
        Stop-Process -Id $smokeProc.Id -Force -ErrorAction SilentlyContinue
    }

    if (!$loginOk) {
        $laravelTail = if (Test-Path $laravelLog) { (Get-Content $laravelLog | Select-Object -Last 30) -join "`n" } else { "No laravel.log" }
        ERR "Admin login test failed - the seeded credentials (admin / Admin@123) were rejected.`n`nThis usually means the database seeder did not complete correctly.`n`nLaravel log:`n$laravelTail"
    }
    OK "Admin login verified (credentials work)"
}

# STEP 9: Desktop shortcut
WAIT "Creating desktop shortcut..."
try {
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut("$env:PUBLIC\Desktop\Core.lnk")
    $lnk.TargetPath       = "$AppDir\desktop\Core.exe"
    $lnk.WorkingDirectory = $AppDir
    $lnk.Description      = "Core POS Point of Sale"
    $lnk.IconLocation     = "$AppDir\desktop\Core.exe,0"
    $lnk.Save()
    OK "Desktop shortcut created"
} catch {
    Log "(Shortcut skipped - $($_.Exception.Message))"
}

# STEP 10: Touchscreen & power settings for dedicated POS hardware
WAIT "Configuring touchscreen and power settings for POS..."
try {
    # ── Disable Windows' built-in virtual keyboard auto-popup ─────────────────
    # Prevents Windows from launching its own on-screen keyboard when the
    # cashier taps a text field — Core has its own numeric keypad.
    $tabletTipPath = "HKCU:\Software\Microsoft\TabletTip\1.7"
    if (!(Test-Path $tabletTipPath)) {
        New-Item -Path $tabletTipPath -Force | Out-Null
    }
    Set-ItemProperty -Path $tabletTipPath -Name "EnableDesktopModeAutoInvoke" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $tabletTipPath -Name "TipbandDesiredVisibility" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue

    # Disable the floating touch keyboard button in the taskbar
    $inputPanelPath = "HKCU:\Software\Microsoft\Input\TIPC"
    if (!(Test-Path $inputPanelPath)) { New-Item -Path $inputPanelPath -Force | Out-Null }
    Set-ItemProperty -Path $inputPanelPath -Name "ClientId" -Value "" -Type String -Force -ErrorAction SilentlyContinue

    # ── Prevent text prediction / personalisation (GDPR + privacy) ───────────
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Input\Settings" -Name "InsightsEnabled" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue

    # ── Power plan: High Performance, never sleep, display always on ─────────
    # Switch to High Performance plan (GUID 8c5e7fda-...)
    & powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null
    if ($LASTEXITCODE -ne 0) {
        # If the built-in GUID is unavailable, duplicate the current plan and customise it
        $newGuid = & powercfg /duplicatescheme SCHEME_BALANCED 2>$null | Select-String '[0-9a-f]{8}-' | ForEach-Object { $_.Matches[0].Value }
        if ($newGuid) { & powercfg /setactive $newGuid 2>$null }
    }
    # AC (plugged-in): display never turns off, PC never sleeps, never hibernates
    & powercfg /change monitor-timeout-ac 0 2>$null
    & powercfg /change standby-timeout-ac 0 2>$null
    & powercfg /change hibernate-timeout-ac 0 2>$null
    # DC (on battery) — same, in case the machine runs on UPS
    & powercfg /change monitor-timeout-dc 0 2>$null
    & powercfg /change standby-timeout-dc 0 2>$null

    # ── Disable screen saver ─────────────────────────────────────────────────
    Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name "ScreenSaveActive" -Value "0" -Type String -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name "ScreenSaverIsSecure" -Value "0" -Type String -Force -ErrorAction SilentlyContinue

    # ── Disable Windows Update auto-restart notifications ────────────────────
    # Prevents Windows from rebooting the POS machine mid-shift.
    $auPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU"
    if (!(Test-Path $auPath)) { New-Item -Path $auPath -Force | Out-Null }
    Set-ItemProperty -Path $auPath -Name "NoAutoRebootWithLoggedOnUsers" -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $auPath -Name "AUOptions" -Value 4 -Type DWord -Force -ErrorAction SilentlyContinue  # Download but do not install

    # ── Clean up stale localStorage from older Core installs ─────────────────
    # v1.1 stored a "pos-offline-queue" key that is no longer used.
    # Delete the Electron Local Storage directory so it starts clean.
    # Held orders (cart-storage) are only in-memory in v1.2; no data loss.
    $electronAppData = Join-Path $env:APPDATA "Core"
    foreach ($lsDir in @(
        (Join-Path $electronAppData "Local Storage"),
        (Join-Path $electronAppData "Session Storage")
    )) {
        if (Test-Path $lsDir) {
            Remove-Item $lsDir -Recurse -Force -ErrorAction SilentlyContinue
            Log "(Cleared stale Electron storage at $lsDir)"
        }
    }

    OK "Touchscreen and power settings configured"
} catch {
    Log "(Some POS settings could not be applied: $($_.Exception.Message))"
}

# DONE
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "    Core POS v1.2 setup complete!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
if ($isUpdateInstall) {
    Write-Host "  Update complete. Existing database and login credentials were preserved." -ForegroundColor White
} else {
    Write-Host "  Default login:" -ForegroundColor White
    Write-Host "    Username : admin" -ForegroundColor Cyan
    Write-Host "    Password : Admin@123" -ForegroundColor Cyan
}

if ($isWorkstation) {
    Write-Host ""
    Write-Host "  This Workstation is sharing the database at ${dbHost}:${dbPort}." -ForegroundColor White
} else {
    Show-LanAddressForWorkstations
    Write-Host ""
    Write-Host "  To add another till on this network, run the Core installer on it," -ForegroundColor White
    Write-Host "  choose 'Workstation', and enter this machine's address above." -ForegroundColor White
}

Write-Host ""
Write-Host "  Double-click 'Core' on the Desktop to launch." -ForegroundColor White
Write-Host ""
Read-Host "  Press Enter to close this window"
