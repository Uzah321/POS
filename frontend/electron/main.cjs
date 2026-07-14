const { app, BrowserWindow, dialog, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

// Touchscreen: enable touch events globally before app is ready
app.commandLine.appendSwitch('touch-events', 'enabled');
// Disable GPU compositing quirks that can cause tearing on touch-panel displays
app.commandLine.appendSwitch('disable-gpu-sandbox');
// Keep rubber-band / overscroll off (feels wrong on a POS)
app.commandLine.appendSwitch('overscroll-history-navigation', '0');

const APP_URL = 'http://127.0.0.1:8080';
// Deliberately DB-independent (Laravel's stock health route, bootstrap/app.php).
// On a Workstation sharing a remote database, the local PHP process can be up
// with the shared DB temporarily unreachable — we still want the app window to
// open so the SPA's own offline-queue/banner logic can take over, rather than
// Electron blocking here on a query that depends on the network.
const HEALTH_URL = `${APP_URL}/up`;
const MARIA_SERVICE = 'CoreMariaDB';
let serverProcess = null;
let mainWindow = null;

function phpRuntimeArgs(installRoot) {
  const extensionDir = path.join(installRoot, 'php', 'ext');

  return [
    '-n',
    '-d', `extension_dir=${extensionDir}`,
    '-d', 'extension=pdo_mysql',
    '-d', 'extension=mysqli',
    '-d', 'extension=pdo_sqlite',
    '-d', 'extension=sqlite3',
    '-d', 'extension=mbstring',
    '-d', 'extension=openssl',
    '-d', 'extension=fileinfo',
    '-d', 'extension=curl',
    '-d', 'extension=zip',
    '-d', 'extension=intl',
    '-d', 'extension=sodium',
    '-d', 'extension=gd',
    '-d', 'date.timezone=UTC',
    '-d', 'opcache.enable=0',
    '-d', 'opcache.enable_cli=0',
  ];
}

function resolveInstallRoot() {
  if (app.isPackaged) {
    return path.resolve(path.dirname(process.execPath), '..');
  }

  return path.resolve(__dirname, '..', '..');
}

function requestUrl(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });

    request.on('error', () => resolve(false));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await requestUrl(HEALTH_URL, 2000)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

function appendLog(filePath, message) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function runCommand(command, args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch {}
        resolve(false);
      }
    }, timeoutMs);

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code === 0 || code === 1056);
    });

    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function tryStartMariaDb(logFile) {
  const started = await runCommand('sc.exe', ['start', MARIA_SERVICE], 10000);
  appendLog(logFile, started ? `${MARIA_SERVICE} start checked` : `${MARIA_SERVICE} start command did not complete successfully`);
}

async function ensureServerStarted() {
  if (await requestUrl(HEALTH_URL, 1000)) {
    return true;
  }

  const installRoot = resolveInstallRoot();
  const phpExe = path.join(installRoot, 'php', 'php.exe');
  const phpIni = path.join(installRoot, 'php', 'php.ini');
  const backendDir = path.join(installRoot, 'backend');
  const artisan = path.join(backendDir, 'artisan');
  const logDir = path.join(backendDir, 'storage', 'logs');
  const serverLog = path.join(logDir, 'server.log');

  if (!fs.existsSync(phpExe) || !fs.existsSync(phpIni) || !fs.existsSync(artisan)) {
    dialog.showErrorBox(
      'Core cannot start',
      `The installed runtime is incomplete. Please reinstall Core.\n\nExpected files under:\n${installRoot}`,
    );
    return false;
  }

  fs.mkdirSync(logDir, { recursive: true });
  appendLog(serverLog, 'Core desktop starting local offline services');
  await tryStartMariaDb(serverLog);

  if (await requestUrl(HEALTH_URL, 2000)) {
    appendLog(serverLog, 'Local server became reachable after MariaDB check');
    return true;
  }

  const output = fs.openSync(serverLog, 'a');

  serverProcess = spawn(
    phpExe,
    // Bind 0.0.0.0 (not just 127.0.0.1) so the Kitchen Display and Queue Display
    // screens can be opened from other devices on the same LAN.
    [...phpRuntimeArgs(installRoot), artisan, 'serve', '--host=0.0.0.0', '--port=8080'],
    {
      cwd: backendDir,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', output, output],
      env: {
        ...process.env,
        PHPRC: path.dirname(phpIni),
        CORE_POS_OFFLINE_DESKTOP: '1',
      },
    },
  );

  serverProcess.unref();
  const ready = await waitForServer();
  appendLog(serverLog, ready ? 'Local offline server is ready' : 'Local offline server did not become reachable');
  return ready;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'Core',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();

  // Block all external navigation — POS is strictly local/offline
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(APP_URL)) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
    }
  });

  // Disable pinch-to-zoom and double-tap zoom (POS touchscreen should not zoom)
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    // Inject CSS to prevent user-select and callouts on touch
    mainWindow.webContents.insertCSS(
      '* { -webkit-tap-highlight-color: transparent; touch-action: manipulation; } ' +
      'input, textarea, select { -webkit-user-select: text; user-select: text; } ' +
      'body { overscroll-behavior: none; }'
    ).catch(() => {});
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  // Block all outbound requests that are NOT going to localhost / LAN —
  // this POS is designed to run fully offline.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const u = details.url;
    const isLocal =
      u.startsWith('http://127.') ||
      u.startsWith('http://localhost') ||
      u.startsWith('https://127.') ||
      u.startsWith('https://localhost') ||
      u.startsWith('http://192.168.') ||
      u.startsWith('http://10.') ||
      u.startsWith('devtools://') ||
      u.startsWith('chrome-extension://') ||
      u.startsWith('data:') ||
      u.startsWith('blob:');
    callback({ cancel: !isLocal });
  });

  const started = await ensureServerStarted();

  if (!started) {
    dialog.showErrorBox(
      'Core server did not start',
      'Core could not start its local offline server. Please run the diagnostic script or reinstall Core.',
    );
  }

  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
