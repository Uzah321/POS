import { useState, useEffect, useRef } from 'react';
import { useOfflineStore } from '../stores/offlineStore';

// Polls /api/currencies (public, no auth needed) to detect if the local PHP server is up.
// This is the SINGLE source of truth for isOnline — it drives offlineStore.isOnline so that
// all CRUD pages react correctly when the local server is down, regardless of navigator.onLine.

let _cachedUp = true;

export function useServerHealth() {
  const [isServerUp, setIsServerUp] = useState(_cachedUp);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = async () => {
    try {
      const res = await fetch('/api/currencies', { signal: AbortSignal.timeout(4000) });
      void res;
      if (!_cachedUp) {
        _cachedUp = true;
        setIsServerUp(true);
        useOfflineStore.getState().setOnline(true);
      }
    } catch {
      if (_cachedUp) {
        _cachedUp = false;
        setIsServerUp(false);
        useOfflineStore.getState().setOnline(false);
      }
    }
  };

  useEffect(() => {
    check();
    // Re-check every 30 s: local server rarely goes down once running
    timer.current = setInterval(check, 30000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { isServerUp };
}
