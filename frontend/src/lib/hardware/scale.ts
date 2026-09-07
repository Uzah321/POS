/**
 * Weighing Scale Service — Web Serial API + Ethernet (TCP), multi-scale
 *
 * Reads weight from one or more connected scales, the kind used at a
 * butchery/deli counter to price meat by weight. Most scales output
 * something like "    1.250 kg\r\n" repeatedly, whichever transport carries
 * it:
 *  - webserial: RS-232 / USB-to-serial, via the browser's Web Serial API.
 *  - network:   Ethernet scales that stream the same text protocol over a
 *               raw TCP socket. Browsers can't open raw TCP sockets, so this
 *               mode only works inside the Core desktop app (Electron main
 *               process owns each socket; see electron/main.cjs) — a plain
 *               browser tab falls back to Web Serial only.
 *
 * A store can register several scales (one per department, e.g. "Meat
 * Scale", "Deli Scale") — each is a row from the backend's weighing_scales
 * table, identified by its own numeric id. Every product assigned to a
 * scale (products.scale_id) is only ever weighed on that scale, and sales
 * are reported back per scale — so this module manages a *map* of live
 * connections keyed by scale id, rather than one global connection.
 *
 * Usage:
 *   connectScale(scale);              // scale: ScaleDevice, from weighingScalesApi.list()
 *   const reading = useScaleReading(scale.id);  // reactive: { connected, weight, error }
 *   disconnectScale(scale.id);
 *
 * Auto-reconnect (network): every active network-mode scale is redialed once
 * via ensureScaleAutoConnected(), since there's no browser permission grant
 * involved. Auto-reconnect (webserial): only attempted when exactly one
 * webserial-mode scale is registered and exactly one serial port was
 * previously granted — Web Serial has no stable id to safely match more than
 * one physical scale back to a specific registry row across a reload, so
 * with 2+ serial scales the cashier reconnects each manually once per shift.
 */

import { create } from 'zustand';

export interface ScaleReading {
  value: number;
  unit: string;
  raw: string;
}

export type ScaleConnectionMode = 'network' | 'webserial';

/** Mirrors a row from the backend's weighing_scales table. */
export interface ScaleDevice {
  id: number;
  name: string;
  mode: ScaleConnectionMode;
  host: string | null;
  port: number | null;
  baud_rate: number | null;
  is_active: boolean;
  products_count?: number;
}

interface ElectronScaleBridge {
  connectScale: (scaleId: number, host: string, port: number) => Promise<{ success: boolean; error?: string }>;
  disconnectScale: (scaleId: number) => Promise<{ success: boolean }>;
  onScaleData: (callback: (payload: { scaleId: number; chunk: string }) => void) => () => void;
  onScaleClosed: (callback: (payload: { scaleId: number }) => void) => () => void;
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

// ---------------------------------------------------------------------------
// Reactive connection state — one entry per scale id, shared by every
// component that asks about that scale (Hardware page's row, the till
// looking up whichever scale a product is assigned to, etc).
// ---------------------------------------------------------------------------
interface ConnectionState {
  connected: boolean;
  weight: ScaleReading | null;
  error: string | null;
}

const EMPTY_STATE: ConnectionState = { connected: false, weight: null, error: null };

const useScaleConnectionsStore = create<{ byId: Record<number, ConnectionState> }>(() => ({ byId: {} }));

function patchState(scaleId: number, patch: Partial<ConnectionState>) {
  useScaleConnectionsStore.setState((s) => ({
    byId: { ...s.byId, [scaleId]: { ...EMPTY_STATE, ...s.byId[scaleId], ...patch } },
  }));
}

/** Reactive live state for one scale — re-renders the caller as weight/connection updates arrive. */
export function useScaleReading(scaleId: number | null | undefined): ConnectionState {
  return useScaleConnectionsStore((s) => (scaleId != null ? s.byId[scaleId] : undefined) ?? EMPTY_STATE);
}

export function getScaleReading(scaleId: number): ConnectionState {
  return useScaleConnectionsStore.getState().byId[scaleId] ?? EMPTY_STATE;
}

/** How many of the given scales are currently connected — for a compact header badge summarising every registered scale at once, rather than one specific reading. */
export function useConnectedScaleCount(scaleIds: number[]): number {
  return useScaleConnectionsStore((s) => scaleIds.filter((id) => s.byId[id]?.connected).length);
}

function feedLine(scaleId: number, line: string) {
  const reading = parseScaleOutput(line);
  if (reading) patchState(scaleId, { weight: reading });
}

// ---------------------------------------------------------------------------
// Web Serial (RS-232 / USB-to-serial) — one physical port per scale.
// ---------------------------------------------------------------------------
const serialPorts = new Map<number, any>();
const serialReaders = new Map<number, ReadableStreamDefaultReader>();
const openingIds = new Set<number>();

function startSerialReading(scaleId: number, port: any) {
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  serialReaders.set(scaleId, reader);

  let buffer = '';
  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/[\r\n]+/);
        buffer = lines.pop() ?? '';
        for (const line of lines) feedLine(scaleId, line);
      }
    } catch {
      // Read loop ends on disconnect/close — reflect that in the UI.
      patchState(scaleId, { connected: false });
    }
  })();
}

