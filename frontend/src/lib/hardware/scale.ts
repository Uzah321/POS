/**
 * Weighing Scale Service — Web Serial API
 *
 * Reads weight from a serial-connected scale (RS-232 / USB-to-serial), the
 * kind used at a butchery/deli counter to price meat by weight.
 * Most scales output something like "    1.250 kg\r\n" repeatedly.
 *
 * Usage:
 *   const { connect, disconnect, weight, connected } = useWeighingScale();
 *
 * Auto-reconnect: once the user has granted serial permission once (via
 * `connect()`, which must run from a real click), the browser remembers that
 * grant for this origin. Every later mount of this hook — e.g. navigating
 * from Settings to the till, or reloading the till — silently reacquires the
 * same port via `navigator.serial.getPorts()` with no new prompt, so the
 * cashier doesn't have to reconnect the scale every shift.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface ScaleReading {
  value: number;
  unit: string;
  raw: string;
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

export function useWeighingScale(baudRate = 9600) {
  const [connected, setConnected]   = useState(false);
  const [weight, setWeight]         = useState<ScaleReading | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const portRef                     = useRef<any>(null);
  const readerRef                   = useRef<ReadableStreamDefaultReader | null>(null);
  // Guards against two overlapping open() calls (e.g. the auto-reconnect
  // effect and a manual Connect click racing each other on mount).
  const openingRef                  = useRef(false);

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
          for (const line of lines) {
            const reading = parseScaleOutput(line);
            if (reading) setWeight(reading);
          }
        }
      } catch {
        // Read loop ends on disconnect/close — reflect that in the UI.
        setConnected(false);
      }
    })();
  }, []);

  const openPort = useCallback(async (port: any) => {
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

  const connect = useCallback(async () => {
    setError(null);
    if (!('serial' in navigator)) {
      setError('Web Serial API not supported. Use Chrome/Edge 89+.');
      return;
    }
    try {
      const port = await (navigator as any).serial.requestPort();
      await openPort(port);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to connect to scale');
    }
  }, [openPort]);

  const disconnect = useCallback(async () => {
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
    if (!('serial' in navigator)) return;
    let cancelled = false;
    (async () => {
      try {
        const ports = await (navigator as any).serial.getPorts();
        if (cancelled || ports.length === 0 || portRef.current) return;
        await openPort(ports[0]);
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
  }, []);

  return { connect, disconnect, connected, weight, error };
}
