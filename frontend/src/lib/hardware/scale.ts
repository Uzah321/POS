/**
 * Weighing Scale Service — Web Serial API
 *
 * Reads weight from a serial-connected scale (RS-232 / USB-to-serial).
 * Most scales output something like "    1.250 kg\r\n" repeatedly or on request.
 *
 * Usage:
 *   const { connect, disconnect, weight, unit, connected } = useWeighingScale();
 */

import { useState, useRef, useCallback } from 'react';

export interface ScaleReading {
  value: number;
  unit: string;
  raw: string;
}

// Common scale output parsers — add more patterns as needed
function parseScaleOutput(raw: string): ScaleReading | null {
  // Pattern: optional spaces, number, optional space, unit (g / kg / lb / oz)
  const match = raw.match(/([\d.]+)\s*(g|kg|lb|oz)/i);
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: match[2].toLowerCase(), raw: raw.trim() };
}

export function useWeighingScale(baudRate = 9600) {
  const [connected, setConnected]   = useState(false);
  const [weight, setWeight]         = useState<ScaleReading | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const portRef                     = useRef<any>(null);
  const readerRef                   = useRef<ReadableStreamDefaultReader | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    if (!('serial' in navigator)) {
      setError('Web Serial API not supported. Use Chrome/Edge 89+.');
      return;
    }
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate });
      portRef.current = port;
      setConnected(true);

      // Start reading loop
      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      readerRef.current = reader;

      let buffer = '';
      const read = async () => {
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
          setConnected(false);
        }
      };
      read();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to connect to scale');
    }
  }, [baudRate]);

  const disconnect = useCallback(async () => {
    try { readerRef.current?.cancel(); } catch {}
    try { await portRef.current?.close(); } catch {}
    portRef.current = null;
    setConnected(false);
    setWeight(null);
  }, []);

  return { connect, disconnect, connected, weight, error };
}
