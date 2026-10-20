/**
 * Weighing Scale Service — Web Serial API + Ethernet (TCP), multi-scale
 *
 * Reads weight from one or more connected scales, the kind used at a
 * butchery/deli counter to price meat by weight. Most scales output
 * something like "    1.250 kg\r\n" repeatedly, whichever transport carries
 * it:
 *  - webserial: RS-232 / USB-to-serial, via the browser's Web Serial API.
 *  - network:   Ethernet scales that stream the same text protocol over a
 *               raw TCP socket. A web page can't open one itself (and the
 *               online server can't see into the shop's network), so the
 *               socket is opened on the till computer by either the Core
 *               desktop app's main process (electron/main.cjs) or, for the
 *               online system in a browser, the Core Bridge — a small
 *               helper the till runs (core-scale-bridge.bat) that the page
 *               reaches over a WebSocket on 127.0.0.1. Both look the same
 *               from here (ScaleSocketBridge). The port is optional: with
 *               just an IP address the till tries the ports scales and
 *               serial-to-Ethernet adapters usually listen on (see
 *               findScalePort).
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
import { isPoleDisplayPort } from './poleDisplay';

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

/** Opens TCP sockets to network scales on the till's behalf, one per scale id — the desktop app's main process, or the Core Bridge. */
interface ScaleSocketBridge {
  connectScale: (scaleId: number, host: string, port: number) => Promise<{ success: boolean; error?: string }>;
  disconnectScale: (scaleId: number) => Promise<{ success: boolean }>;
  onScaleData: (callback: (payload: { scaleId: number; chunk: string }) => void) => () => void;
  onScaleClosed: (callback: (payload: { scaleId: number }) => void) => () => void;
}

function electronScaleBridge(): ScaleSocketBridge | undefined {
  const api = (globalThis as any).electronAPI;
  return api?.isElectron ? (api as ScaleSocketBridge) : undefined;
}

/** True in a browser (the online system), where network scales go through the Core Bridge; false in the desktop app, which connects itself. */
export function usesScaleBridge(): boolean {
  return !electronScaleBridge();
}

// ---------------------------------------------------------------------------
// Core Bridge (core-scale-bridge.bat) — one WebSocket per scale socket,
// to the helper on this same computer. It answers {"type":"open"} once the
// scale is connected, {"type":"error"} if it can't be, then relays what the
// scale sends as {"type":"data"} messages until either side closes.
// ---------------------------------------------------------------------------
export const SCALE_BRIDGE_PORT = 47321;
const SCALE_BRIDGE_URL = `ws://127.0.0.1:${SCALE_BRIDGE_PORT}`;

export const SCALE_BRIDGE_DOWN =
  "The Core Bridge isn't running on this computer (or the browser blocked it). Start it — see Hardware → Weighing Scale — then press Connect.";

export type ScaleBridgeStatus = 'running' | 'not-running' | 'wrong-site';

/** Whether the bridge is up on this computer and was downloaded for this site. */
export function checkScaleBridge(timeoutMs = 2500): Promise<ScaleBridgeStatus> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = new WebSocket(`${SCALE_BRIDGE_URL}/ping`); } catch { resolve('not-running'); return; }
    let done = false;
    const finish = (status: ScaleBridgeStatus) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(status);
    };
    const timer = setTimeout(() => finish('not-running'), timeoutMs);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data));
        if (msg.type === 'hello') finish(msg.allowed === false ? 'wrong-site' : 'running');
      } catch {}
    };
    ws.onclose = () => finish('not-running');
  });
}

