/**
 * Thermal Printer Service
 * Supports two modes:
 *  1. browser  — opens window.print() with receipt-formatted CSS (works with ANY printer)
 *  2. webusb   — sends raw ESC/POS bytes directly to a USB thermal printer (no dialog, instant)
 */

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
const ESC_CUT         = bytes(GS,  0x56, 0x42, 0x00);
const CASH_DRAWER     = bytes(ESC, 0x70, 0x00, 0x19, 0x78);

function line(s = ''): Uint8Array { return concat(text(s), bytes(LF)); }
function divider(char = '-', len = 32): Uint8Array { return line(char.repeat(len)); }

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
  // Fiscal invoice extras
  vatNumber?: string;
  tinNumber?: string;
  vatRate?: number;
  tradingName?: string;
  posNumber?: string;
  currencyCode?: string;
  currencyRate?: number;
  orderType?: 'sit_in' | 'takeaway';
}

export type ReceiptPrintMode = 'browser' | 'webusb' | 'none';

export interface BuildReceiptOptions {
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  cashier?: string;
  currency?: string;
  paymentMethod?: string;
  amountTendered?: number;
  change?: number;
  footer?: string;
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
  orderType?: 'sit_in' | 'takeaway';
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

export function resolveReceiptPrintMode(mode: ReceiptPrintMode): 'browser' | 'webusb' {
  return mode === 'webusb' ? 'webusb' : 'browser';
}

export function buildReceiptDataFromSale(sale: any, options: BuildReceiptOptions = {}): ReceiptData {
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
    storeName: options.storeName ?? sale?.branch?.name ?? 'Core',
    storeAddress: sale?.branch?.address ?? options.storeAddress,
    storePhone: sale?.branch?.phone ?? options.storePhone,
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
    footer: options.footer,
    vatNumber: options.vatNumber,
    tinNumber: options.tinNumber,
    vatRate: options.vatRate,
    tradingName: options.tradingName,
    posNumber: options.posNumber,
    currencyCode: options.currencyCode,
    currencyRate: options.currencyRate ?? 1,
    orderType: options.orderType,
  };
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

function vatInfo(d: ReceiptData): { net: number; vat: number; gross: number; pct: string } {
  const gross = d.total;
  const vat   = d.tax;
  const net   = d.subtotal > 0 ? d.subtotal : gross - vat;
  const pct   = d.vatRate != null
    ? d.vatRate.toFixed(1)
    : (net > 0 && vat > 0 ? ((vat / net) * 100).toFixed(1) : '0.0');
  return { net, vat, gross, pct };
}

// ---------------------------------------------------------------------------
// ESC/POS receipt builder
// ---------------------------------------------------------------------------
function buildEscPosReceipt(d: ReceiptData): Uint8Array {
  const W = 32;
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
  const rate = Number(d.currencyRate ?? 1).toFixed(6);

  const parts: Uint8Array[] = [
    ESC_INIT,
    ESC_ALIGN_CENTER,
    ESC_BOLD_ON, line('***FISCAL TAX INVOICE***'), ESC_BOLD_OFF,
    bytes(LF),
    ESC_DWIDTH_ON, line(cut(d.storeName, 16)), ESC_DWIDTH_OFF,
  ];

  if (d.tradingName && d.tradingName !== d.storeName) {
    parts.push(line('T/A'), ESC_BOLD_ON, line(cut(d.tradingName, W)), ESC_BOLD_OFF);
  }
  if (d.storeAddress) {
    for (const seg of d.storeAddress.split(/[,\n]/).map(s => s.trim()).filter(Boolean)) {
      parts.push(line(cut(seg, W)));
    }
  }

  parts.push(ESC_ALIGN_LEFT);
  if (d.tinNumber)  parts.push(line(`TIN ${d.tinNumber}`));
  if (d.vatNumber)  parts.push(line(`VAT No ${d.vatNumber}`));
  if (d.storePhone) parts.push(line(`CELL: ${d.storePhone}`));
  parts.push(line(`Currency ${currCode || d.currency}`));
  parts.push(divider());

  parts.push(ESC_BOLD_ON, line(pad(`ORDER NUMBER: ${d.reference}`, `POS ${d.posNumber ?? '1'}`)), ESC_BOLD_OFF);
  parts.push(line(pad(`Doc No ${d.reference}`, timeStr)));
  parts.push(ESC_ALIGN_CENTER, line(dateStr), line('All Prices VAT Inclusive'));
  if (d.orderType) {
    const label = d.orderType === 'takeaway' ? '** TAKEAWAY **' : '** SIT-IN **';
    parts.push(bytes(LF), ESC_BOLD_ON, line(label), ESC_BOLD_OFF);
  }
  parts.push(ESC_ALIGN_LEFT);
  parts.push(divider());

  parts.push(ESC_BOLD_ON, line('DESCRIPTION'), ESC_BOLD_OFF);
  parts.push(line(pad('QTY', 'PRICE  TOTAL COST')));
  parts.push(divider());

  for (const item of d.items) {
    const code = item.barcode ?? item.sku ?? '';
    if (code) parts.push(line(cut(code, W)));
    parts.push(line(cut(item.name, W)));
    parts.push(line(pad(`  ${item.qty} X  ${fmt2(item.price)}`, fmt2(item.total))));
  }
  parts.push(divider());

  parts.push(
    line(pad('Net Amount', fmt2(net))),
    line(pad(`VAT (VT ${pct}%)`, fmt2(vat))),
    ESC_BOLD_ON, line(pad('Gross Amount (VT)', fmt2(gross))), ESC_BOLD_OFF,
    divider(),
    ESC_BOLD_ON, line(pad('TOTAL', fmt2(gross))), ESC_BOLD_OFF,
  );
  if (d.amountTendered !== undefined) parts.push(line(pad('TENDERED', fmt2(d.amountTendered))));
  if (d.change !== undefined && d.change >= 0) parts.push(line(pad('CHANGE', fmt2(d.change))));
  parts.push(line(pad('ITEM#', String(itemCount))));

  parts.push(ESC_BOLD_ON, line('Payment Summary'), ESC_BOLD_OFF, divider());
  parts.push(line(`${d.paymentMethod.replace('_', ' ').toUpperCase()} ${currCode}`));
  if (d.amountTendered !== undefined) {
    parts.push(line(`${d.currency}${fmt2(d.amountTendered)} @ Rate ${d.currency}${rate}`));
  }
  parts.push(line(`CASHIER: ${d.cashier}`));

  parts.push(
    bytes(LF),
    ESC_ALIGN_CENTER,
    ESC_BOLD_ON, line('FISCAL TAX INVOICE'), ESC_BOLD_OFF,
    divider('='),
    line(d.footer ?? 'Core POS'),
    bytes(LF, LF, LF),
    ESC_CUT,
  );

  return concat(...parts);
}

// ---------------------------------------------------------------------------
// WebUSB printer connection
// ---------------------------------------------------------------------------
let usbDevice: any = null;
let usbInterface = 0;
let usbEndpoint = 1;

export async function connectUsbPrinter(): Promise<{ name: string; vendorId: number; productId: number }> {
  if (!('usb' in navigator)) throw new Error('WebUSB not supported in this browser');
  const device = await (navigator as any).usb.requestDevice({ filters: [] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);

  for (const iface of device.configuration!.interfaces) {
    for (const alt of iface.alternates) {
      for (const ep of alt.endpoints) {
        if (ep.direction === 'out' && ep.type === 'bulk') {
          usbInterface = iface.interfaceNumber;
          usbEndpoint  = ep.endpointNumber;
        }
      }
    }
  }

  await device.claimInterface(usbInterface);
  usbDevice = device;
  return { name: device.productName ?? 'USB Printer', vendorId: device.vendorId, productId: device.productId };
}

export async function disconnectUsbPrinter(): Promise<void> {
  if (usbDevice) {
    try { await usbDevice.releaseInterface(usbInterface); } catch {}
    try { await usbDevice.close(); } catch {}
    usbDevice = null;
  }
}

async function sendToUsb(data: Uint8Array): Promise<void> {
  if (!usbDevice) throw new Error('No USB printer connected');
  await usbDevice.transferOut(usbEndpoint, data);
}

// ---------------------------------------------------------------------------
// Open cash drawer
// ---------------------------------------------------------------------------
export async function openCashDrawer(): Promise<void> {
  if (usbDevice) await sendToUsb(CASH_DRAWER);
}

// ---------------------------------------------------------------------------
// Print receipt
// ---------------------------------------------------------------------------
export async function printReceipt(data: ReceiptData, mode: 'browser' | 'webusb' = 'browser'): Promise<void> {
  if (mode === 'webusb' && usbDevice) {
    await sendToUsb(buildEscPosReceipt(data));
    return;
  }
  browserPrintReceipt(data);
}

// ---------------------------------------------------------------------------
// Browser print — layout driven by ReceiptSettings
// ---------------------------------------------------------------------------
import { loadReceiptSettings, FONT_FAMILY_MAP, type ReceiptSettings } from '../receiptSettings';

function dividerCss(style: ReceiptSettings['dividerStyle']): string {
  if (style === 'solid')  return 'border-top:1px solid #000; margin:4px 0;';
  if (style === 'double') return 'border-top:3px double #000; margin:4px 0;';
  return 'border-top:1px dashed #000; margin:4px 0;';
}

export function buildReceiptHtml(d: ReceiptData, settings?: Partial<ReceiptSettings>): string {
  const s: ReceiptSettings = { ...loadReceiptSettings(), ...settings };
  const { dateStr, timeStr } = parseReceiptDate(d);
  const { net, vat, gross, pct } = vatInfo(d);
  const fmt2 = (n: number) => Number(n).toFixed(2);
  const itemCount = d.items.reduce((sum, i) => sum + i.qty, 0);
  const currCode = d.currencyCode ?? '';
  const rate = Number(d.currencyRate ?? 1).toFixed(6);
  const font = FONT_FAMILY_MAP[s.fontFamily] ?? FONT_FAMILY_MAP.courier;
  const pageSize = s.paperWidth === 'a4' ? 'A4' : `${s.paperWidth} auto`;
  const bodyWidth = s.paperWidth === 'a4' ? '190mm' : s.paperWidth;
  const dvCss = dividerCss(s.dividerStyle);

  const addrLines = d.storeAddress
    ? d.storeAddress.split(/[,\n]/).map(x => x.trim()).filter(Boolean)
        .map(x => `<div class="center">${x}</div>`).join('')
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
  @media print { @page { margin:0; size:${pageSize}; } body { padding:1mm; } }`;

  // ── Fiscal layout (default) ──────────────────────────────────────────────
  if (s.layout === 'fiscal') {
    const itemRows = d.items.map(i => {
      const code = s.showItemCodes ? (i.barcode ?? i.sku ?? '') : '';
      return `${code ? `<div class="item-code">${code}</div>` : ''}
<div class="item-name">${i.name}</div>
<div class="item-detail"><span>${i.qty} X &nbsp;${fmt2(i.price)}</span><span>${fmt2(i.total)}</span></div>`;
    }).join('<div class="divider"></div>');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Receipt ${d.reference}</title>
<style>${commonCss}</style></head><body>
<div class="center bold">${s.headerTitle || '***FISCAL TAX INVOICE***'}</div>
<br>
<div class="center large">${d.storeName}</div>
${d.tradingName && d.tradingName !== d.storeName ? `<div class="center">T/A</div><div class="center bold">${d.tradingName}</div>` : ''}
${addrLines}
${d.tinNumber ? `<div>TIN ${d.tinNumber}</div>` : ''}
${d.vatNumber ? `<div>VAT No ${d.vatNumber}</div>` : ''}
${d.storePhone ? `<div>CELL: ${d.storePhone}</div>` : ''}
<div>Currency ${currCode || d.currency}</div>
<div class="divider"></div>
<div class="row"><span class="bold">ORDER: ${d.reference}</span><span>POS ${d.posNumber ?? '1'}</span></div>
<div class="row"><span>Doc ${d.reference}</span><span>${timeStr}</span></div>
<div class="center">${dateStr}</div>
${s.showVatNote ? '<div class="center">All Prices VAT Inclusive</div>' : ''}
${s.showOrderType && d.orderType ? `<br><div class="center bold">${d.orderType === 'takeaway' ? '** TAKEAWAY **' : '** SIT-IN **'}</div>` : ''}
<div class="divider"></div>
<div class="bold">DESCRIPTION</div>
<div class="col-hdr"><span>QTY</span><span>PRICE &nbsp; TOTAL</span></div>
${itemRows}
<div class="divider"></div>
${s.showVatBreakdown ? `
<div class="row"><span>Net Amount</span><span class="v">${fmt2(net)}</span></div>
<div class="row"><span>VAT (${pct}%)</span><span class="v">${fmt2(vat)}</span></div>
<div class="row bold"><span>Gross (VT)</span><span class="v">${fmt2(gross)}</span></div>
<div class="divider"></div>` : ''}
<div class="row bold"><span>TOTAL</span><span class="v">${fmt2(gross)}</span></div>
${d.amountTendered !== undefined ? `<div class="row"><span>TENDERED</span><span class="v">${fmt2(d.amountTendered)}</span></div>` : ''}
${d.change !== undefined && d.change >= 0 ? `<div class="row"><span>CHANGE</span><span class="v">${fmt2(d.change)}</span></div>` : ''}
<div class="row"><span>ITEMS</span><span class="v">${itemCount}</span></div>
<div class="bold">Payment</div>
<div class="divider"></div>
<div>${d.paymentMethod.replace(/_/g,' ').toUpperCase()} ${currCode}</div>
${d.amountTendered !== undefined ? `<div>${d.currency}${fmt2(d.amountTendered)} @ Rate ${d.currency}${rate}</div>` : ''}
${s.showCashierName ? `<div>CASHIER: ${d.cashier}</div>` : ''}
<br>
<div class="center bold">FISCAL TAX INVOICE</div>
<div class="solid"></div>
<div class="center">${d.footer ?? 'Core POS'}</div>
</body></html>`;
  }

  // ── Simple layout ────────────────────────────────────────────────────────
  if (s.layout === 'simple') {
    const itemRows = d.items.map(i => {
      const code = s.showItemCodes ? (i.barcode ?? i.sku ?? '') : '';
      return `${code ? `<div class="item-code">${code}</div>` : ''}
<div class="row"><span>${i.name}</span><span class="v">${i.qty > 1 ? `${i.qty}x ` : ''}${fmt2(i.total)}</span></div>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Receipt ${d.reference}</title>
<style>${commonCss}</style></head><body>
<div class="center large">${d.storeName}</div>
${addrLines}
${d.storePhone ? `<div class="center">${d.storePhone}</div>` : ''}
<div class="divider"></div>
<div class="row"><span>Ref</span><span class="v">${d.reference}</span></div>
<div class="row"><span>Date</span><span class="v">${dateStr} ${timeStr}</span></div>
${s.showOrderType && d.orderType ? `<div class="center bold">${d.orderType === 'takeaway' ? 'TAKEAWAY' : 'SIT-IN'}</div>` : ''}
<div class="divider"></div>
<div class="col-hdr"><span>Item</span><span>Total</span></div>
${itemRows}
<div class="divider"></div>
<div class="row"><span>Subtotal</span><span class="v">${fmt2(d.subtotal)}</span></div>
${d.tax > 0 ? `<div class="row"><span>Tax</span><span class="v">${fmt2(d.tax)}</span></div>` : ''}
${d.discount > 0 ? `<div class="row"><span>Discount</span><span class="v">-${fmt2(d.discount)}</span></div>` : ''}
<div class="row bold"><span>TOTAL</span><span class="v">${d.currency}${fmt2(d.total)}</span></div>
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
    `<div class="row"><span>${i.qty > 1 ? `${i.qty}x ` : ''}${i.name}</span><span class="v">${fmt2(i.total)}</span></div>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Receipt ${d.reference}</title>
<style>${commonCss}</style></head><body>
<div class="center bold">${d.storeName}</div>
<div class="center">${dateStr}</div>
<div class="divider"></div>
${itemRows}
<div class="divider"></div>
<div class="row bold"><span>TOTAL</span><span class="v">${d.currency}${fmt2(d.total)}</span></div>
${d.amountTendered !== undefined ? `<div class="row"><span>Paid</span><span class="v">${d.currency}${fmt2(d.amountTendered)}</span></div>` : ''}
${d.change !== undefined && d.change >= 0 ? `<div class="row"><span>Change</span><span class="v">${d.currency}${fmt2(d.change)}</span></div>` : ''}
<div class="divider"></div>
<div class="center">${d.footer ?? 'Thank you!'}</div>
</body></html>`;
}

export function browserPrintReceipt(d: ReceiptData): void {
  const html = buildReceiptHtml(d);
  const w = window.open('', '_blank', 'width=320,height=700,toolbar=0,scrollbars=1');
  if (!w) { alert('Allow popups to print receipts'); return; }
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
