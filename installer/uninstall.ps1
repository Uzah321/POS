<#
.SYNOPSIS
  Core POS uninstall cleanup. Called by Inno Setup before files are removed.
#>
param(
    [string]$AppDir = "C:\POS"
)

$ErrorActionPreference = "SilentlyContinue"

Unregister-ScheduledTask -TaskName "Core POS Server" -Confirm:$false -ErrorAction SilentlyContinue
Stop-Process -Name php -Force -ErrorAction SilentlyContinue
Stop-Service -Name "CoreMariaDB" -ErrorAction SilentlyContinue

$mariaMsi = Join-Path $AppDir "redist\mariadb-installer.msi"
$mariaUninstallLog = Join-Path $AppDir "mariadb-uninstall.log"

if (Test-Path $mariaMsi) {
    $msiArgs = @(
        "/x", "`"$mariaMsi`"",
        "/qn", "/norestart", "/L*v", "`"$mariaUninstallLog`""
    ) -join " "

    Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -ErrorAction SilentlyContinue
}

sc.exe delete "CoreMariaDB" | Out-Null