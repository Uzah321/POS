/**
 * Pole Display Service — Web Serial
 *
 * Drives a 2-line x 20-character customer pole display, like the HP LM940
 * on a stand next to the till: the last item rung up and the running total
 * during a sale, the total and change after a cash payment, and a welcome
 * message between sales. It's fed by the same broadcastCart() updates as
 * the second-screen customer display (customerDisplay.ts), so the sale
 * screens don't need to know it exists.
 *
 * The LM940 is a USB device that Windows exposes as a virtual COM port
 * (9600 bps, 8N1), which the page reaches with the Web Serial API — Chrome
 * or Edge, over https or on localhost. It speaks HP's default "ULTIMATE"
 * command set, the Epson-style line display commands (HP's "Programming
 * Guide: HP RP9 Retail Integrated 2x20 Display", §3.1.1). A display that
 * has been switched to another emulation (CD5220, Logic Controls, ...)
 * with HP's setup utility shows garbage until it's switched back.
 *
 * Usage:
 *   await connectPoleDisplay();   // from a click — the browser asks which port
 *   showOnPoleDisplay(data);      // called by broadcastCart()
 *   await disconnectPoleDisplay();
 *   const { connected, error } = usePoleDisplayState();
 *
 * The chosen port's USB ids are saved in the hardware config, so after a
 * reload the next update quietly reopens that port from the browser's
 * granted ports — no picker, no click.
 */

import { create } from 'zustand';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useCurrencyStore } from '../../stores/currencyStore';
import type { CartDisplayData } from './customerDisplay';

/** The slice of the Web Serial SerialPort this module uses. */
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals?(signals: { dataTerminalReady?: boolean }): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  readonly writable: WritableStream<Uint8Array> | null;
}

/** navigator.serial (Web Serial), as far as this module uses it. */
interface SerialLike extends EventTarget {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

type Lines = [top: string, bottom: string];

const WIDTH = 20;
const BAUD_RATE = 9600;
// The till sends "idle" only 4 seconds after a sale — too quick to count
// change against — so the total/change stays up this long unless the next
// sale starts first.
const SALE_END_HOLD_MS = 15000;
// Between attempts to quietly reopen the saved port (unplugged, or held by
// another tab).
const RETRY_MS = 10000;

// ULTIMATE command set
const ESC = 0x1b;
const US = 0x1f;
const INIT = [ESC, 0x40];                                      // ESC @   initialize display
const CURSOR_OFF = [US, 0x43, 0];                              // US C 0  hide the cursor
const OVERWRITE = [US, 0x01];                                  // US MD1  overwrite mode: filling the last cell mustn't scroll
const CLEAR = [0x0c];                                          // CLR     clear the screen
const moveTo = (col: number, row: number) => [US, 0x24, col, row]; // US $ x y, 1-based

const UNSUPPORTED =
  "This browser can't reach USB/serial devices. Use Chrome or Edge, with the system opened over https (or on localhost).";

export const usePoleDisplayState = create<{ connected: boolean; error: string | null }>(() => ({
  connected: false,
  error: null,
}));

let port: SerialPortLike | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let opening: Promise<boolean> | null = null;
let lastAutoOpen = 0;

let current: Lines | null = null; // what should be on the glass
let wanted: Lines | null = null;  // queued for the next write
let shown = '';                   // what was last written
let flushing = false;

let storeName = '';
let prevQty = new Map<string, number>();
let saleEndedAt = 0;
let welcomeTimer: ReturnType<typeof setTimeout> | undefined;

function serial(): SerialLike | undefined {
  return typeof navigator !== 'undefined' ? (navigator as Navigator & { serial?: SerialLike }).serial : undefined;
}

// ---------------------------------------------------------------------------
// Text layout — every line is exactly 20 printable ASCII characters
// ---------------------------------------------------------------------------

/** The display's font is plain ASCII: fold accents away, anything else becomes '?'. */
function toAscii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
}

/** `left` flush left, `right` flush right; `left` is cut short to make room. */
function row(left: string, right = ''): string {
  let r = toAscii(right.trim());
  if (r.length > WIDTH) r = r.replace(/,/g, '');
  r = r.slice(0, WIDTH);
  const l = toAscii(left.trim()).slice(0, Math.max(0, WIDTH - r.length - (r ? 1 : 0)));
  return l + r.padStart(WIDTH - l.length);
}

