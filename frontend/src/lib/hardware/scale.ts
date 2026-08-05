/**
 * Weighing Scale Service — Web Serial API + Ethernet (TCP)
 *
 * Reads weight from a connected scale, the kind used at a butchery/deli
 * counter to price meat by weight. Most scales output something like
 * "    1.250 kg\r\n" repeatedly, whichever transport carries it:
 *  - webserial: RS-232 / USB-to-serial, via the browser's Web Serial API.
 *  - network:   Ethernet scales that stream the same text protocol over a
 *               raw TCP socket. Browsers can't open raw TCP sockets, so this
 *               mode only works inside the Core desktop app (Electron main
 *               process owns the socket; see electron/main.cjs) — a plain
 *               browser tab falls back to Web Serial only.
 *
 * Usage:
 *   const { connect, disconnect, weight, connected } = useWeighingScale({ mode: 'webserial', baudRate: 9600 });
 *
 * Auto-reconnect (webserial): once the user has granted serial permission
 * once (via `connect()`, which must run from a real click), the browser
 * remembers that grant for this origin. Every later mount of this hook —
 * e.g. navigating from Settings to the till, or reloading the till —
 * silently reacquires the same port via `navigator.serial.getPorts()` with
 * no new prompt, so the cashier doesn't have to reconnect the scale every
 * shift. Auto-reconnect (network): the last host/port is simply redialed on
 * mount, since there's no browser permission grant involved.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface ScaleReading {
  value: number;
  unit: string;
  raw: string;
}

export interface ScaleConfig {
  mode: 'webserial' | 'network' | 'none';
  baudRate?: number;
  host?: string;
  port?: number;
}

interface ElectronScaleBridge {
  connectScale: (host: string, port: number) => Promise<{ success: boolean; error?: string }>;
  disconnectScale: () => Promise<{ success: boolean }>;
  onScaleData: (callback: (chunk: string) => void) => () => void;
  onScaleClosed: (callback: () => void) => () => void;
}

function electronScaleBridge(): ElectronScaleBridge | undefined {
  const api = (globalThis as any).electronAPI;
  return api?.isElectron ? (api as ElectronScaleBridge) : undefined;
}

/** Whether Ethernet (network) scale mode is usable in this window — only true inside the Core desktop app. */
export function isNetworkScaleAvailable(): boolean {
  return !!electronScaleBridge();
}

// Common scale output parsers — add more patterns as needed
function parseScaleOutput(raw: string): ScaleReading | null {
  // Pattern: optional spaces, number, optional space, unit (g / kg / lb / oz)
  const match = raw.match(/(-?[\d.]+)\s*(g|kg|lb|oz)/i);
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: match[2].toLowerCase(), raw: raw.trim() };
}

// Products are priced per kg — normalise whatever unit the scale reports.
export function toKg(reading: ScaleReading): number {
  switch (reading.unit) {
    case 'kg': return reading.value;
    case 'g':  return reading.value / 1000;
    case 'lb': return reading.value * 0.45359237;
    case 'oz': return reading.value * 0.0283495231;
    default:   return reading.value;
  }
}

