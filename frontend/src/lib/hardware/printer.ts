/**
 * Thermal Printer Service
 * Supports three modes:
 *  1. browser — opens window.print() with receipt-formatted CSS (works with ANY printer,
 *               but the cashier sees a print dialog and must pick a printer every time)
 *  2. webusb  — sends raw ESC/POS bytes directly to a USB thermal printer (no dialog, instant)
 *  3. system  — silent-prints to a specific OS printer chosen once in Hardware Setup, via the
 *               Core desktop app's Electron shell (window.electronAPI). No dialog, no per-order
 *               printer choice — this only works inside the installed desktop app, never a
 *               plain browser tab, since only Electron can print without a user gesture/dialog.
 *
 * Two printers can be set up per device, each with its own mode: the front
 * "receipt" printer (customer receipts) and the "kitchen" printer (order tickets
 * for the back). USB/Bluetooth connections are held per role, so both can be
 * direct-connected at once.
 */
import { companyLogo, drawOnWhite, loadImage } from '../companyLogo';
import { bridgePrint, bridgePrinters } from './printBridge';
import { qzPrintRaw, qzPrinters } from './qzTray';
import { useHardwareStore, type ChosenPrinter } from '../../stores/hardwareStore';
import { goFiscalApi } from '../../api';

interface ElectronPrinterBridge {
  isElectron: true;
  listPrinters: () => Promise<Array<{ name: string; displayName: string; isDefault: boolean; status?: number }>>;
  printSilent: (html: string, printerName: string) => Promise<{ success: boolean; failureReason?: string }>;
}

function electronBridge(): ElectronPrinterBridge | undefined {
  return (globalThis as any).electronAPI as ElectronPrinterBridge | undefined;
}

/** Whether silent, dialog-free system printing is possible in this window — only true inside the Core desktop app. */
export function isSystemPrintAvailable(): boolean {
  return !!electronBridge()?.isElectron;
}

/** Lists every printer Windows knows about (USB, Bluetooth-paired, network) — desktop app only. */
export async function listSystemPrinters(): Promise<Array<{ name: string; displayName: string; isDefault: boolean }>> {
  const bridge = electronBridge();
  if (!bridge) return [];
  try {
    return await bridge.listPrinters();
  } catch {
    return [];
  }
}

export interface AvailablePrinter {
  name: string;
  displayName: string;
  isDefault: boolean;
  offline?: boolean;
}

/**
 * Every printer Windows has installed on this computer — USB, Bluetooth-
 * paired or network — for choosing bill and kitchen printers: the desktop
 * app asks Windows itself; a browser asks QZ Tray or the Core Bridge,
 * whichever this till prints through (and throws when it isn't running).
 */
export async function listPrinters(): Promise<AvailablePrinter[]> {
  if (electronBridge()) return listSystemPrinters();
  if (useHardwareStore.getState().printConnector === 'qz') {
    return (await qzPrinters()).map((p) => ({ name: p.name, displayName: p.name, isDefault: p.isDefault }));
  }
  return (await bridgePrinters()).map((p) => ({ name: p.name, displayName: p.name, isDefault: p.isDefault, offline: p.offline }));
}

/** Whether printers can be chosen from that list here: the desktop app, or a browser (through QZ Tray or the Core Bridge). */
export function canChoosePrinters(): boolean {
  return isSystemPrintAvailable() || typeof WebSocket !== 'undefined';
}

/** Characters per line for a thermal roll, in the printer's normal font. */
function escPosColumns(paper: ChosenPrinter['paper']): number {
  return paper === '58mm' ? 32 : 48;
}

/**
 * Prints on each printer at once: rendered HTML in the desktop app, or the
 * printer's own ESC/POS bytes through QZ Tray or the Core Bridge in a
 * browser. Returns what went wrong on any that didn't print, grouped by
 * reason.
 */
async function printOnChosen<T extends { name: string }>(
  targets: T[], html: (t: T) => string, escpos: (t: T) => Uint8Array,
): Promise<{ failed: number; problems: string }> {
  const desktop = electronBridge();
  const sendRaw = useHardwareStore.getState().printConnector === 'qz' ? qzPrintRaw : bridgePrint;
  const results = await Promise.allSettled(targets.map(async (t) => {
    if (desktop) {
      const result = await desktop.printSilent(html(t), t.name);
      if (!result.success) throw new Error(result.failureReason || 'Print failed');
    } else {
      await sendRaw(t.name, escpos(t));
    }
  }));
  const byReason = new Map<string, string[]>();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') return;
    const reason = String((r.reason as any)?.message ?? r.reason).trim().replace(/\.$/, '');
    byReason.set(reason, [...(byReason.get(reason) ?? []), targets[i].name]);
  });
  return {
    failed: results.filter((r) => r.status === 'rejected').length,
    problems: [...byReason].map(([reason, names]) => `${names.join(', ')}: ${reason}`).join(' · '),
  };
}

// ---------------------------------------------------------------------------
// ESC/POS byte helpers
// ---------------------------------------------------------------------------
const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

function bytes(...args: number[]): Uint8Array { return new Uint8Array(args); }
function text(s: string): Uint8Array { return new TextEncoder().encode(s); }
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

const ESC_INIT        = bytes(ESC, 0x40);
const ESC_ALIGN_LEFT  = bytes(ESC, 0x61, 0x00);
const ESC_ALIGN_CENTER= bytes(ESC, 0x61, 0x01);
const ESC_BOLD_ON     = bytes(ESC, 0x45, 0x01);
const ESC_BOLD_OFF    = bytes(ESC, 0x45, 0x00);
const ESC_DWIDTH_ON   = bytes(GS,  0x21, 0x11);
const ESC_DWIDTH_OFF  = bytes(GS,  0x21, 0x00);
const ESC_TRIPLE_ON   = bytes(GS,  0x21, 0x22); // 3× width and height; ESC_DWIDTH_OFF ends it
const ESC_CUT         = bytes(GS,  0x56, 0x42, 0x00);
const CASH_DRAWER     = bytes(ESC, 0x70, 0x00, 0x19, 0x78);

function line(s = ''): Uint8Array { return concat(text(s), bytes(LF)); }
function divider(char = '-', len = 32): Uint8Array { return line(char.repeat(len)); }

/**
 * The company logo as an ESC/POS raster image (GS v 0, which nearly every
 * thermal printer understands): fitted inside 320 × 120 dots — about 40 ×
 * 15 mm, inside a 58 mm roll's 384 — and black wherever the picture is
 * darker than mid-grey. Null with no logo, or one that won't load: a
 * receipt never waits on its logo.
 */
