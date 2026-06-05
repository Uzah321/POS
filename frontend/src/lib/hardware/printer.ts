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

const ESC_INIT        = bytes(ESC, 0x40);           // Initialize printer
const ESC_ALIGN_LEFT  = bytes(ESC, 0x61, 0x00);
const ESC_ALIGN_CENTER= bytes(ESC, 0x61, 0x01);
const ESC_ALIGN_RIGHT = bytes(ESC, 0x61, 0x02);
const ESC_BOLD_ON     = bytes(ESC, 0x45, 0x01);
const ESC_BOLD_OFF    = bytes(ESC, 0x45, 0x00);
const ESC_DWIDTH_ON   = bytes(GS,  0x21, 0x11);     // Double width+height
const ESC_DWIDTH_OFF  = bytes(GS,  0x21, 0x00);
const ESC_CUT         = bytes(GS,  0x56, 0x42, 0x00); // Partial cut
const CASH_DRAWER     = bytes(ESC, 0x70, 0x00, 0x19, 0x78); // Open cash drawer pin 2

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
}

// ---------------------------------------------------------------------------
// ESC/POS receipt builder
// ---------------------------------------------------------------------------
function buildEscPosReceipt(d: ReceiptData): Uint8Array {
  const fmt = (n: number) => `${d.currency}${n.toFixed(2)}`;
  const pad = (l: string, r: string, w = 32) => {
    const gap = w - l.length - r.length;
    return l + ' '.repeat(Math.max(1, gap)) + r;
  };

  const parts: Uint8Array[] = [
    ESC_INIT,
    ESC_ALIGN_CENTER,
    ESC_DWIDTH_ON,
    line(d.storeName),
    ESC_DWIDTH_OFF,
  ];

  if (d.storeAddress) parts.push(line(d.storeAddress));
  if (d.storePhone)   parts.push(line(d.storePhone));
  parts.push(
    bytes(LF),
    ESC_ALIGN_LEFT,
    line(`Receipt: ${d.reference}`),
    line(`Cashier: ${d.cashier}`),
    line(`Date:    ${d.date}`),
    divider(),
  );

  for (const item of d.items) {
    parts.push(line(`${item.name} x${item.qty}`));
    parts.push(ESC_ALIGN_RIGHT, line(fmt(item.total)), ESC_ALIGN_LEFT);
  }

  parts.push(
    divider(),
    line(pad('Subtotal', fmt(d.subtotal))),
  );
  if (d.discount > 0) parts.push(line(pad('Discount', `-${fmt(d.discount)}`)));
  if (d.tax > 0)      parts.push(line(pad('Tax', fmt(d.tax))));
  parts.push(
    ESC_BOLD_ON,
    line(pad('TOTAL', fmt(d.total))),
    ESC_BOLD_OFF,
    divider(),
    line(pad('Payment', d.paymentMethod.replace('_', ' ').toUpperCase())),
  );
  if (d.amountTendered !== undefined) parts.push(line(pad('Tendered', fmt(d.amountTendered))));
  if (d.change !== undefined && d.change >= 0) parts.push(line(pad('Change', fmt(d.change))));

  parts.push(
    bytes(LF),
    ESC_ALIGN_CENTER,
    line(d.footer ?? 'Thank you for your purchase!'),
    bytes(LF, LF, LF),
    ESC_CUT,
  );

  return concat(...parts);
}

// ---------------------------------------------------------------------------
// WebUSB printer connection
// ---------------------------------------------------------------------------
let usbDevice: USBDevice | null = null;
let usbInterface = 0;
let usbEndpoint = 1;

