import { useEffect, useState } from 'react';
import { Download, MonitorDown, Share, MoreVertical, Smartphone, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { detectPlatform, shortcutFileFor, useInstallApp, type DevicePlatform } from '../lib/installApp';

// After downloading, where the file is and what to do with it.
const AFTER_DOWNLOAD: Partial<Record<DevicePlatform, string>> = {
  windows: 'Open your Downloads folder and drag "Core POS" onto the Desktop (or right-click it → Pin to Start). Double-click it to open Core.',
  mac: 'Open your Downloads folder and drag "Core POS" onto the Desktop or into the Dock. Double-click it to open Core.',
  linux: 'Move "Core POS" from Downloads onto the Desktop, then right-click it and choose Allow Launching.',
};

// Phones, tablets and Chromebooks keep their app icons on the home screen,
// added from the browser's own menu.
const MENU_STEPS: Partial<Record<DevicePlatform, React.ReactNode[]>> = {
  ios: [
    <>Open this page in <strong>Safari</strong>.</>,
    <>Tap <strong>Share</strong> <Share size={14} className="inline -mt-0.5" /> at the bottom (on iPad, top right).</>,
    <>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</>,
  ],
  android: [
    <>Tap the browser menu <MoreVertical size={14} className="inline -mt-0.5" /> (top right in Chrome).</>,
    <>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</>,
    <>Tap <strong>Add</strong> / <strong>Install</strong>. Core is now on your home screen.</>,
  ],
  chromeos: [
    <>Open the Chrome menu <MoreVertical size={14} className="inline -mt-0.5" /> (top right).</>,
    <>Choose <strong>Cast, save and share</strong> → <strong>Install page as app</strong> (or <strong>Create shortcut</strong>).</>,
  ],
  other: [
    <>Open your browser's menu.</>,
    <>Choose <strong>Install app</strong>, <strong>Add to Home screen</strong> or <strong>Create shortcut</strong>.</>,
  ],
};

// The Android app (mobile/, Flutter): made for handheld tills — its own screens
// instead of the browser's, and receipts straight to a built-in printer.
const ANDROID_APP = { href: '/api/download/core-pos.apk', name: 'Core POS.apk', size: '22 MB' };

// The app needs Android 6.0 (Flutter's oldest); an older device can't install it.
const ANDROID_APP_MIN = 6;
function androidVersion(): string | null {
  const match = /Android (\d+(?:\.\d+)?)/.exec(navigator.userAgent);
  return match ? match[1] : null;
}

function AndroidAppSteps() {
  return (
    <ol className="space-y-1.5 list-decimal pl-5 text-xs text-gray-700">
      <li>Open the downloaded <strong>Core POS.apk</strong> (from the notification, or Files → Downloads).</li>
      <li>If Android asks, allow installing apps from this browser, then tap <strong>Install</strong>.</li>
      <li>Open <strong>Core POS</strong> and sign in. It connects to <strong>{window.location.host}</strong> — if it shows another server, tap <strong>Change</strong> and enter this one.</li>
    </ol>
  );
}

/**
 * "Add Core to this device": a link that opens a box offering whatever works
 * on this device — installing the app (Chrome / Edge), a desktop shortcut file
 * (Windows, Mac, Linux) and the browser-menu steps (iPhone, iPad, Android).
 * Hidden when Core is already open as the installed or desktop app.
 */
export default function AddToDevice({ variant }: { variant: 'login' | 'sidebar' }) {
  const [open, setOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [appDownloaded, setAppDownloaded] = useState(false);
  const deviceAndroid = androidVersion();
  const { canInstall, alreadyApp, install } = useInstallApp();
  const platform = detectPlatform();
  const file = shortcutFileFor(platform);
  const steps = MENU_STEPS[platform];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (alreadyApp) return null;

  const onInstall = async () => {
    if (await install()) {
      setOpen(false);
      toast.success('Core is installed — open it from your desktop or home screen.');
    }
  };

  const trigger = variant === 'login' ? (
    <button type="button" onClick={() => setOpen(true)}
      className="mx-auto mt-6 flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600">
      <MonitorDown size={14} /> Add Core to this device
    </button>
  ) : (
    <button type="button" onClick={() => setOpen(true)}
      className="mb-2 w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white">
      <MonitorDown size={18} className="flex-shrink-0" />
      <span className="truncate">Add Core to this device</span>
    </button>
  );

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-to-device-title"
            className="bg-white rounded-lg shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto text-left"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 id="add-to-device-title" className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <MonitorDown size={18} /> Add Core to this device
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5 text-sm text-gray-700">
              {platform === 'android' && (
                <section className="space-y-2">
                  {deviceAndroid && parseFloat(deviceAndroid) < ANDROID_APP_MIN ? (
                    <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-3">
                      This device runs Android {deviceAndroid}. The Core Android app needs Android {ANDROID_APP_MIN}.0 or newer, so use Core in the browser here instead.
                    </p>
                  ) : (
                    <>
                      <a href={ANDROID_APP.href} download={ANDROID_APP.name} onClick={() => setAppDownloaded(true)}
                        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg">
                        <Smartphone size={18} /> Download the Android app
                      </a>
                      <p className="text-xs text-gray-500">
                        Best for handheld tills: made for small screens, and receipts print straight on a built-in printer (Sunmi and others).
                        A {ANDROID_APP.size} download, for Android {ANDROID_APP_MIN}.0 or newer{deviceAndroid ? ` (this device: Android ${deviceAndroid})` : ''}.
                      </p>
                    </>
                  )}
                  {appDownloaded && <AndroidAppSteps />}
                  <p className="pt-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Or use Core in the browser</p>
                </section>
              )}

              {canInstall && (
                <section className="space-y-2">
                  <button type="button" onClick={onInstall}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg">
                    <Download size={18} /> Install Core app
                  </button>
                  <p className="text-xs text-gray-500">
                    Puts a Core icon on this {platform === 'android' || platform === 'ios' ? 'home screen' : 'computer\'s desktop and Start menu'} that opens Core in its own window.
                  </p>
                </section>
              )}

              {file && (
                <section className="space-y-2">
                  {canInstall && <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Or a desktop shortcut</p>}
                  <a href={file.href} download={file.name} onClick={() => setDownloaded(true)}
                    className={`w-full flex items-center justify-center gap-2 font-semibold py-3 rounded-lg ${
                      canInstall ? 'border border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}>
                    <Download size={18} /> Download desktop shortcut
                  </a>
                  <p className={`text-xs ${downloaded ? 'text-gray-700' : 'text-gray-500'}`}>{AFTER_DOWNLOAD[platform]}</p>
                </section>
              )}

              {!canInstall && steps && (
                <section>
                  <ol className="space-y-2 list-decimal pl-5">
                    {steps.map((step, i) => <li key={i}>{step}</li>)}
                  </ol>
                </section>
              )}

              {platform !== 'android' && (
                <p className="text-xs text-gray-500">
                  Setting up an Android handheld till?{' '}
                  <a href={ANDROID_APP.href} download={ANDROID_APP.name} className="text-blue-600 hover:underline font-medium">Download the Android app</a>{' '}
                  ({ANDROID_APP.size}) and copy it to the device, or open this page on the device itself.
                </p>
              )}

              <p className="text-xs text-gray-400 break-all">Opens {window.location.origin}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