async function escPosLogo(logo?: string): Promise<Uint8Array | null> {
  if (!logo) return null;
  try {
    const canvas = drawOnWhite(await loadImage(logo), 320, 120);
    const { width: w, height: h } = canvas;
    const px = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
    const rowBytes = Math.ceil(w / 8);
    const out = new Uint8Array(8 + rowBytes * h);
    out.set([GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, h & 0xff, h >> 8]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 128) out[8 + y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The fiscal QR code as a raster image too (GS v 0, like the logo — far more
 * printers take it than the GS ( k QR command): each module 3–6 dots, about
 * 25 mm across with its quiet zone. Null without a link, or if it won't encode.
 */
function escPosQr(url?: string): Uint8Array | null {
  if (!url) return null;
  try {
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const n = modules.size;
    const quiet = 4;
    const scale = Math.max(3, Math.min(6, Math.floor(200 / (n + 2 * quiet))));
    const w = (n + 2 * quiet) * scale;
    const rowBytes = Math.ceil(w / 8);
    const out = new Uint8Array(8 + rowBytes * w);
    out.set([GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, w & 0xff, w >> 8]);
    for (let y = 0; y < w; y++) {
      const row = Math.floor(y / scale) - quiet;
      for (let x = 0; x < w; x++) {
        const col = Math.floor(x / scale) - quiet;
        if (row >= 0 && col >= 0 && row < n && col < n && modules.get(row, col)) out[8 + y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Receipt data shape
// ---------------------------------------------------------------------------
export interface ReceiptLine {
  name: string;
  qty: number;
  price: number;
  total: number;
  sku?: string;
  barcode?: string;
}

export interface ReceiptData {
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  storeEmail?: string;
  reference: string;
  cashier: string;
  date: string;
  items: ReceiptLine[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  amountTendered?: number;
  change?: number;
  currency: string;
  footer?: string;
  /** Company logo data URL (Settings → Business Profile), printed at the top. */
  logo?: string;
  // Fiscal invoice extras
  vatNumber?: string;
  tinNumber?: string;
  vatRate?: number;
  tradingName?: string;
  posNumber?: string;
  currencyCode?: string;
  currencyRate?: number;
  orderType?: 'sit_in' | 'takeaway' | 'delivery';
  // Order-info block (mirrors a fiscal till slip's header rows)
  branchName?: string;
  orderNum?: string;
  /** A restaurant sale: the order number prints large at the top, for the customer to listen out for. */
  restaurant?: boolean;
  customerName?: string;
  covers?: number;
  tableNumber?: string;
  // Fiscal device identifiers — printed as-is from Settings, never generated here
  deviceId?: string;
  fiscalDay?: string;
  recGn?: string;
  rec68?: string;
  // Real ZIMRA fiscalisation result for this sale/refund (see fiscal_receipt on
  // the API response) — takes over from the legacy static fields above once a
  // receipt has actually been submitted and accepted.
  fiscalVerificationCode?: string;
  fiscalQrCodeUrl?: string;
  fiscalReceiptGlobalNo?: number;
  fiscalDeviceId?: number;
  fiscalDayNo?: number;
  /** A GoFiscal receipt that wasn't through when the sale saved — finished just before printing (withFiscalResult). */
  fiscalPendingId?: number;
}

export type ReceiptPrintMode = 'browser' | 'webusb' | 'webbluetooth' | 'system' | 'none';

export interface BuildReceiptOptions {
  /** Settings (GET /settings): the business details every receipt prints — see companyDetails. */
  settings?: Record<string, any> | null;
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  cashier?: string;
  currency?: string;
  paymentMethod?: string;
  amountTendered?: number;
  change?: number;
  footer?: string;
  logo?: string;
  date?: string;
  itemsFallback?: ReceiptLine[];
  // Fiscal invoice extras
  vatNumber?: string;
  tinNumber?: string;
  vatRate?: number;
  tradingName?: string;
  posNumber?: string;
  currencyCode?: string;
  currencyRate?: number;
  orderType?: 'sit_in' | 'takeaway' | 'delivery';
  branchName?: string;
  orderNum?: string;
  customerName?: string;
  covers?: number;
  tableNumber?: string;
  deviceId?: string;
  fiscalDay?: string;
  recGn?: string;
  rec68?: string;
}

function orderTypeLabel(orderType: 'sit_in' | 'takeaway' | 'delivery'): string {
  if (orderType === 'takeaway') return 'TAKEAWAY';
  if (orderType === 'delivery') return 'DELIVERY';
  return 'WALK-IN';
}

function money(value: unknown): number {
  const amount = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(amount) ? amount : 0;
}

function printableDate(value: unknown): string {
  if (!value) return new Date().toLocaleString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

export function resolveReceiptPrintMode(mode: ReceiptPrintMode): 'browser' | 'webusb' | 'webbluetooth' | 'system' {
  if (mode === 'webusb') return 'webusb';
  if (mode === 'webbluetooth') return 'webbluetooth';
  // Chosen printers: the desktop app prints to them itself, a browser through
  // the Core Bridge; anything else falls back to the print dialog.
  if (mode === 'system' && canChoosePrinters()) return 'system';
  return 'browser';
}

/**
 * The business as Settings describes it — name, address, phone, email,
 * VAT / TIN numbers, logo and receipt footer — for the top and bottom of
 * every receipt. Blank ones are left out, so whatever's passed in instead
 * (or the sale's branch) fills in.
 */
export function companyDetails(settings?: Record<string, any> | null): Pick<ReceiptData, 'storeAddress' | 'storePhone' | 'storeEmail' | 'vatNumber' | 'tinNumber' | 'logo' | 'footer'> & { storeName?: string } {
  const text = (key: string): string | undefined => {
    const value = settings?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  return {
    storeName: text('company_name'),
    storeAddress: text('company_address'),
    storePhone: text('company_phone'),
    storeEmail: text('company_email'),
    vatNumber: text('company_vat_number'),
    tinNumber: text('company_tin_number'),
    logo: companyLogo(settings),
    footer: text('receipt_footer'),
  };
}

export function buildReceiptDataFromSale(sale: any, options: BuildReceiptOptions = {}): ReceiptData {
  const company = companyDetails(options.settings);
  const items = Array.isArray(sale?.items) && sale.items.length > 0
    ? sale.items.map((item: any) => {
        const qty = money(item?.quantity ?? item?.qty);
        const price = money(item?.unit_price ?? item?.price);
        const total = money(item?.total ?? item?.subtotal ?? (qty * price));
        return {
          name: item?.product?.name ?? item?.name ?? 'Item',
          qty,
          price,
          total,
          sku: item?.product?.sku ?? item?.sku,
          barcode: item?.product?.barcode ?? item?.barcode,
        };
      })
    : (options.itemsFallback ?? []);

  const subtotal = money(sale?.subtotal ?? items.reduce((sum: number, item: ReceiptLine) => sum + item.total, 0));
  const tax = money(sale?.tax_total ?? sale?.tax_amount);
  const discount = money(sale?.discount_total ?? sale?.discount_amount ?? sale?.discount_value);

  return {
    // The business details saved in Settings come first; a branch's own
    // address / phone only fill in where Settings has none.
    storeName: company.storeName ?? options.storeName ?? 'Core',
    storeAddress: company.storeAddress ?? sale?.branch?.address ?? options.storeAddress,
    storePhone: company.storePhone ?? sale?.branch?.phone ?? options.storePhone,
    storeEmail: company.storeEmail,
    reference: sale?.reference ?? `#${sale?.id ?? 'SALE'}`,
    cashier: sale?.cashier?.name ?? options.cashier ?? '',
    date: options.date ?? printableDate(sale?.completed_at ?? sale?.created_at),
    items,
    subtotal,
    tax,
    discount,
    total: money(sale?.total ?? subtotal + tax - discount),
    paymentMethod: sale?.payments?.[0]?.method ?? options.paymentMethod ?? 'cash',
    amountTendered: options.amountTendered,
    change: options.change ?? money(sale?.change_due),
    currency: options.currency ?? '$',
    footer: options.footer ?? company.footer,
    logo: company.logo ?? options.logo,
    vatNumber: company.vatNumber ?? options.vatNumber,
    tinNumber: company.tinNumber ?? options.tinNumber,
    vatRate: options.vatRate,
    tradingName: options.tradingName,
    posNumber: options.posNumber,
    currencyCode: options.currencyCode,
    currencyRate: options.currencyRate ?? 1,
    orderType: options.orderType,
    branchName: options.branchName ?? sale?.branch?.name,
    // The order number (resets after each Day End); sales from before order
    // numbers existed show their id as they always did.
    orderNum: options.orderNum ?? (sale?.order_number != null ? String(sale.order_number) : sale?.id != null ? String(sale.id) : undefined),
    restaurant: sale?.business_type === 'restaurant',
    customerName: options.customerName ?? sale?.customer?.name,
    covers: options.covers,
    tableNumber: options.tableNumber ?? sale?.table_number ?? undefined,
    deviceId: options.deviceId,
    fiscalDay: options.fiscalDay,
    recGn: options.recGn,
    rec68: options.rec68,
    ...fiscalFields(sale?.fiscal_receipt),
  };
}

/** The fiscal block's fields from a sale's / refund's fiscal_receipt (ZIMRA direct or GoFiscal). */
function fiscalFields(fr: any): Partial<ReceiptData> {
  return {
    fiscalVerificationCode: groupedVerificationCode(fr?.qr_data),
    fiscalQrCodeUrl: fr?.qr_code_url ?? undefined,
    fiscalReceiptGlobalNo: fr?.receipt_global_no ?? undefined,
    fiscalDeviceId: fr?.device_id ?? undefined,
    fiscalDayNo: fr?.fiscal_day_no ?? undefined,
    fiscalPendingId: fr?.provider === 'gofiscal' && fr?.status === 'pending' ? fr.id : undefined,
  };
}

/** Displays the raw qr_data as four-character groups separated by "-", per §11's receipt verification code format. */
function groupedVerificationCode(qrData?: string): string | undefined {
  if (!qrData) return undefined;
  return qrData.match(/.{1,4}/g)?.join('-');
}

/** Whether the bill carries a real fiscal result (and not the static fields from Settings). */
function isFiscalised(d: ReceiptData): boolean {
  return d.fiscalReceiptGlobalNo != null || !!d.fiscalVerificationCode;
}

/**
 * A GoFiscal receipt that wasn't through when the sale saved (the engine,
 * or ZIMRA behind it, was slow) is finished here, just before printing, so
 * the customer's copy carries its verification code and QR. If it still
 * isn't through, the bill prints without them and the sync poll sends the
 * receipt later.
 */
async function withFiscalResult(d: ReceiptData): Promise<ReceiptData> {
  if (!d.fiscalPendingId) return d;
  try {
    const fr = (await goFiscalApi.submit(d.fiscalPendingId)).data?.data;
    return { ...d, ...(fr?.status === 'submitted' ? fiscalFields(fr) : {}), fiscalPendingId: undefined };
  } catch {
    return { ...d, fiscalPendingId: undefined };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function parseReceiptDate(d: ReceiptData): { dateStr: string; timeStr: string } {
  try {
    const dt = new Date(d.date);
    if (!isNaN(dt.getTime())) {
      return {
        dateStr: dt.toLocaleDateString('en-GB'),
        timeStr: dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };
    }
  } catch {}
  return { dateStr: d.date, timeStr: '' };
}

// Sale amounts (items, subtotal, tax, total) are always recorded in the
// store's base currency — only amountTendered/change are already in
// whatever currency the cashier tendered in. Everything here needs the
// exchange rate applied before it's printed, or a ZAR sale prints its USD
// magnitudes with a ZAR/R symbol slapped on and the rate mentioned only as
// a footnote instead of actually being applied.
function vatInfo(d: ReceiptData): { net: number; vat: number; gross: number; pct: string } {
  const rate  = Number(d.currencyRate ?? 1);
  const gross = d.total * rate;
  const vat   = d.tax * rate;
  const net   = d.subtotal > 0 ? d.subtotal * rate : gross - vat;
  const pct   = d.vatRate != null
    ? d.vatRate.toFixed(1)
    : (net > 0 && vat > 0 ? ((vat / net) * 100).toFixed(1) : '0.0');
  return { net, vat, gross, pct };
}

// ---------------------------------------------------------------------------
// ESC/POS receipt builder
// ---------------------------------------------------------------------------
function buildEscPosReceipt(d: ReceiptData, logo: Uint8Array | null = null, W = 32): Uint8Array {
  const fmt2 = (n: number) => n.toFixed(2);
  const pad = (l: string, r: string, w = W) => {
    const gap = w - l.length - r.length;
    return l + ' '.repeat(Math.max(1, gap)) + r;
  };
  const cut = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + '.' : s;

  const { dateStr, timeStr } = parseReceiptDate(d);
  const { net, vat, gross, pct } = vatInfo(d);
  const itemCount = d.items.reduce((s, i) => s + i.qty, 0);
  const currCode = d.currencyCode ?? '';
  const rateNum = Number(d.currencyRate ?? 1);
  const rate = rateNum.toFixed(6);

  const parts: Uint8Array[] = [
    ESC_INIT,
    ESC_ALIGN_CENTER,
    ...(logo ? [logo, bytes(LF)] : []),
    ESC_BOLD_ON, line('***FISCAL TAX INVOICE***'), ESC_BOLD_OFF,
    bytes(LF),
    ESC_DWIDTH_ON, line(cut(d.storeName, W / 2)), ESC_DWIDTH_OFF,
  ];

  if (d.branchName && d.branchName !== d.storeName) {
    parts.push(ESC_BOLD_ON, line(cut(d.branchName, W)), ESC_BOLD_OFF);
  }
  if (d.tradingName && d.tradingName !== d.storeName) {
    parts.push(line('T/A'), ESC_BOLD_ON, line(cut(d.tradingName, W)), ESC_BOLD_OFF);
  }
  if (d.storeAddress) {
    for (const seg of d.storeAddress.split(/[,\n]/).map(s => s.trim()).filter(Boolean)) {
      parts.push(line(cut(seg, W)));
    }
  }
  parts.push(divider('-', W));

  // A restaurant calls its orders by number: it goes big, where the customer sees it first.
  if (d.restaurant && d.orderNum) {
    parts.push(ESC_BOLD_ON, line('ORDER NO.'), ESC_TRIPLE_ON, line(`#${d.orderNum}`), ESC_DWIDTH_OFF, ESC_BOLD_OFF, divider('-', W));
  }

  // Order-info block
  parts.push(ESC_ALIGN_LEFT);
  if (d.orderNum && !d.restaurant) parts.push(ESC_BOLD_ON, line(`Order Num : ${d.orderNum}`), ESC_BOLD_OFF);
  parts.push(line(`Tax Inv No : ${d.reference}`));
  if (d.customerName) parts.push(line(`Customer : ${d.customerName}`));
  if (d.covers) parts.push(line(`Covers : ${d.covers}`));
  parts.push(line(`Cashier : ${d.cashier}`));
  if (d.tableNumber) parts.push(line(`Table : ${d.tableNumber}`));

  parts.push(ESC_ALIGN_CENTER, line(pad(dateStr, timeStr)), line('All Prices VAT Inclusive'));
  if (d.orderType) {
    parts.push(bytes(LF), ESC_BOLD_ON, line(`** ${orderTypeLabel(d.orderType)} **`), ESC_BOLD_OFF);
  }
  parts.push(ESC_ALIGN_LEFT);
  parts.push(divider('-', W));

  parts.push(ESC_BOLD_ON, line('DESCRIPTION'), ESC_BOLD_OFF);
  parts.push(line(pad('QTY', 'PRICE  TOTAL COST')));
  parts.push(divider('-', W));

  for (const item of d.items) {
    const code = item.barcode ?? item.sku ?? '';
    if (code) parts.push(line(cut(code, W)));
    parts.push(line(cut(item.name, W)));
    parts.push(line(pad(`  ${item.qty} X  ${fmt2(item.price * rateNum)}`, fmt2(item.total * rateNum))));
  }
  parts.push(divider('-', W));

  parts.push(
    line(pad('Total Excl', fmt2(net))),
    line(pad(`Output Tax (${pct}%)`, fmt2(vat))),
    ESC_BOLD_ON, line(pad('Total Incl', fmt2(gross))), ESC_BOLD_OFF,
    divider('-', W),
    ESC_BOLD_ON, line(pad('TOTAL', fmt2(gross))), ESC_BOLD_OFF,
  );
  if (d.amountTendered !== undefined) parts.push(line(pad('TENDERED', fmt2(d.amountTendered))));
  if (d.change !== undefined && d.change >= 0) parts.push(line(pad('CHANGE', fmt2(d.change))));
  parts.push(line(pad('ITEM#', String(itemCount))));

  parts.push(ESC_BOLD_ON, line('Payment Summary'), ESC_BOLD_OFF, divider('-', W));
  parts.push(line(`${d.paymentMethod.replace('_', ' ').toUpperCase()} ${currCode}`));
  if (d.amountTendered !== undefined) {
    parts.push(line(`${d.currency}${fmt2(d.amountTendered)} @ Rate ${d.currency}${rate}`));
  }

  // Fiscal footer — business registration details
  parts.push(divider('-', W));
  if (d.storePhone) parts.push(line(`Tel : ${d.storePhone}`));
  if (d.storeEmail) parts.push(line(`Email : ${d.storeEmail}`));
  if (d.vatNumber)  parts.push(line(`VAT No : ${d.vatNumber}`));
  if (d.tinNumber)  parts.push(line(`TIN No : ${d.tinNumber}`));
  if (!isFiscalised(d)) {
    if (d.deviceId)   parts.push(line(`Device Id : ${d.deviceId}`));
    if (d.recGn)      parts.push(line(`REC GN : ${d.recGn}`));
    if (d.rec68)      parts.push(line(`REC 68 : ${d.rec68}`));
    if (d.fiscalDay)  parts.push(line(`Fiscal Day : ${d.fiscalDay}`));
  } else {
    if (d.fiscalDeviceId != null) parts.push(line(`Device Id : ${d.fiscalDeviceId}`));
    if (d.fiscalDayNo != null) parts.push(line(`Fiscal Day : ${d.fiscalDayNo}`));
    if (d.fiscalReceiptGlobalNo != null) parts.push(line(`Rec No : ${d.fiscalReceiptGlobalNo}`));
  }

  parts.push(
    bytes(LF),
    ESC_ALIGN_CENTER,
    ESC_BOLD_ON, line('FISCAL TAX INVOICE'), ESC_BOLD_OFF,
  );
  if (isFiscalised(d)) {
    const qr = escPosQr(d.fiscalQrCodeUrl);
    if (qr) parts.push(qr, bytes(LF));
    if (d.fiscalVerificationCode) parts.push(line('Verification code:'), ESC_BOLD_ON, line(d.fiscalVerificationCode), ESC_BOLD_OFF);
    if (d.fiscalQrCodeUrl) parts.push(line(cut(`Verify at ${d.fiscalQrCodeUrl.split('/').slice(2, 3).join('')}`, W)));
  }
  parts.push(
    divider('=', W),
    line(d.footer ?? 'Core POS'),
    bytes(LF, LF, LF),
    ESC_CUT,
  );

  return concat(...parts);
}

// ---------------------------------------------------------------------------
// Printer roles — each role keeps its own direct USB / Bluetooth connection
// ---------------------------------------------------------------------------
export type PrinterRole = 'receipt' | 'kitchen';

interface UsbConnection { device: any; iface: number; endpoint: number }
interface BleConnection { device: any; characteristic: any }

const usbConnections: Partial<Record<PrinterRole, UsbConnection>> = {};
const bleConnections: Partial<Record<PrinterRole, BleConnection>> = {};

/** Whether this role currently has a live direct (USB/Bluetooth) connection for the given mode. */
export function isPrinterConnected(role: PrinterRole, mode: ReceiptPrintMode): boolean {
  if (mode === 'webusb') return !!usbConnections[role];
  if (mode === 'webbluetooth') return !!bleConnections[role]?.device?.gatt?.connected;
  return false;
}

// ---------------------------------------------------------------------------
// WebUSB printer connection
// ---------------------------------------------------------------------------
async function openUsbDevice(device: any): Promise<UsbConnection> {
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);

  let iface = 0;
  let endpoint = 1;
  for (const i of device.configuration!.interfaces) {
    for (const alt of i.alternates) {
      for (const ep of alt.endpoints) {
        if (ep.direction === 'out' && ep.type === 'bulk') {
          iface = i.interfaceNumber;
          endpoint = ep.endpointNumber;
        }
      }
    }
  }

  await device.claimInterface(iface);
  return { device, iface, endpoint };
}

export async function connectUsbPrinter(role: PrinterRole = 'receipt'): Promise<{ name: string; vendorId: number; productId: number }> {
  if (!('usb' in navigator)) throw new Error('WebUSB not supported in this browser');
  const device = await (navigator as any).usb.requestDevice({ filters: [] });
  await disconnectUsbPrinter(role);
  usbConnections[role] = await openUsbDevice(device);
  return { name: device.productName ?? 'USB Printer', vendorId: device.vendorId, productId: device.productId };
}

/**
 * Silently reopens a USB printer this browser was already granted access to
 * (navigator.usb.getDevices needs no user gesture), so a reload doesn't drop
 * the till back to the print dialog. Returns whether it's connected afterwards.
 */
export async function reconnectUsbPrinter(role: PrinterRole, vendorId: number | null, productId: number | null): Promise<boolean> {
  if (usbConnections[role]) return true;
  if (!vendorId || !productId || !('usb' in navigator)) return false;
  try {
    const devices: any[] = await (navigator as any).usb.getDevices();
    const device = devices.find((d) => d.vendorId === vendorId && d.productId === productId);
    if (!device) return false;
    // The same physical printer can't be opened twice — share it if the other role already holds it.
    const other = Object.values(usbConnections).find((c) => c?.device === device);
    usbConnections[role] = other ?? await openUsbDevice(device);
    return true;
  } catch {
    return false;
  }
}

export async function disconnectUsbPrinter(role: PrinterRole = 'receipt'): Promise<void> {
  const conn = usbConnections[role];
  if (!conn) return;
  delete usbConnections[role];
  // Leave the device open if the other role is printing to the same printer.
  if (Object.values(usbConnections).some((c) => c?.device === conn.device)) return;
  try { await conn.device.releaseInterface(conn.iface); } catch {}
  try { await conn.device.close(); } catch {}
}

async function sendToUsb(data: Uint8Array, role: PrinterRole = 'receipt'): Promise<void> {
  const conn = usbConnections[role];
  if (!conn) throw new Error('No USB printer connected');
  await conn.device.transferOut(conn.endpoint, data);
}

// ---------------------------------------------------------------------------
// Web Bluetooth printer connection — the genuine no-dialog path for a
// Bluetooth thermal printer from a plain browser tab (no desktop app needed).
// Unlike USB, thermal printers don't share one standard Bluetooth LE profile;
// this covers the common ESC/POS BLE printer service plus the generic BLE-UART
// serial services several cheap printer boards reuse. Most inexpensive 58/80mm
// Bluetooth receipt printers are covered; a handful of vendor-proprietary ones
// are not — those still work via the "System Print Dialog" mode instead.
// ---------------------------------------------------------------------------
const BLE_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // common ESC/POS BLE printer service
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style BLE-UART
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip/RN-series BLE serial
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Nordic UART-style custom service
];

export async function connectBluetoothPrinter(role: PrinterRole = 'receipt'): Promise<{ name: string }> {
  if (!('bluetooth' in navigator)) throw new Error('Web Bluetooth not supported in this browser');
  const device = await (navigator as any).bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_PRINTER_SERVICES,
  });
  const server = await device.gatt.connect();

  let characteristic: any = null;
  for (const serviceUuid of BLE_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      const chars = await service.getCharacteristics();
      characteristic = chars.find((c: any) => c.properties.writeWithoutResponse || c.properties.write) ?? null;
      if (characteristic) break;
    } catch {
      // This device doesn't expose that particular service — try the next one.
    }
  }

  if (!characteristic) {
    try { device.gatt.disconnect(); } catch {}
    throw new Error('Connected, but no printable service found on this device — it may use a proprietary protocol');
  }

  await disconnectBluetoothPrinter(role);
  bleConnections[role] = { device, characteristic };
  return { name: device.name ?? 'Bluetooth Printer' };
}

export async function disconnectBluetoothPrinter(role: PrinterRole = 'receipt'): Promise<void> {
  const conn = bleConnections[role];
  if (!conn) return;
  delete bleConnections[role];
  if (Object.values(bleConnections).some((c) => c?.device === conn.device)) return;
  if (conn.device?.gatt?.connected) {
    try { conn.device.gatt.disconnect(); } catch {}
  }
}

async function sendToBluetooth(data: Uint8Array, role: PrinterRole = 'receipt'): Promise<void> {
  const characteristic = bleConnections[role]?.characteristic;
  if (!characteristic) throw new Error('No Bluetooth printer connected');
  // BLE writes are capped by the negotiated ATT MTU (often just 20 bytes) —
  // chunk so this works regardless of what the connected stack negotiated.
  const CHUNK = 100;
  const canWriteWithoutResponse = !!characteristic.properties?.writeWithoutResponse;
  for (let offset = 0; offset < data.length; offset += CHUNK) {
    const chunk = data.slice(offset, offset + CHUNK);
    if (canWriteWithoutResponse) await characteristic.writeValueWithoutResponse(chunk);
    else await characteristic.writeValue(chunk);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ---------------------------------------------------------------------------
// Open cash drawer — wired to the front (receipt) printer
// ---------------------------------------------------------------------------
export async function openCashDrawer(): Promise<void> {
  if (usbConnections.receipt) await sendToUsb(CASH_DRAWER, 'receipt');
}

// ---------------------------------------------------------------------------
// Print receipt
// ---------------------------------------------------------------------------
export async function printReceipt(
  data: ReceiptData,
  mode: 'browser' | 'webusb' | 'webbluetooth' | 'system' = 'browser',
  /** Mode 'system': the bill prints on each of these. */
  printers: ChosenPrinter[] = [],
): Promise<void> {
  // Printing straight to a printer can wait for the receipt's fiscal result;
  // the print dialog's window can't open late (popup blockers), so it waits inside.
  const direct = (mode === 'webusb' && !!usbConnections.receipt) || (mode === 'webbluetooth' && !!bleConnections.receipt) || (mode === 'system' && printers.length > 0);
  if (direct) data = await withFiscalResult(data);

  if (mode === 'webusb' && usbConnections.receipt) {
    await sendToUsb(buildEscPosReceipt(data, await escPosLogo(data.logo)), 'receipt');
    return;
  }
  if (mode === 'webbluetooth' && bleConnections.receipt) {
    await sendToBluetooth(buildEscPosReceipt(data, await escPosLogo(data.logo)), 'receipt');
    return;
  }
  if (mode === 'system') {
    if (printers.length === 0) {
      await browserPrintReceipt(data);
      throw new Error('No bill printer ticked in Hardware > Receipt Printer — opened the print dialog instead.');
    }
    const desktop = isSystemPrintAvailable();
    const qrImageDataUrl = desktop ? await renderFiscalQrDataUrl(data.fiscalQrCodeUrl) : undefined;
    const logo = desktop ? null : await escPosLogo(data.logo);
    const { failed, problems } = await printOnChosen(printers,
      (p) => buildReceiptHtml(data, { paperWidth: p.paper }, qrImageDataUrl),
      (p) => buildEscPosReceipt(data, logo, escPosColumns(p.paper)));
    // The customer still gets a bill when none of the printers could print it.
    if (failed === printers.length) {
      await browserPrintReceipt(data);
      throw new Error(`Bill not printed — ${problems}. Opened the print dialog instead.`);
    }
    if (failed > 0) throw new Error(`Bill not printed on ${problems}`);
    return;
  }
  await browserPrintReceipt(data);
}

// ---------------------------------------------------------------------------
// Kitchen order ticket — what the back needs to cook: table, waiter, time and
// items in large type. No prices, no payment details.
// ---------------------------------------------------------------------------
export interface KitchenTicketItem {
  name: string;
  qty: number;
  soldByWeight?: boolean;
  /** Which chosen kitchen printers take this line (their categories). */
  categoryId?: number;
}

export interface KitchenTicketData {
  /** e.g. "NEW ORDER", or "ADD TO ORDER" when a table orders more later. */
  title: string;
  ticket?: string;
  table?: string;
  orderType?: 'sit_in' | 'takeaway' | 'delivery';
  covers?: number;
  waiter?: string;
  customerName?: string;
  items: KitchenTicketItem[];
  note?: string;
  date?: Date;
}

/** What a kitchen ticket calls the order: the sale's order number once it exists, else `fallback` (the cart's own ticket number). */
export function kitchenOrderLabel(sale: any, fallback: string): string {
  return sale?.order_number != null ? `#${sale.order_number}` : sale?.reference ?? fallback;
}

function kitchenQty(item: KitchenTicketItem): string {
  return item.soldByWeight ? `${item.qty.toFixed(3)}kg` : `${+item.qty.toFixed(3)}`;
}

/** Word-wraps to `width` columns (ESC/POS has no automatic wrapping we can rely on). */
function wrapText(textValue: string, width: number): string[] {
  const words = textValue.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if ((current + ' ' + word).length <= width) current += ' ' + word;
    else { lines.push(current); current = word; }
    while (current.length > width) { lines.push(current.slice(0, width)); current = current.slice(width); }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function buildEscPosKitchenTicket(d: KitchenTicketData, cols = 32): Uint8Array {
  const date = d.date ?? new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const parts: Uint8Array[] = [
    ESC_INIT,
    ESC_ALIGN_CENTER, ESC_BOLD_ON, ESC_DWIDTH_ON, line(d.title), ESC_DWIDTH_OFF, ESC_BOLD_OFF,
  ];
  if (d.table) parts.push(ESC_DWIDTH_ON, line(d.table), ESC_DWIDTH_OFF);
  else if (d.orderType && d.orderType !== 'sit_in') parts.push(ESC_DWIDTH_ON, line(orderTypeLabel(d.orderType).toUpperCase()), ESC_DWIDTH_OFF);
  parts.push(ESC_ALIGN_LEFT, divider('=', cols));
  if (d.ticket) parts.push(ESC_BOLD_ON, line(`Order: ${d.ticket}`), ESC_BOLD_OFF);
  parts.push(line(`Time: ${time}`));
  if (d.waiter) parts.push(line(`Waiter: ${d.waiter}`));
  if (d.covers) parts.push(line(`Covers: ${d.covers}`));
  if (d.customerName) parts.push(line(`Customer: ${d.customerName}`));
  parts.push(divider('=', cols));
  // Double-height/width items: half the columns (16 at 58mm).
  parts.push(ESC_BOLD_ON, ESC_DWIDTH_ON);
  for (const item of d.items) {
    const prefix = `${kitchenQty(item)} x `;
    wrapText(item.name, cols / 2 - prefix.length).forEach((segment, i) => {
      parts.push(line(i === 0 ? prefix + segment : ' '.repeat(prefix.length) + segment));
    });
  }
  parts.push(ESC_DWIDTH_OFF, ESC_BOLD_OFF);
  if (d.note) {
    parts.push(divider('-', cols));
    parts.push(ESC_BOLD_ON, line('NOTE:'), ESC_BOLD_OFF);
    wrapText(d.note, cols).forEach((l) => parts.push(line(l)));
  }
  parts.push(divider('=', cols), line(), line(), line(), ESC_CUT);
  return concat(...parts);
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function buildKitchenTicketHtml(d: KitchenTicketData): string {
  const date = d.date ?? new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const where = d.table || (d.orderType && d.orderType !== 'sit_in' ? orderTypeLabel(d.orderType) : '');
  const meta = (d.ticket ? `<div class="order">Order: ${escapeHtml(d.ticket)}</div>` : '') + [
    `Time: ${time}`, d.waiter && `Waiter: ${d.waiter}`,
    d.covers && `Covers: ${d.covers}`, d.customerName && `Customer: ${d.customerName}`,
  ].filter(Boolean).map((m) => `<div>${escapeHtml(String(m))}</div>`).join('');
  const items = d.items.map((item) =>
    `<tr><td class="qty">${escapeHtml(kitchenQty(item))}</td><td>${escapeHtml(item.name)}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kitchen Order</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New',monospace; width:72mm; padding:3mm; color:#000; }
  .title { text-align:center; font-size:22px; font-weight:900; }
  .where { text-align:center; font-size:26px; font-weight:900; margin-top:2px; }
  .rule { border-top:2px dashed #000; margin:6px 0; }
  .meta { font-size:13px; line-height:1.4; }
  .order { font-size:16px; font-weight:900; }
  table { width:100%; border-collapse:collapse; font-size:20px; font-weight:800; }
  td { padding:3px 0; vertical-align:top; }
  td.qty { width:1%; white-space:nowrap; padding-right:8px; }
  .note { font-size:15px; font-weight:700; white-space:pre-wrap; }
  @media print { @page { margin:0; size:80mm auto; } }
</style></head><body>
<div class="title">${escapeHtml(d.title)}</div>
${where ? `<div class="where">${escapeHtml(where)}</div>` : ''}
<div class="rule"></div><div class="meta">${meta}</div><div class="rule"></div>
<table>${items}</table>
${d.note ? `<div class="rule"></div><div class="note">NOTE: ${escapeHtml(d.note)}</div>` : ''}
<div class="rule"></div>
</body></html>`;
}

export async function printKitchenTicket(
  data: KitchenTicketData,
  mode: 'browser' | 'webusb' | 'webbluetooth' | 'system' = 'browser',
  /** Mode 'system': each prints the lines in its categories (all of them with `allItems`, for a test ticket). */
  printers: ChosenPrinter[] = [],
  { allItems = false }: { allItems?: boolean } = {},
): Promise<void> {
  if (mode === 'webusb' && usbConnections.kitchen) {
    await sendToUsb(buildEscPosKitchenTicket(data), 'kitchen');
    return;
  }
  if (mode === 'webbluetooth' && bleConnections.kitchen) {
    await sendToBluetooth(buildEscPosKitchenTicket(data), 'kitchen');
    return;
  }
  if (mode === 'system') {
    if (printers.length === 0) {
      browserPrintKitchenTicket(data);
      throw new Error('No kitchen printer ticked in Hardware > Kitchen Printer — opened the print dialog instead.');
    }
    const takes = (p: ChosenPrinter, item: KitchenTicketItem) =>
      allItems || p.categoryIds.length === 0 || (item.categoryId != null && p.categoryIds.includes(item.categoryId));
    const jobs = printers
      .map((p) => ({ name: p.name, paper: p.paper, ticket: { ...data, items: data.items.filter((i) => takes(p, i)) } }))
      .filter((job) => job.ticket.items.length > 0);
    if (jobs.length === 0) return; // nothing on this order for any of them
    const { failed, problems } = await printOnChosen(jobs,
      (job) => buildKitchenTicketHtml(job.ticket),
      (job) => buildEscPosKitchenTicket(job.ticket, escPosColumns(job.paper)));
    // The kitchen still gets the order when none of the printers could print it.
    if (failed === jobs.length) {
      browserPrintKitchenTicket({ ...data, items: data.items.filter((i) => jobs.some((job) => job.ticket.items.includes(i))) });
      throw new Error(`Kitchen ticket not printed — ${problems}. Opened the print dialog instead.`);
    }
    if (failed > 0) throw new Error(`Kitchen ticket not printed on ${problems}`);
    return;
  }
  browserPrintKitchenTicket(data);
}

function browserPrintKitchenTicket(data: KitchenTicketData): void {
  const w = window.open('', '_blank', 'width=320,height=600,toolbar=0,scrollbars=1');
  if (!w) throw new Error('Allow popups to print kitchen orders');
  w.document.write(buildKitchenTicketHtml(data));
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 300);
}

// ---------------------------------------------------------------------------
// Browser print — layout driven by ReceiptSettings
// ---------------------------------------------------------------------------
import { loadReceiptSettings, FONT_FAMILY_MAP, type ReceiptSettings } from '../receiptSettings';
import QRCode from 'qrcode';

/** Renders the ZIMRA QR deep-link as a data-URL PNG for the browser/HTML receipt layout. Returns undefined if generation fails (printer.ts must never let a QR-image bug block printing). */
async function renderFiscalQrDataUrl(qrCodeUrl?: string): Promise<string | undefined> {
  if (!qrCodeUrl) return undefined;
  try {
    return await QRCode.toDataURL(qrCodeUrl, { margin: 1, width: 140 });
  } catch {
    return undefined;
  }
}

function dividerCss(style: ReceiptSettings['dividerStyle']): string {
  if (style === 'solid')  return 'border-top:1px solid #000; margin:4px 0;';
  if (style === 'double') return 'border-top:3px double #000; margin:4px 0;';
  return 'border-top:1px dashed #000; margin:4px 0;';
}

export function buildReceiptHtml(d: ReceiptData, settings?: Partial<ReceiptSettings>, qrImageDataUrl?: string): string {
  const s: ReceiptSettings = { ...loadReceiptSettings(), ...settings };
  const { dateStr, timeStr } = parseReceiptDate(d);
  const { net, vat, gross, pct } = vatInfo(d);
  const fmt2 = (n: number) => Number(n).toFixed(2);
  const itemCount = d.items.reduce((sum, i) => sum + i.qty, 0);
  const currCode = d.currencyCode ?? '';
  const rateNum = Number(d.currencyRate ?? 1);
  const rate = rateNum.toFixed(6);
  const font = FONT_FAMILY_MAP[s.fontFamily] ?? FONT_FAMILY_MAP.courier;
  const pageSize = s.paperWidth === 'a4' ? 'A4' : `${s.paperWidth} auto`;
  const bodyWidth = s.paperWidth === 'a4' ? '190mm' : s.paperWidth;
  const dvCss = dividerCss(s.dividerStyle);

  const addrLines = d.storeAddress
    ? d.storeAddress.split(/[,\n]/).map(x => x.trim()).filter(Boolean)
        .map(x => `<div class="center">${x}</div>`).join('')
    : '';
  const logoHtml = d.logo ? `<img class="logo" src="${escapeHtml(d.logo)}" alt="">` : '';
  // A restaurant calls its orders by number: it goes big, where the customer sees it first.
  const orderNoHtml = d.restaurant && d.orderNum
    ? `<div class="order-no"><div>ORDER NO.</div><div class="num">#${escapeHtml(d.orderNum)}</div></div>`
    : '';

  const commonCss = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:${font}; font-size:${s.fontSize}px; width:${bodyWidth}; padding:3mm; color:#000; background:#fff; }
  .center { text-align:center; }
  .bold   { font-weight:bold; }
  .large  { font-size:${s.fontSize + 4}px; font-weight:bold; }
  .divider { ${dvCss} }
  .solid   { border-top:2px solid #000; margin:4px 0; }
  .row { display:flex; justify-content:space-between; padding:1px 0; }
  .row .v { text-align:right; white-space:nowrap; }
  .item-code { color:#555; font-size:${s.fontSize - 1}px; }
  .item-name { font-weight:bold; padding:1px 0; }
  .item-detail { display:flex; justify-content:space-between; padding:1px 8px 3px; }
  .col-hdr { display:flex; justify-content:space-between; font-weight:bold; border-bottom:1px dashed #000; padding-bottom:2px; margin-bottom:2px; }
  .logo { display:block; max-width:70%; max-height:25mm; margin:0 auto 4px; }
  .order-no { text-align:center; font-weight:bold; border:2px solid #000; padding:2px 0 4px; margin:4px 0; }
  .order-no .num { font-size:${s.fontSize * 3}px; font-weight:900; line-height:1.1; }
  @media print { @page { margin:0; size:${pageSize}; } body { padding:1mm; } }`;

  // ── Fiscal layout (default) ──────────────────────────────────────────────
  if (s.layout === 'fiscal') {
    const itemRows = d.items.map(i => {
      const code = s.showItemCodes ? (i.barcode ?? i.sku ?? '') : '';
      return `${code ? `<div class="item-code">${code}</div>` : ''}
<div class="item-name">${i.name}</div>
<div class="item-detail"><span>${i.qty} X &nbsp;${fmt2(i.price * rateNum)}</span><span>${fmt2(i.total * rateNum)}</span></div>`;
    }).join('<div class="divider"></div>');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Receipt ${d.reference}</title>
<style>${commonCss}</style></head><body>
${logoHtml}
<div class="center bold">${s.headerTitle || '***FISCAL TAX INVOICE***'}</div>
<br>
<div class="center large">${d.storeName}</div>
${d.branchName && d.branchName !== d.storeName ? `<div class="center bold">${d.branchName}</div>` : ''}
${d.tradingName && d.tradingName !== d.storeName ? `<div class="center">T/A</div><div class="center bold">${d.tradingName}</div>` : ''}
${addrLines}
<div class="divider"></div>
${orderNoHtml}
${d.orderNum && !d.restaurant ? `<div class="bold">Order Num : ${d.orderNum}</div>` : ''}
<div>Tax Inv No : ${d.reference}</div>
${d.customerName ? `<div>Customer : ${d.customerName}</div>` : ''}
${d.covers ? `<div>Covers : ${d.covers}</div>` : ''}
${s.showCashierName ? `<div>Cashier : ${d.cashier}</div>` : ''}
${d.tableNumber ? `<div>Table : ${d.tableNumber}</div>` : ''}
<div class="row"><span>${dateStr}</span><span>${timeStr}</span></div>
${s.showVatNote ? '<div class="center">All Prices VAT Inclusive</div>' : ''}
${s.showOrderType && d.orderType ? `<br><div class="center bold">** ${orderTypeLabel(d.orderType)} **</div>` : ''}
<div class="divider"></div>
<div class="bold">DESCRIPTION</div>
<div class="col-hdr"><span>QTY</span><span>PRICE &nbsp; TOTAL</span></div>
${itemRows}
<div class="divider"></div>
${s.showVatBreakdown ? `
<div class="row"><span>Total Excl</span><span class="v">${fmt2(net)}</span></div>
<div class="row"><span>Output Tax (${pct}%)</span><span class="v">${fmt2(vat)}</span></div>
<div class="row bold"><span>Total Incl</span><span class="v">${fmt2(gross)}</span></div>
<div class="divider"></div>` : ''}
<div class="row bold"><span>TOTAL</span><span class="v">${fmt2(gross)}</span></div>
${d.amountTendered !== undefined ? `<div class="row"><span>TENDERED</span><span class="v">${fmt2(d.amountTendered)}</span></div>` : ''}
${d.change !== undefined && d.change >= 0 ? `<div class="row"><span>CHANGE</span><span class="v">${fmt2(d.change)}</span></div>` : ''}
<div class="row"><span>ITEMS</span><span class="v">${itemCount}</span></div>
<div class="bold">Payment</div>
<div class="divider"></div>
<div>${d.paymentMethod.replace(/_/g,' ').toUpperCase()} ${currCode}</div>
${d.amountTendered !== undefined ? `<div>${d.currency}${fmt2(d.amountTendered)} @ Rate ${d.currency}${rate}</div>` : ''}
<div class="divider"></div>
${d.storePhone ? `<div>Tel : ${d.storePhone}</div>` : ''}
${d.storeEmail ? `<div>Email : ${escapeHtml(d.storeEmail)}</div>` : ''}
${d.vatNumber ? `<div>VAT No : ${d.vatNumber}</div>` : ''}
${d.tinNumber ? `<div>TIN No : ${d.tinNumber}</div>` : ''}
${!isFiscalised(d) ? `
${d.deviceId ? `<div>Device Id : ${d.deviceId}</div>` : ''}
${d.recGn ? `<div>REC GN : ${d.recGn}</div>` : ''}
${d.rec68 ? `<div>REC 68 : ${d.rec68}</div>` : ''}
${d.fiscalDay ? `<div>Fiscal Day : ${d.fiscalDay}</div>` : ''}` : `
${d.fiscalDeviceId != null ? `<div>Device Id : ${d.fiscalDeviceId}</div>` : ''}
${d.fiscalDayNo != null ? `<div>Fiscal Day : ${d.fiscalDayNo}</div>` : ''}`}
<br>
<div class="center bold">FISCAL TAX INVOICE</div>
<div class="solid"></div>
${isFiscalised(d) ? `
${d.fiscalReceiptGlobalNo != null ? `<div class="center">Rec No : ${d.fiscalReceiptGlobalNo}</div>` : ''}
${qrImageDataUrl ? `<div class="center"><img src="${qrImageDataUrl}" width="130" height="130" alt="QR"></div>` : ''}
${d.fiscalVerificationCode ? `<div class="center">Verification code:</div><div class="center bold">${d.fiscalVerificationCode}</div>` : ''}
${d.fiscalQrCodeUrl ? `<div class="center" style="font-size:${9}px;word-break:break-all;">You can verify this receipt manually at<br>${d.fiscalQrCodeUrl.split('/').slice(0, 3).join('/')}/</div>` : ''}
<div class="solid"></div>` : ''}
<div class="center">${d.footer ?? 'Core POS'}</div>
</body></html>`;
  }

  // ── Simple layout ────────────────────────────────────────────────────────
  if (s.layout === 'simple') {
    const itemRows = d.items.map(i => {
      const code = s.showItemCodes ? (i.barcode ?? i.sku ?? '') : '';
      return `${code ? `<div class="item-code">${code}</div>` : ''}
<div class="row"><span>${i.name}</span><span class="v">${i.qty > 1 ? `${i.qty}x ` : ''}${fmt2(i.total * rateNum)}</span></div>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Receipt ${d.reference}</title>
<style>${commonCss}</style></head><body>
${logoHtml}
<div class="center large">${d.storeName}</div>
${addrLines}
${d.storePhone ? `<div class="center">${d.storePhone}</div>` : ''}
${d.storeEmail ? `<div class="center">${escapeHtml(d.storeEmail)}</div>` : ''}
${d.vatNumber ? `<div class="center">VAT No: ${d.vatNumber}</div>` : ''}
${d.tinNumber ? `<div class="center">TIN No: ${d.tinNumber}</div>` : ''}
<div class="divider"></div>
${orderNoHtml}
<div class="row"><span>Ref</span><span class="v">${d.reference}</span></div>
<div class="row"><span>Date</span><span class="v">${dateStr} ${timeStr}</span></div>
${s.showOrderType && d.orderType ? `<div class="center bold">${orderTypeLabel(d.orderType)}</div>` : ''}
<div class="divider"></div>
<div class="col-hdr"><span>Item</span><span>Total</span></div>
${itemRows}
<div class="divider"></div>
<div class="row"><span>Subtotal</span><span class="v">${fmt2(d.subtotal * rateNum)}</span></div>
${d.tax > 0 ? `<div class="row"><span>Tax</span><span class="v">${fmt2(d.tax * rateNum)}</span></div>` : ''}
${d.discount > 0 ? `<div class="row"><span>Discount</span><span class="v">-${fmt2(d.discount * rateNum)}</span></div>` : ''}
<div class="row bold"><span>TOTAL</span><span class="v">${d.currency}${fmt2(d.total * rateNum)}</span></div>
<div class="divider"></div>
<div>${d.paymentMethod.replace(/_/g,' ').toUpperCase()}</div>
${d.amountTendered !== undefined ? `<div class="row"><span>Cash</span><span class="v">${d.currency}${fmt2(d.amountTendered)}</span></div>` : ''}
${d.change !== undefined && d.change >= 0 ? `<div class="row"><span>Change</span><span class="v">${d.currency}${fmt2(d.change)}</span></div>` : ''}
${s.showCashierName ? `<div>Cashier: ${d.cashier}</div>` : ''}
<div class="divider"></div>
<div class="center">${d.footer ?? 'Thank you!'}</div>
</body></html>`;
  }

  // ── Minimal layout ───────────────────────────────────────────────────────
  const itemRows = d.items.map(i =>
    `<div class="row"><span>${i.qty > 1 ? `${i.qty}x ` : ''}${i.name}</span><span class="v">${fmt2(i.total * rateNum)}</span></div>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Receipt ${d.reference}</title>
<style>${commonCss}</style></head><body>
${logoHtml}
<div class="center bold">${d.storeName}</div>
<div class="center">${dateStr}</div>
${orderNoHtml}
<div class="divider"></div>
${itemRows}
<div class="divider"></div>
<div class="row bold"><span>TOTAL</span><span class="v">${d.currency}${fmt2(d.total * rateNum)}</span></div>
${d.amountTendered !== undefined ? `<div class="row"><span>Paid</span><span class="v">${d.currency}${fmt2(d.amountTendered)}</span></div>` : ''}
${d.change !== undefined && d.change >= 0 ? `<div class="row"><span>Change</span><span class="v">${d.currency}${fmt2(d.change)}</span></div>` : ''}
<div class="divider"></div>
<div class="center">${d.footer ?? 'Thank you!'}</div>
</body></html>`;
}

export async function browserPrintReceipt(d: ReceiptData): Promise<void> {
  // window.open() must run synchronously off the user gesture that triggered
  // printing, or popup blockers kill it — so open the (blank) window first,
  // then fill it in once the QR image is ready.
  const w = window.open('', '_blank', 'width=320,height=700,toolbar=0,scrollbars=1');
  if (!w) { alert('Allow popups to print receipts'); return; }
  if (d.fiscalPendingId) {
    w.document.write('<p style="font:14px sans-serif;padding:16px">Getting the ZIMRA verification code…</p>');
    d = await withFiscalResult(d);
    w.document.open();
  }
  const qrImageDataUrl = await renderFiscalQrDataUrl(d.fiscalQrCodeUrl);
  const html = buildReceiptHtml(d, undefined, qrImageDataUrl);
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 300);
}

// ---------------------------------------------------------------------------
// Label printer
// ---------------------------------------------------------------------------
export interface LabelData {
  name: string;
  sku?: string;
  barcode?: string;
  price: number;
  currency: string;
  widthMm: number;
  heightMm: number;
}

import JsBarcode from 'jsbarcode';

function barcodesvg(value: string): string {
  if (!value) return '';
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, value, { format: 'CODE128', width: 1.5, height: 40, displayValue: true, fontSize: 10, margin: 2 });
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return `<div style="font-family:monospace;font-size:10pt;word-break:break-all;">${value}</div>`;
  }
}

export function printLabel(d: LabelData): void {
  const barcodeSvgHtml = d.barcode ? barcodesvg(d.barcode) : '';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Label</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; }
  .label { width:${d.widthMm}mm; height:${d.heightMm}mm; border:1px solid #ccc; padding:2mm;
           display:flex; flex-direction:column; justify-content:space-between; }
  .name  { font-size:8pt; font-weight:bold; line-height:1.2; }
  .sku   { font-size:6pt; color:#555; }
  .price { font-size:12pt; font-weight:bold; text-align:right; }
  .barcode { text-align:center; }
  .barcode svg { max-width:100%; }
  @media print { @page { margin:0; size:${d.widthMm}mm ${d.heightMm}mm; } }
</style>
</head><body>
<div class="label">
  <div>
    <div class="name">${d.name}</div>
    ${d.sku ? `<div class="sku">${d.sku}</div>` : ''}
  </div>
  ${barcodeSvgHtml ? `<div class="barcode">${barcodeSvgHtml}</div>` : ''}
  <div class="price">${d.currency}${Number(d.price).toFixed(2)}</div>
</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=400,height=300,toolbar=0');
  if (!w) { alert('Allow popups to print labels'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 600);
}
