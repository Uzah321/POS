import { useEffect } from 'react';
import { useOfflineStore } from '../stores/offlineStore';

// Polls /api/currencies (public, no auth needed) to detect whether the server answers.
// This is the SINGLE source of truth for isOnline — it drives offlineStore.isOnline so that
// all CRUD pages react correctly when the server is down, regardless of navigator.onLine.
// One poller serves every component that asks, so the badges, banners and pages always agree.

const TIMEOUT_MS = 8000;
const UP_EVERY_MS = 30000;
// After a missed answer, ask again soon: one slow reply isn't a server that's down.
const RETRY_MS = 3000;
const DOWN_EVERY_MS = 5000;

let users = 0;
let failures = 0;
let checking = false;
let timer: ReturnType<typeof setTimeout> | null = null;

// The desktop install serves Core from this computer (or another one on the shop's
// network); the hosted sites (*.mycorre.com) come over the internet. What to tell
// someone whose server isn't answering depends on which.
export function isLocalServer(hostname = window.location.hostname): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const parts = host.split('.').map((part) => Number(part));
  return host === 'localhost' || host === '::1' || host.startsWith('127.')
    || host.startsWith('10.') || host.startsWith('192.168.')
    || (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || host.endsWith('.local') || !host.includes('.');
}

// Not AbortSignal.timeout: it only exists from Chrome/Edge 103, and on an older
// browser (Posiflex tills run Edge 92) it threw before anything was sent — so the
// server always looked down there.
async function reachable(): Promise<boolean> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller?.abort(); reject(new Error('timeout')); }, TIMEOUT_MS);
  });
  try {
    await Promise.race([fetch('/api/currencies', controller ? { signal: controller.signal } : {}), gaveUp]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = users > 0 ? setTimeout(() => void check(), ms) : null;
}

async function check() {
  if (checking) return;
  checking = true;
  const ok = await reachable();
  checking = false;
  failures = ok ? 0 : failures + 1;
  const up = failures < 2;
  const store = useOfflineStore.getState();
  if (store.isOnline !== up) store.setOnline(up);
  schedule(!up ? DOWN_EVERY_MS : failures ? RETRY_MS : UP_EVERY_MS);
}

const checkNow = () => void check();
const checkWhenShown = () => { if (document.visibilityState === 'visible') void check(); };

export function useServerHealth() {
  const isServerUp = useOfflineStore((s) => s.isOnline);

  useEffect(() => {
    users += 1;
    if (users === 1) {
      window.addEventListener('online', checkNow);
      window.addEventListener('offline', checkNow);
      document.addEventListener('visibilitychange', checkWhenShown);
      void check();
    }
    return () => {
      users -= 1;
      if (users === 0) {
        if (timer) clearTimeout(timer);
        timer = null;
        window.removeEventListener('online', checkNow);
        window.removeEventListener('offline', checkNow);
        document.removeEventListener('visibilitychange', checkWhenShown);
      }
    };
  }, []);

  return { isServerUp };
}
