# Sharing one Core database across multiple tills (LAN setup)

By default, every Core install is fully self-contained: its own local MariaDB
database, its own PHP backend, its own Electron app. That's still the default.

Starting with this installer, you can instead run **one shared database** on a
single "Main Server" machine, with every other till ("Workstation") on the
same network connecting to it. Each till still runs its own local PHP backend
and Electron app — only the database is centralized — so a till that
temporarily loses the network connection still queues sales locally and syncs
once it's back, exactly like today.

```
Main Server (e.g. 192.168.1.10)
  ├─ MariaDB service (port 3307, opened to the LAN)
  ├─ PHP backend (own local install)
  └─ Electron POS (own local install)

Workstation 2, 3, 4…
  ├─ PHP backend (own local install) ──▶ DB_HOST=192.168.1.10
  └─ Electron POS (own local install)
```

## Setup order matters

1. **Install the Main Server first.** Run `Core-Setup-1.2.exe` on the machine
   that should hold the shared database, choose **[1] Main Server** when
   asked. This installs MariaDB locally (as before), then additionally:
   - Opens MariaDB to listen on all network interfaces (not just loopback).
   - Grants the app's database user access from any host (`'core_pos'@'%'`),
     relying on Windows Firewall — scoped to `Domain,Private` network
     profiles only, never `Public`/untrusted networks — as the real network
     boundary.
   - Opens a Windows Firewall rule for the database port (3307).
   - Prints this machine's LAN IP address(es) at the end — write one down.

2. **Install every Workstation after that.** Run the same installer on each
   other till, choose **[2] Workstation**, and enter the Main Server's IP
   address (and port, if you changed it from the default 3307) when prompted.
   This skips installing MariaDB locally entirely, skips migrations/seeding
   (the Main Server already did that), and just points this machine's `.env`
   at the shared database.

Both roles can also be selected non-interactively, e.g. for scripted installs:

```powershell
# Main Server
powershell -File install.ps1 -AppDir C:\POS -ServerMode main

# Workstation
powershell -File install.ps1 -AppDir C:\POS -ServerMode workstation -ServerHost 192.168.1.10 -ServerPort 3307
```

## Requirements

- All machines on the same LAN / same subnet (or routed with the database
  port reachable).
- The Main Server machine must stay powered on and connected for
  Workstations to process sales; if it's unreachable, each Workstation still
  queues sales offline (IndexedDB) and syncs automatically once the Main
  Server is reachable again.
- If the Main Server's IP address changes (e.g. DHCP reassigns it), either
  give it a static IP/DHCP reservation on your router, or re-run the
  Workstation installers pointing at the new address.

## Backups

Workstations have no local `mysqldump.exe` (there's no local database to
back up) — take backups from **the Main Server** via Settings → Backups; that
backs up the one shared database everyone uses.

## Troubleshooting a Workstation that can't connect

The Workstation installer will refuse to continue if it can't reach the Main
Server's database, with a specific error. Most common causes:

- Main Server isn't installed as "Main Server" yet, or its Core service isn't
  running.
- Wrong IP address/port entered — re-check the address the Main Server
  printed at the end of its setup (`ipconfig` on that machine also shows it).
- Windows Firewall on the Main Server is blocking port 3307 — this should be
  opened automatically by the Main Server install, but a third-party
  firewall/antivirus product can override it.
- The two machines are on different network profiles — the firewall rule
  only allows `Domain,Private` profiles, not `Public` (e.g. a machine that
  Windows thinks is on a "public" Wi-Fi network won't be reachable until its
  network profile is changed to Private).
