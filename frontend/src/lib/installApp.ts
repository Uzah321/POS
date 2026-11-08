/**
 * "Add Core to this device" — a shortcut or app icon on every kind of device,
 * not only the ones whose browser happens to offer it.
 *
 * Chrome and Edge (Windows, Android, Mac, Linux, ChromeOS) can install the
 * site as an app themselves: they fire `beforeinstallprompt`, kept here so a
 * button can open that install box later. Where they don't (Firefox, Safari on
 * a Mac, older browsers, or a till reaching a local server over plain http,
 * which browsers never install), a computer downloads a shortcut file for its
 * system instead, and a phone or tablet shows the browser's own steps.
 *
 * Imported from main.tsx so the listener is in place before the browser
 * fires the event (it usually does so once, soon after the page loads).
 */
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type DevicePlatform = 'windows' | 'mac' | 'linux' | 'chromeos' | 'ios' | 'android' | 'other';

let installEvent: BeforeInstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// The browser's own install offer (e.g. Chrome's bar on Android) is left as
// it is — no preventDefault — so this only adds a way in, never removes one.
window.addEventListener('beforeinstallprompt', (e) => {
  installEvent = e as BeforeInstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  installedNow = true;
  notify();
});

/**
 * Already opened as the installed app, or inside the Core desktop app — there
 * is nothing to add. Read once at start-up: on Android a plain browser tab
 * goes full screen on the first tap (see main.tsx), and should still offer it.
 */
export const RUNNING_AS_APP: boolean =
  (typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)').matches)
  || (navigator as Navigator & { standalone?: boolean }).standalone === true
  || !!(globalThis as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;

export function detectPlatform(): DevicePlatform {
  const ua = navigator.userAgent;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    || navigator.platform || '';
  // iPads ask for the desktop site and say "Macintosh"; only they have a touch screen.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/CrOS/i.test(ua) || /Chrome OS/i.test(platform)) return 'chromeos';
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return 'mac';
  if (/Linux|X11/i.test(platform) || /Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}

/** The shortcut file a computer can save to its desktop, if it uses one. */
export function shortcutFileFor(platform: DevicePlatform): { href: string; name: string } | null {
  switch (platform) {
    case 'windows': return { href: '/api/download/core-shortcut.url', name: 'Core POS.url' };
    case 'mac':     return { href: '/api/download/core-shortcut.webloc', name: 'Core POS.webloc' };
    case 'linux':   return { href: '/api/download/core-shortcut.desktop', name: 'Core POS.desktop' };
    default:        return null;
  }
}

export function useInstallApp() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return {
    /** The browser can install Core as an app right now. */
    canInstall: !!installEvent,
    /** There's nothing to offer: already the app, or just installed. */
    alreadyApp: RUNNING_AS_APP || installedNow,
    /** Opens the browser's install box; true if they installed it. */
    install: async (): Promise<boolean> => {
      const event = installEvent;
      if (!event) return false;
      // Each offer can be shown once; the browser sends a fresh one if it's dismissed.
      installEvent = null;
      notify();
      await event.prompt();
      const { outcome } = await event.userChoice;
      return outcome === 'accepted';
    },
  };
}
