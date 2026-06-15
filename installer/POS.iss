; ==============================================================================
; Core Self-Contained Windows Installer
; Requires Inno Setup 6 - https://jrsoftware.org/isdl.php
;
; BEFORE COMPILING:
;   1. cd frontend && npm run build        (build React app)
;   2. installer\deploy-frontend.bat       (copy to backend/public)
;   3. cd backend && composer install --no-dev --optimize-autoloader
;   4. powershell -File installer\prepare-installer.ps1  (downloads PHP)
;   5. iscc POS.iss  (compile this file)
;
; Output: installer\Output\Core-Setup.exe
; ==============================================================================

#define AppName      "Core"
#define AppVersion   "1.0"
#define AppPublisher "Core POS"

[Setup]
AppId={{A7F2C3E1-D4B5-4E6F-9A8B-0C1D2E3F4A5B}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=http://localhost:8080
AppSupportURL=http://localhost:8080
DefaultDirName=C:\POS
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=Output
OutputBaseFilename=Core-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\start-pos.bat
MinVersion=10.0.17763
SetupMutex=CoreSetupMutex

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut for Core"; GroupDescription: "Additional icons:"

[Dirs]
Name: "{app}\backend\storage\logs"
Name: "{app}\backend\storage\framework\cache\data"
Name: "{app}\backend\storage\framework\sessions"
Name: "{app}\backend\storage\framework\views"
Name: "{app}\backend\storage\app\public"
Name: "{app}\backend\bootstrap\cache"

[Files]
; ── PHP 8.3 NTS x64 (downloaded by prepare-installer.ps1) ──────────────────
Source: "redist\php\*"; DestDir: "{app}\php"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; ── Laravel backend - split by directory so .env is never overwritten ───────
Source: "..\backend\app\*";        DestDir: "{app}\backend\app";       Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\backend\bootstrap\*";  DestDir: "{app}\backend\bootstrap"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\backend\config\*";     DestDir: "{app}\backend\config";    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\backend\database\*";   DestDir: "{app}\backend\database";  Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\backend\public\*";     DestDir: "{app}\backend\public";    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\backend\resources\*";  DestDir: "{app}\backend\resources"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\backend\routes\*";     DestDir: "{app}\backend\routes";    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\backend\vendor\*";     DestDir: "{app}\backend\vendor";    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\backend\artisan";      DestDir: "{app}\backend";           Flags: ignoreversion
Source: "..\backend\composer.json"; DestDir: "{app}\backend";          Flags: ignoreversion
Source: "..\backend\composer.lock"; DestDir: "{app}\backend";          Flags: ignoreversion

; ── Setup and launcher scripts ──────────────────────────────────────────────
Source: "install.ps1";   DestDir: "{app}"; Flags: ignoreversion
Source: "start-pos.bat"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Core";            Filename: "{app}\start-pos.bat"; WorkingDir: "{app}"
Name: "{group}\Uninstall Core";  Filename: "{uninstallexe}"
Name: "{commondesktop}\Core";    Filename: "{app}\start-pos.bat"; WorkingDir: "{app}"; \
  Tasks: desktopicon

[Run]
; Main setup script - shows its own window so user sees download / DB progress
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install.ps1"" -AppDir ""{app}"""; \
  WorkingDir: "{app}"; \
  StatusMsg: "Configuring Core (installs database - may take a few minutes)..."; \
  Flags: waituntilterminated

; Offer to launch after install
Filename: "{app}\start-pos.bat"; \
  WorkingDir: "{app}"; \
  Description: "Launch Core now"; \
  Flags: postinstall nowait skipifsilent unchecked shellexec

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -Command ""Stop-Process -Name php -Force -ErrorAction SilentlyContinue"""; \
  RunOnceId: "StopPHP"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function InitializeSetup(): Boolean;
var
  Version: TWindowsVersion;
begin
  GetWindowsVersionEx(Version);
  if (Version.Major < 10) or ((Version.Major = 10) and (Version.Build < 17763)) then
  begin
    MsgBox('Core requires Windows 10 (version 1809) or later.' + #13#10 +
           'Please upgrade your Windows before installing.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
end;
