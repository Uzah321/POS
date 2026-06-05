/**
 * useBarcodeScanner
 *
 * Detects USB/Bluetooth barcode scanners operating as HID keyboard wedge devices.
 * Scanners emit keystrokes very fast (< 50 ms between chars) and finish with Enter.
 * This hook intercepts that pattern globally and calls onScan(barcode) instead of
 * letting the characters land in whatever input has focus.
 *
 * Usage:
 *   useBarcodeScanner({ enabled: true, onScan: (code) => setSearch(code) });
 */

import { useEffect, useRef } from 'react';

interface UseBarcodeOptions {
  enabled: boolean;
  /** Minimum barcode length to trigger (avoids false positives) */
  minLength?: number;
  /** Max ms between keystrokes to be treated as scanner input (default 50 ms) */
  maxKeystrokeGap?: number;
  onScan: (barcode: string) => void;
}

export function useBarcodeScanner({
  enabled,
  minLength = 3,
  maxKeystrokeGap = 50,
  onScan,
}: UseBarcodeOptions): void {
  const bufferRef   = useRef<string>('');
  const lastKeyTime = useRef<number>(0);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastKeyTime.current;
      lastKeyTime.current = now;

      // If gap is too long, this is regular typing — reset buffer
      if (gap > maxKeystrokeGap && bufferRef.current.length > 0) {
        bufferRef.current = '';
      }

      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (code.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          onScan(code);
        }
        return;
      }

      // Accumulate printable characters
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        // Safety: clear buffer after 500 ms of silence (scanner done but no Enter)
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          bufferRef.current = '';
        }, 500);
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [enabled, minLength, maxKeystrokeGap, onScan]);
}