export function useWeighingScale(config: ScaleConfig) {
  const { mode, baudRate = 9600, host, port } = config;
  const [connected, setConnected]   = useState(false);
  const [weight, setWeight]         = useState<ScaleReading | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const portRef                     = useRef<any>(null);
  const readerRef                   = useRef<ReadableStreamDefaultReader | null>(null);
  // Guards against two overlapping connect calls (e.g. the auto-reconnect
  // effect and a manual Connect click racing each other on mount).
  const openingRef                  = useRef(false);
  const netBufferRef                = useRef('');
  const netUnsubRef                 = useRef<(() => void)[] | null>(null);

  const feedLine = useCallback((line: string) => {
    const reading = parseScaleOutput(line);
    if (reading) setWeight(reading);
  }, []);

  // ---------------------------------------------------------------------
  // Web Serial (RS-232 / USB-to-serial)
  // ---------------------------------------------------------------------
  const startReading = useCallback((port: any) => {
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable).catch(() => {});
    const reader = decoder.readable.getReader();
    readerRef.current = reader;

    let buffer = '';
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split(/[\r\n]+/);
          buffer = lines.pop() ?? '';
          for (const line of lines) feedLine(line);
        }
      } catch {
        // Read loop ends on disconnect/close — reflect that in the UI.
        setConnected(false);
      }
    })();
  }, [feedLine]);

  const openSerialPort = useCallback(async (port: any) => {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      await port.open({ baudRate });
      portRef.current = port;
      setConnected(true);
      setError(null);
      startReading(port);
    } finally {
      openingRef.current = false;
    }
  }, [baudRate, startReading]);

  const connectSerial = useCallback(async () => {
    setError(null);
    if (!('serial' in navigator)) {
      setError('Web Serial API not supported. Use Chrome/Edge 89+.');
      return;
    }
    try {
      const port = await (navigator as any).serial.requestPort();
      await openSerialPort(port);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to connect to scale');
    }
  }, [openSerialPort]);

  const disconnectSerial = useCallback(async () => {
    try { readerRef.current?.cancel(); } catch {}
    try { await portRef.current?.close(); } catch {}
    portRef.current = null;
    setConnected(false);
    setWeight(null);
  }, []);

  // Silently reacquire a previously-granted port on mount, so the scale
  // stays "connected" across page navigation and reloads without the
  // cashier having to visit Settings again.
  useEffect(() => {
    if (mode !== 'webserial' || !('serial' in navigator)) return;
    let cancelled = false;
    (async () => {
      try {
        const ports = await (navigator as any).serial.getPorts();
        if (cancelled || ports.length === 0 || portRef.current) return;
        await openSerialPort(ports[0]);
      } catch {
        // No prior grant, or the port is busy elsewhere — stay disconnected
        // and let the cashier connect manually from Settings.
      }
    })();

    const onDisconnect = (e: any) => {
      if (e?.target && portRef.current && e.target !== portRef.current) return;
      setConnected(false);
      setWeight(null);
      portRef.current = null;
    };
    (navigator as any).serial.addEventListener?.('disconnect', onDisconnect);

    return () => {
      cancelled = true;
      (navigator as any).serial.removeEventListener?.('disconnect', onDisconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---------------------------------------------------------------------
  // Ethernet (raw TCP, via the Electron main process — see electron/main.cjs)
  // ---------------------------------------------------------------------
  const connectNetwork = useCallback(async () => {
    setError(null);
    const bridge = electronScaleBridge();
    if (!bridge) {
      setError("Ethernet scales require the Core desktop app — a browser tab can't open a network connection directly.");
      return;
    }
    if (!host || !port) {
      setError("Enter the scale's IP address and port.");
      return;
    }
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      const result = await bridge.connectScale(host, port);
      if (!result.success) {
        setError(result.error ?? 'Failed to connect to scale');
        return;
      }
      netBufferRef.current = '';
      netUnsubRef.current = [
        bridge.onScaleData((chunk) => {
          netBufferRef.current += chunk;
          const lines = netBufferRef.current.split(/[\r\n]+/);
          netBufferRef.current = lines.pop() ?? '';
          for (const line of lines) feedLine(line);
        }),
        bridge.onScaleClosed(() => {
          setConnected(false);
          netUnsubRef.current?.forEach((fn) => fn());
          netUnsubRef.current = null;
        }),
      ];
      setConnected(true);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to connect to scale');
    } finally {
      openingRef.current = false;
    }
  }, [host, port, feedLine]);

  const disconnectNetwork = useCallback(async () => {
    netUnsubRef.current?.forEach((fn) => fn());
    netUnsubRef.current = null;
    try { await electronScaleBridge()?.disconnectScale(); } catch {}
    setConnected(false);
    setWeight(null);
  }, []);

  // Auto-reconnect on mount — same rationale as the Web Serial path above,
  // just without a browser permission grant, so it's safe to just redial.
  useEffect(() => {
    if (mode !== 'network' || !host || !port) return;
    connectNetwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Tear down any live network subscriptions on unmount (the underlying
  // socket itself stays open in the main process, same as a serial port
  // stays open across page navigation, and gets redialed on next mount).
  useEffect(() => {
    return () => { netUnsubRef.current?.forEach((fn) => fn()); };
  }, []);

  const connect    = mode === 'network' ? connectNetwork    : connectSerial;
  const disconnect = mode === 'network' ? disconnectNetwork : disconnectSerial;

  return { connect, disconnect, connected, weight, error };
}