function center(text: string): string {
  const t = toAscii(text.trim()).slice(0, WIDTH);
  return (' '.repeat(Math.floor((WIDTH - t.length) / 2)) + t).padEnd(WIDTH);
}

/** A base-currency (USD) amount in the active currency, as the rest of the till shows it. */
function money(usd: number): string {
  const { format, activeCurrency } = useCurrencyStore.getState();
  const text = format(usd);
  const symbol = activeCurrency?.symbol ?? '';
  // A symbol the display can't draw (€, £, ₦, ...) gives way to the code.
  return symbol && toAscii(symbol) !== symbol ? text.replace(symbol, `${activeCurrency?.code ?? ''} `) : text;
}

function welcomeLines(): Lines {
  return storeName ? [center(storeName), center('Welcome')] : [center('Welcome'), center('')];
}

type DisplayItem = NonNullable<CartDisplayData['items']>[number];

/** The line the cashier just touched — a new one, or one whose quantity went up — else the last line. */
function touchedItem(items: DisplayItem[]): DisplayItem {
  const qty = new Map<string, number>();
  for (const i of items) qty.set(i.name, (qty.get(i.name) ?? 0) + i.qty);
  const touched = [...items].reverse().find((i) => (qty.get(i.name) ?? 0) > (prevQty.get(i.name) ?? 0));
  prevQty = qty;
  return touched ?? items[items.length - 1];
}

function cartLines(data: CartDisplayData, item: DisplayItem): Lines {
  const q = Number(item.qty);
  const qty = q === 1 ? '' : `${Number(q.toFixed(3))}x `;
  return [row(qty + item.name, money(item.total)), row('TOTAL', money(data.total ?? 0))];
}

function saleEndLines(data: CartDisplayData): Lines {
  if (data.change == null) return [center('THANK YOU!'), center('Please come again')];
  return [
    data.total != null ? row('TOTAL', money(data.total)) : center('THANK YOU!'),
    // Already in the currency the customer paid in.
    row('CHANGE', money(useCurrencyStore.getState().toUsd(data.change))),
  ];
}

// ---------------------------------------------------------------------------
// Writing to the display — updates can arrive faster than 9600 bps drains,
// so only the newest screen is ever queued
// ---------------------------------------------------------------------------

function frame([top, bottom]: Lines): Uint8Array {
  const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  return Uint8Array.from([...OVERWRITE, ...moveTo(1, 1), ...text(top), ...moveTo(1, 2), ...text(bottom)]);
}

function show(lines: Lines) {
  current = lines;
  wanted = lines;
  void flush();
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (writer && wanted) {
      const lines = wanted;
      wanted = null;
      const key = lines.join('\n');
      if (key === shown) continue;
      await writer.write(frame(lines));
      shown = key;
    }
  } catch {
    usePoleDisplayState.setState({ error: 'Lost the pole display — check its USB cable. It reconnects by itself once it\'s back.' });
    await closePort();
  } finally {
    flushing = false;
  }
}

// ---------------------------------------------------------------------------
// Port lifecycle
// ---------------------------------------------------------------------------

async function openPort(p: SerialPortLike): Promise<boolean> {
  try {
    await p.open({ baudRate: BAUD_RATE });
    // The display uses DTR/DSR handshaking — make sure DTR is up.
    try { await p.setSignals?.({ dataTerminalReady: true }); } catch { /* not every port driver supports it */ }
    const w = p.writable!.getWriter();
    try {
      await w.write(Uint8Array.from([...INIT, ...CURSOR_OFF, ...OVERWRITE]));
    } catch (e) {
      try { w.releaseLock(); } catch { /* already released */ }
      throw e;
    }
    port = p;
    writer = w;
    shown = '';
    usePoleDisplayState.setState({ connected: true, error: null });
    show(current ?? welcomeLines());
    return true;
  } catch {
    try { await p.close(); } catch { /* never opened */ }
    usePoleDisplayState.setState({
      connected: false,
      error: "Couldn't open the pole display's port. Close anything else using it (another Core tab, HP's display utility), then connect again.",
    });
    return false;
  }
}