export async function connectUsbPrinter(): Promise<{ name: string; vendorId: number; productId: number }> {
  if (!('usb' in navigator)) throw new Error('WebUSB not supported in this browser');
  const device = await (navigator as any).usb.requestDevice({ filters: [] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);

  // Find the first bulk-OUT endpoint
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
// Open cash drawer (via ESC/POS kick command)
// ---------------------------------------------------------------------------
export async function openCashDrawer(): Promise<void> {
  if (usbDevice) {
    await sendToUsb(CASH_DRAWER);
  }
  // browser-print mode: no physical signal possible
}

// ---------------------------------------------------------------------------
// Print receipt
// ---------------------------------------------------------------------------
export async function printReceipt(data: ReceiptData, mode: 'browser' | 'webusb' = 'browser'): Promise<void> {
  if (mode === 'webusb' && usbDevice) {
    await sendToUsb(buildEscPosReceipt(data));
    return;
  }
  // Fallback: browser print
  browserPrintReceipt(data);
}

// ---------------------------------------------------------------------------
// Browser print (opens a styled receipt in a popup window)
// ---------------------------------------------------------------------------
export function browserPrintReceipt(d: ReceiptData): void {
  const fmt = (n: number) => `${d.currency}${Number(n).toFixed(2)}`;

  const itemRows = d.items
    .map(
      (i) =>
        `<tr><td>${i.name} <span class="qty">x${i.qty}</span></td><td class="right">${fmt(i.total)}</td></tr>`
    )
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Receipt ${d.reference}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New',monospace; font-size:12px; width:80mm; padding:4mm; color:#000; }
  h1 { font-size:16px; text-align:center; margin-bottom:2px; }
  .center { text-align:center; }
  .divider { border-top:1px dashed #000; margin:4px 0; }
  table { width:100%; border-collapse:collapse; }
  td { padding:1px 0; vertical-align:top; }
  td.right { text-align:right; white-space:nowrap; padding-left:4px; }
  .qty { color:#555; font-size:10px; }
  .total-row td { font-weight:bold; border-top:1px solid #000; padding-top:2px; }
  .footer { text-align:center; margin-top:6px; font-size:11px; }
  @media print {
    @page { margin:0; size:80mm auto; }
    body { padding:2mm; }
  }
</style></head><body>
<h1>${d.storeName}</h1>
${d.storeAddress ? `<p class="center">${d.storeAddress}</p>` : ''}
${d.storePhone   ? `<p class="center">${d.storePhone}</p>`   : ''}
<div class="divider"></div>
<table>
  <tr><td>Receipt</td><td class="right">${d.reference}</td></tr>
  <tr><td>Cashier</td><td class="right">${d.cashier}</td></tr>
  <tr><td>Date</td><td class="right">${d.date}</td></tr>
</table>
<div class="divider"></div>
<table>${itemRows}</table>
<div class="divider"></div>
<table>
  <tr><td>Subtotal</td><td class="right">${fmt(d.subtotal)}</td></tr>
  ${d.discount > 0 ? `<tr><td>Discount</td><td class="right">-${fmt(d.discount)}</td></tr>` : ''}
  ${d.tax > 0      ? `<tr><td>Tax</td><td class="right">${fmt(d.tax)}</td></tr>`             : ''}
  <tr class="total-row"><td>TOTAL</td><td class="right">${fmt(d.total)}</td></tr>
  <tr><td>Payment</td><td class="right">${d.paymentMethod.replace('_',' ').toUpperCase()}</td></tr>
  ${d.amountTendered !== undefined ? `<tr><td>Tendered</td><td class="right">${fmt(d.amountTendered)}</td></tr>` : ''}
  ${d.change !== undefined && d.change >= 0 ? `<tr><td>Change</td><td class="right">${fmt(d.change)}</td></tr>` : ''}
</table>
<p class="footer">${d.footer ?? 'Thank you for your purchase!'}</p>
</body></html>`;

  const w = window.open('', '_blank', 'width=320,height=600,toolbar=0,scrollbars=1');
  if (!w) { alert('Allow popups to print receipts'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 300);
}

// ---------------------------------------------------------------------------
// Label printer (browser print with label CSS)
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

export function printLabel(d: LabelData): void {
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
  .barcode { font-family:'Libre Barcode 128',monospace; font-size:28pt; text-align:center;
             letter-spacing:0; line-height:1; }
  @media print { @page { margin:0; size:${d.widthMm}mm ${d.heightMm}mm; } }
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
</head><body>
<div class="label">
  <div>
    <div class="name">${d.name}</div>
    ${d.sku ? `<div class="sku">${d.sku}</div>` : ''}
  </div>
  ${d.barcode ? `<div class="barcode">${d.barcode}</div>` : ''}
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