function createBrowserBridge(): ScaleSocketBridge {
  const sockets = new Map<number, WebSocket>();
  const dataListeners = new Set<(payload: { scaleId: number; chunk: string }) => void>();
  const closedListeners = new Set<(payload: { scaleId: number }) => void>();

  const drop = (scaleId: number) => {
    const ws = sockets.get(scaleId);
    // Forget it first so its close event isn't reported as the scale dropping.
    sockets.delete(scaleId);
    try { ws?.close(); } catch {}
  };

  return {
    connectScale: (scaleId, host, port) => new Promise((resolve) => {
      drop(scaleId);
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${SCALE_BRIDGE_URL}/connect?host=${encodeURIComponent(host)}&port=${port}`);
      } catch {
        resolve({ success: false, error: SCALE_BRIDGE_DOWN });
        return;
      }
      let opened = false;
      let failed: string | null = null;
      ws.onmessage = (e) => {
        let msg: any;
        try { msg = JSON.parse(String(e.data)); } catch { return; }
        if (msg.type === 'open' && !failed) {
          opened = true;
          sockets.set(scaleId, ws);
          resolve({ success: true });
        } else if (msg.type === 'error' && !opened) {
          failed = String(msg.message ?? 'Failed to connect to scale');
        } else if (msg.type === 'data' && opened) {
          dataListeners.forEach((cb) => cb({ scaleId, chunk: String(msg.chunk ?? '') }));
        }
      };
      ws.onclose = () => {
        if (!opened) {
          resolve({ success: false, error: failed ?? SCALE_BRIDGE_DOWN });
          return;
        }
        if (sockets.get(scaleId) !== ws) return; // closed on purpose by drop()
        sockets.delete(scaleId);
        closedListeners.forEach((cb) => cb({ scaleId }));
      };
    }),
    disconnectScale: async (scaleId) => {
      drop(scaleId);
      return { success: true };
    },
    onScaleData: (callback) => {
      dataListeners.add(callback);
      return () => { dataListeners.delete(callback); };
    },
    onScaleClosed: (callback) => {
      closedListeners.add(callback);
      return () => { closedListeners.delete(callback); };
    },
  };
}

let browserBridge: ScaleSocketBridge | null = null;

function networkBridge(): ScaleSocketBridge | null {
  const electron = electronScaleBridge();
  if (electron) return electron;
  if (typeof WebSocket === 'undefined') return null;
  browserBridge ??= createBrowserBridge();
  return browserBridge;
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
  // True while dialing — for a network scale with no port saved, that
  // includes trying each usual port, which can take a few seconds.
  connecting: boolean;
  weight: ScaleReading | null;
  error: string | null;
  // The port actually in use — for a network scale saved without one, the
  // port findScalePort settled on.
  port: number | null;
  // Last non-empty line the scale sent, parsed or not — lets the Hardware
  // page tell "nothing is arriving" apart from "something is arriving that
  // isn't a weight".
  lastRaw: string | null;
}

const EMPTY_STATE: ConnectionState = { connected: false, connecting: false, weight: null, error: null, port: null, lastRaw: null };

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
  const raw = line.trim();
  if (!raw) return;
  const reading = parseScaleOutput(raw);
  patchState(scaleId, reading ? { weight: reading, lastRaw: raw } : { lastRaw: raw.slice(0, 80) });
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
// them and exactly one previously-granted port — see module docblock. A pole
// display's port (poleDisplay.ts) doesn't count.
async function autoReconnectSerialScales(scales: ScaleDevice[]) {
  const serialScales = scales.filter((s) => s.mode === 'webserial' && s.is_active);
  if (serialScales.length !== 1 || !('serial' in navigator)) return;
  const scale = serialScales[0];
  if (serialPorts.has(scale.id)) return;
  try {
    const ports = (await (navigator as any).serial.getPorts()).filter((p: any) => !isPoleDisplayPort(p));
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

// Ports Ethernet scales and the serial-to-Ethernet adapters wired to them
// commonly listen on, most likely first: Moxa NPort (4001), Lantronix
// (10001), USR-IOT / Elfin (8899, 20108), Digi International device servers
// (2101), then other common choices. Telnet (23) is last because on an
// adapter it's often the setup console, not the data.
const SCALE_PORT_CANDIDATES = [4001, 10001, 8899, 20108, 2101, 2000, 9001, 8000, 5001, 1701, 23];

// Port found per scale + IP this session, so a reconnect goes straight there.
const foundPorts = new Map<string, number>();

/**
 * For a network scale saved with only an IP address: dial every candidate
 * port at once (over the desktop app's existing per-id socket bridge, each
 * probe under its own throwaway negative id) and keep the one that answers.
 * If more than one answers, wait a moment and prefer whichever is actually
 * sending a weight. Probe sockets are all closed again — the caller makes
 * the real connection on the winning port.
 */
async function findScalePort(bridge: ScaleSocketBridge, scale: ScaleDevice, host: string): Promise<{ port: number } | { error: string }> {
  const probes = SCALE_PORT_CANDIDATES.map((port, i) => ({ port, id: -(scale.id * 1000 + i + 1) }));
  const results = await Promise.all(probes.map((p) =>
    bridge.connectScale(p.id, host, p.port).catch((e: any) => ({ success: false, error: String(e?.message ?? e) }))
  ));
  const open = probes.filter((_, i) => results[i].success);

  if (open.length === 0) {
    // The same complaint from every port isn't about ports at all (e.g. the
    // bridge turning away an address outside the shop) — pass it on as-is.
    const first = results[0]?.error ?? '';
    if (first && !/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|timed out/i.test(first) && results.every((r) => r.error === first)) {
      return { error: first };
    }
    if (results.every((r) => (r.error ?? '').includes('ECONNREFUSED'))) {
      return { error: `${host} is on the network but isn't accepting connections on any usual scale port (${SCALE_PORT_CANDIDATES.join(', ')}). If you know the scale's port, add it under Edit.` };
    }
    return { error: `Nothing answered at ${host}. Check the IP address, that the scale is switched on, and that it's on the same network as this till.` };
  }

  let winner = open[0];
  if (open.length > 1) {
    winner = await new Promise((resolve) => {
      let unsub = () => {};
      const timer = setTimeout(() => { unsub(); resolve(open[0]); }, 3000);
      unsub = bridge.onScaleData(({ scaleId, chunk }) => {
        const hit = open.find((p) => p.id === scaleId);
        if (hit && parseScaleOutput(chunk)) { clearTimeout(timer); unsub(); resolve(hit); }
      });
    });
  }
  await Promise.all(open.map((p) => bridge.disconnectScale(p.id).catch(() => {})));
  return { port: winner.port };
}

async function connectNetworkScale(scale: ScaleDevice) {
  patchState(scale.id, { error: null });
  const bridge = networkBridge();
  if (!bridge) {
    patchState(scale.id, { error: "This browser can't reach network scales — use Chrome or Edge with the Core Bridge, or the Core desktop app." });
    return;
  }
  const host = scale.host?.trim();
  if (!host) {
    patchState(scale.id, { error: "This scale has no IP address configured." });
    return;
  }
  if (openingIds.has(scale.id)) return;
  openingIds.add(scale.id);
  patchState(scale.id, { connecting: true });
  try {
    if (bridge !== electronScaleBridge()) {
      const status = await checkScaleBridge();
      if (status !== 'running') {
        patchState(scale.id, {
          error: status === 'wrong-site'
            ? `The Core Bridge on this computer was downloaded for a different web address — download it again from this page's Hardware → Weighing Scale.`
            : SCALE_BRIDGE_DOWN,
        });
        return;
      }
    }
    const foundKey = `${scale.id}@${host}`;
    let port = scale.port ?? foundPorts.get(foundKey) ?? null;
    let result: { success: boolean; error?: string } = port != null
      ? await bridge.connectScale(scale.id, host, port)
      : { success: false };
    // No saved port, or the one found earlier this session stopped answering
    // (adapter restarted on another port) — search again.
    if (!result.success && scale.port == null) {
      const found = await findScalePort(bridge, scale, host);
      if ('error' in found) {
        foundPorts.delete(foundKey);
        patchState(scale.id, { error: found.error });
        return;
      }
      port = found.port;
      foundPorts.set(foundKey, port);
      result = await bridge.connectScale(scale.id, host, port);
    }
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
    patchState(scale.id, { connected: true, port, weight: null, lastRaw: null });
  } catch (e: any) {
    patchState(scale.id, { error: e?.message ?? 'Failed to connect to scale' });
  } finally {
    openingIds.delete(scale.id);
    patchState(scale.id, { connecting: false });
  }
}

async function disconnectNetworkScale(scaleId: number) {
  teardownNetworkListeners(scaleId);
  try { await networkBridge()?.disconnectScale(scaleId); } catch {}
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
 * screen that weighs items) — redials every active network scale (searching
 * for the port of any saved with only an IP address), and
 * attempts the single-serial-scale auto-reconnect described above. Safe to
 * call repeatedly/from multiple screens: already-connected or in-flight
 * scales are skipped.
 */
export function ensureScalesAutoConnected(scales: ScaleDevice[]): void {
  for (const scale of scales) {
    if (!scale.is_active || scale.mode !== 'network') continue;
    if (getScaleReading(scale.id).connected || openingIds.has(scale.id)) continue;
    if (!scale.host) continue;
    connectNetworkScale(scale);
  }
  autoReconnectSerialScales(scales);
}
