# Core POS Offline Desktop Plan

## Current desktop package

Core POS is now packaged as a self-contained Windows offline install:

- Laravel runs locally through the bundled PHP runtime.
- The React app is built into `backend/public` and served by Laravel.
- The installed shortcut opens `Core.exe`, a native Electron desktop shell.
- `Core.exe` starts the local Laravel server on `127.0.0.1:8080` when it is not already running.
- No browser window, browser tab, or Edge app-mode window is opened for normal use.
- The installer creates and migrates the local database during first-time setup.

Build the installer from the project root with:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\rebuild-installer.ps1
```

The output is:

```text
installer\Output\Core-Setup.exe
```

## Database choice

For offline installs on individual machines, use SQLite with WAL mode. It is reliable, has no separate database service to install, and is easier to support on customer machines. This is the best fit for one till or one back-office workstation running fully offline.

The installer configures:

```text
DB_CONNECTION=sqlite
DB_DATABASE=C:/POS/backend/database/database.sqlite
```

It also enables WAL mode and a busy timeout to improve local read/write concurrency.

## When to use PostgreSQL or MariaDB

Use PostgreSQL or MariaDB instead of SQLite when several computers must share the same stock, sales, customers, and reports in real time over a LAN. In that setup:

- one machine acts as the local server,
- the database runs as a Windows service on that server,
- other tills connect to the server over the LAN,
- backups run from the server machine.

Recommended scale-up path: PostgreSQL for the central LAN database, because it is stable, scalable, and well-supported by Laravel.

## Next conversion step

The installer now bundles an Electron shell at `C:\POS\desktop\Core.exe`. Keep the Laravel/PHP runtime local and private to `127.0.0.1`; the Electron shell is the only user-facing entry point.