async function closePort() {
  const p = port;
  const w = writer;
  port = null;
  writer = null;
  shown = '';
  try { w?.releaseLock(); } catch { /* already released */ }
  try { await p?.close(); } catch { /* already closed, or unplugged */ }
  usePoleDisplayState.setState({ connected: false });
}

/** Whether `p` is the saved pole display port — the scale's auto-reconnect leaves it alone. */
export function isPoleDisplayPort(p: SerialPortLike): boolean {
  const cfg = useHardwareStore.getState();
  if (!cfg.poleDisplayEnabled || cfg.poleDisplayVendorId == null) return false;
  const info = p.getInfo();
  return info.usbVendorId === cfg.poleDisplayVendorId && info.usbProductId === cfg.poleDisplayProductId;
}

/** Quietly reopens the saved port after a reload or replug — only when exactly one granted port matches it. */
export function ensurePoleDisplayOpen() {
  const s = serial();
  if (writer || opening || !s) return;
  if (!useHardwareStore.getState().poleDisplayEnabled) return;
  watchPlugging();
  if (Date.now() - lastAutoOpen < RETRY_MS) return;
  lastAutoOpen = Date.now();
  opening = (async () => {
    const ports: SerialPortLike[] = await s.getPorts().catch(() => []);
    const matches = ports.filter(isPoleDisplayPort);
    return matches.length === 1 ? openPort(matches[0]) : false;
  })().finally(() => { opening = null; });
}

// Reopen the display as soon as it's plugged back in; let go of it when it's
// pulled. Only in the window that drives it (the till) — the second-screen
// customer display window loads this module too, and mustn't grab the port.
let listening = false;
function watchPlugging() {
  const s = serial();
  if (listening || !s) return;
  listening = true;
  s.addEventListener('connect', () => { lastAutoOpen = 0; ensurePoleDisplayOpen(); });
  s.addEventListener('disconnect', (e: Event) => { if (e.target === port) void closePort(); });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Asks which port the display is on (must run from a click), opens it and remembers it. */
export async function connectPoleDisplay(): Promise<boolean> {
  const s = serial();
  if (!s) {
    usePoleDisplayState.setState({ error: UNSUPPORTED });
    return false;
  }
  let picked: SerialPortLike;
  try {
    picked = await s.requestPort();
  } catch {
    return false; // picker closed without choosing
  }
  watchPlugging();
  if (opening) await opening;
  await closePort();
  if (!(await openPort(picked))) return false;
  const { usbVendorId, usbProductId } = picked.getInfo();
  useHardwareStore.getState().update({
    poleDisplayEnabled: true,
    poleDisplayVendorId: usbVendorId ?? null,
    poleDisplayProductId: usbProductId ?? null,
  });
  return true;
}

/** Blanks the display, closes its port and stops sending to it. */
export async function disconnectPoleDisplay(): Promise<void> {
  if (writer) {
    try { await writer.write(Uint8Array.from(CLEAR)); } catch { /* closing anyway */ }
  }
  await closePort();
  useHardwareStore.getState().update({ poleDisplayEnabled: false });
  usePoleDisplayState.setState({ error: null });
}

/** Puts a sample sale on the display; false when it isn't connected. */
export function testPoleDisplay(): boolean {
  if (!writer) return false;
  show([row('Test item', money(15.5)), row('TOTAL', money(40.47))]);
  return true;
}

/** Shows a customer-display update on the pole display, if one is set up. */
export function showOnPoleDisplay(data: CartDisplayData): void {
  if (!useHardwareStore.getState().poleDisplayEnabled) return;
  if (data.storeName) storeName = data.storeName;
  clearTimeout(welcomeTimer);
  const items = data.type === 'cart' ? data.items ?? [] : [];

  if (items.length) {
    saleEndedAt = 0;
    show(cartLines(data, touchedItem(items)));
  } else if (data.type === 'thankyou') {
    prevQty = new Map();
    saleEndedAt = Date.now();
    show(saleEndLines(data));
  } else {
    prevQty = new Map();
    const wait = saleEndedAt + SALE_END_HOLD_MS - Date.now();
    if (wait > 0) {
      welcomeTimer = setTimeout(() => { saleEndedAt = 0; show(welcomeLines()); }, wait);
    } else {
      show(welcomeLines());
    }
  }
  ensurePoleDisplayOpen();
}