async function openSerialPort(scale: ScaleDevice, port: any) {
  if (openingIds.has(scale.id)) return;
  openingIds.add(scale.id);
  try {
    await port.open({ baudRate: scale.baud_rate ?? 9600 });
    serialPorts.set(scale.id, port);
    patchState(scale.id, { connected: true, error: null });
    startSerialReading(scale.id, port);
  } finally {
    openingIds.delete(scale.id);
  }
}

async function connectSerialScale(scale: ScaleDevice) {
  patchState(scale.id, { error: null });
  if (!('serial' in navigator)) {
    patchState(scale.id, { error: 'Web Serial API not supported. Use Chrome/Edge 89+.' });
    return;
  }
  try {
    const port = await (navigator as any).serial.requestPort();
    await openSerialPort(scale, port);
  } catch (e: any) {
    patchState(scale.id, { error: e?.message ?? 'Failed to connect to scale' });
  }
}

async function disconnectSerialScale(scaleId: number) {
  try { serialReaders.get(scaleId)?.cancel(); } catch {}
  try { await serialPorts.get(scaleId)?.close(); } catch {}
  serialPorts.delete(scaleId);
  serialReaders.delete(scaleId);
  patchState(scaleId, { connected: false, weight: null });
}

// Only safe to auto-reconnect a webserial scale when there's exactly one of
// them and exactly one previously-granted port — see module docblock.
async function autoReconnectSerialScales(scales: ScaleDevice[]) {
  const serialScales = scales.filter((s) => s.mode === 'webserial' && s.is_active);
  if (serialScales.length !== 1 || !('serial' in navigator)) return;
  const scale = serialScales[0];
  if (serialPorts.has(scale.id)) return;
  try {
    const ports = await (navigator as any).serial.getPorts();
    if (ports.length === 1) await openSerialPort(scale, ports[0]);
  } catch {
    // No prior grant, or the port is busy elsewhere — stay disconnected
    // and let the cashier connect manually from Settings.
  }
}

// ---------------------------------------------------------------------------
// Ethernet (raw TCP, via the Electron main process — see electron/main.cjs)
// ---------------------------------------------------------------------------
const networkUnsubs = new Map<number, Array<() => void>>();

function teardownNetworkListeners(scaleId: number) {
  networkUnsubs.get(scaleId)?.forEach((fn) => fn());
  networkUnsubs.delete(scaleId);
}

async function connectNetworkScale(scale: ScaleDevice) {
  patchState(scale.id, { error: null });
  const bridge = electronScaleBridge();
  if (!bridge) {
    patchState(scale.id, { error: "Ethernet scales require the Core desktop app — a browser tab can't open a network connection directly." });
    return;
  }
  if (!scale.host || !scale.port) {
    patchState(scale.id, { error: "This scale has no IP address/port configured." });
    return;
  }
  if (openingIds.has(scale.id)) return;
  openingIds.add(scale.id);
  try {
    const result = await bridge.connectScale(scale.id, scale.host, scale.port);
    if (!result.success) {
      patchState(scale.id, { error: result.error ?? 'Failed to connect to scale' });
      return;
    }
    teardownNetworkListeners(scale.id);
    networkUnsubs.set(scale.id, [
      bridge.onScaleData(({ scaleId, chunk }) => {
        if (scaleId !== scale.id) return;
        for (const line of chunk.split(/[\r\n]+/)) feedLine(scale.id, line);
      }),
      bridge.onScaleClosed(({ scaleId }) => {
        if (scaleId !== scale.id) return;
        patchState(scale.id, { connected: false });
        teardownNetworkListeners(scale.id);
      }),
    ]);
    patchState(scale.id, { connected: true });
  } catch (e: any) {
    patchState(scale.id, { error: e?.message ?? 'Failed to connect to scale' });
  } finally {
    openingIds.delete(scale.id);
  }
}

async function disconnectNetworkScale(scaleId: number) {
  teardownNetworkListeners(scaleId);
  try { await electronScaleBridge()?.disconnectScale(scaleId); } catch {}
  patchState(scaleId, { connected: false, weight: null });
}

// ---------------------------------------------------------------------------
// Public API — dispatches to the right transport per scale.
// ---------------------------------------------------------------------------
export function connectScale(scale: ScaleDevice): Promise<void> {
  return scale.mode === 'network' ? connectNetworkScale(scale) : connectSerialScale(scale);
}

export function disconnectScale(scale: ScaleDevice): Promise<void> {
  return scale.mode === 'network' ? disconnectNetworkScale(scale.id) : disconnectSerialScale(scale.id);
}

/**
 * Call once the registered scales list loads (Hardware page, and any till
 * screen that weighs items) — redials every active network scale, and
 * attempts the single-serial-scale auto-reconnect described above. Safe to
 * call repeatedly/from multiple screens: already-connected or in-flight
 * scales are skipped.
 */
export function ensureScalesAutoConnected(scales: ScaleDevice[]): void {
  for (const scale of scales) {
    if (!scale.is_active || scale.mode !== 'network') continue;
    if (getScaleReading(scale.id).connected || openingIds.has(scale.id)) continue;
    if (!scale.host || !scale.port) continue;
    connectNetworkScale(scale);
  }
  autoReconnectSerialScales(scales);
}
