import { useEffect, useState } from 'react';
import axios from 'axios';

/**
 * Resolves the URL other devices on the same network should use to reach this
 * server — used by Kitchen Display / Queue Display to show staff what to type
 * into a second screen's browser. Falls back to the current page's own origin
 * (correct when already viewed via a LAN address, but not discoverable from
 * the main POS machine itself, which is why /api/network-info exists).
 */
export function useNetworkUrl(): string {
  const [url, setUrl] = useState(() => window.location.origin);

  useEffect(() => {
    let cancelled = false;
    axios.get('/api/network-info')
      .then(({ data }) => {
        if (cancelled) return;
        const ip = data?.data?.ip;
        const port = data?.data?.port;
        if (ip) {
          setUrl(`${window.location.protocol}//${ip}${port ? `:${port}` : ''}`);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return url;
}
