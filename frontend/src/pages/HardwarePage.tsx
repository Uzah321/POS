import { useEffect, useState } from 'react';
import { useHardwareStore } from '../stores/hardwareStore';
import {
  Printer, ScanBarcode, DollarSign, Monitor, Scale, Tag, CreditCard, Touchpad,
  Wifi, WifiOff, CheckCircle, AlertTriangle, Settings2, Usb, Globe, ChevronRight, ChefHat
} from 'lucide-react';
import {
  connectUsbPrinter, disconnectUsbPrinter, printLabel, printReceipt,
  openCashDrawer, resolveReceiptPrintMode
} from '../lib/hardware/printer';
import {
  openCustomerDisplay, closeCustomerDisplay, broadcastCart
} from '../lib/hardware/customerDisplay';
import { useWeighingScale } from '../lib/hardware/scale';
import { simulateCardPayment } from '../lib/hardware/cardMachine';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import toast from 'react-hot-toast';
import {
  type ReceiptSettings,
  FONT_FAMILY_MAP,
  loadReceiptSettings,
  saveReceiptSettings,
} from '../lib/receiptSettings';
import {
  type KdsSettings,
  loadKdsSettings,
  saveKdsSettings,
} from '../lib/kdsSettings';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
const TABS = [
  { id: 'printer',   label: 'Receipt Printer',   icon: Printer    },
  { id: 'scanner',   label: 'Barcode Scanner',   icon: ScanBarcode },
  { id: 'drawer',    label: 'Cash Drawer',       icon: DollarSign  },
  { id: 'display',   label: 'Customer Display',  icon: Monitor     },
  { id: 'scale',     label: 'Weighing Scale',    icon: Scale       },
  { id: 'label',     label: 'Label Printer',     icon: Tag         },
  { id: 'card',      label: 'Card Machine',      icon: CreditCard  },
  { id: 'touch',     label: 'Touchscreen',       icon: Touchpad    },
  { id: 'kds',       label: 'KDS / Queue',       icon: ChefHat     },
];

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
      {ok ? <CheckCircle size={12} /> : <WifiOff size={12} />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Toggle row
// ---------------------------------------------------------------------------
function ToggleRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-50 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------
function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
      {title && <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function HardwarePage() {
  const hw = useHardwareStore();
  const { user } = useAuthStore();
  const { activeCurrency } = useCurrencyStore();
  const [tab, setTab] = useState('printer');

  const [receipt, setReceiptRaw] = useState<ReceiptSettings>(() => loadReceiptSettings());
  const setR = <K extends keyof ReceiptSettings>(key: K, val: ReceiptSettings[K]) =>
    setReceiptRaw(r => { const n = { ...r, [key]: val }; saveReceiptSettings(n); return n; });

  const [kds, setKdsRaw] = useState<KdsSettings>(() => loadKdsSettings());
  const setK = <K extends keyof KdsSettings>(key: K, val: KdsSettings[K]) =>
    setKdsRaw(k => { const n = { ...k, [key]: val }; saveKdsSettings(n); return n; });

  // Scale hook
  const scale = useWeighingScale(hw.scaleBaudRate);

  // USB printer connection state
  const [usbConnected, setUsbConnected] = useState(false);

  const currency = activeCurrency?.symbol ?? '$';

  useEffect(() => {
    if (hw.printerMode === 'none') {
      hw.update({ printerMode: 'browser' });
    }
  }, [hw]);

  // ----------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------
  const handleConnectUsb = async () => {
    try {
      const info = await connectUsbPrinter();
      hw.update({ printerMode: 'webusb', printerName: info.name, printerVendorId: info.vendorId, printerProductId: info.productId });
      setUsbConnected(true);
      toast.success(`Connected: ${info.name}`);
    } catch (e: any) {
      toast.error(e.message ?? 'Could not connect printer');
    }
  };

  const handleDisconnectUsb = async () => {
    await disconnectUsbPrinter();
    setUsbConnected(false);
    hw.update({ printerMode: 'browser', printerName: '' });
    toast.success('Printer disconnected');
  };

  const handleTestPrint = () => {
    void printReceipt({
      storeName: 'Core',
      storeAddress: '123 Main Street',
      storePhone: '+27 11 000 0000',
      reference: 'TEST-001',
      cashier: user?.name ?? 'Cashier',
      date: new Date().toLocaleString(),
      items: [
        { name: 'Test Item A', qty: 2, price: 10.00, total: 20.00 },
        { name: 'Test Item B', qty: 1, price: 15.50, total: 15.50 },
      ],
      subtotal: 35.50,
      tax: 4.97,
      discount: 0,
      total: 40.47,
      paymentMethod: 'cash',
      amountTendered: 50,
      change: 9.53,
      currency,
      footer: '*** TEST RECEIPT - NOT A VALID RECEIPT ***',
    }, resolveReceiptPrintMode(hw.printerMode)).catch((error: any) => {
      toast.error(error?.message ?? 'Could not print test receipt');
    });
  };

  const handleTestDrawer = async () => {
    try {
      await openCashDrawer();
      toast.success('Cash drawer opened');
    } catch (e: any) {
      toast.error(e.message ?? 'Could not open drawer');
    }
  };

  const handleOpenDisplay = () => {
    openCustomerDisplay();
    toast.success('Customer display opened');
  };

  const handleTestDisplay = () => {
    broadcastCart({
      type: 'cart',
      storeName: 'Core',
      currency,
      items: [
        { name: 'Test Item A', qty: 2, price: 10, total: 20 },
        { name: 'Test Item B', qty: 1, price: 15.5, total: 15.5 },
      ],
      subtotal: 35.5, tax: 4.97, discount: 0, total: 40.47,
    });
    toast.success('Test data sent to display');
  };

  const handleTestLabel = () => {
    printLabel({
      name: 'Sample Product',
      sku: 'SKU-001',
      barcode: '5901234123457',
      price: 29.99,
      currency,
      widthMm: hw.labelWidth,
      heightMm: hw.labelHeight,
    });
  };

  const handleTestCard = async () => {
    const loadingToast = toast.loading('Simulating card payment-');
    const result = await simulateCardPayment({ amount: 100, currency: 'ZAR', reference: 'TEST-001' });
    toast.dismiss(loadingToast);
    if (result.success) toast.success(`Approved: ${result.reference}`);
    else toast.error(result.message ?? 'Declined');
  };

  // ----------------------------------------------------------
  // Tab content
  // ----------------------------------------------------------
  const renderTab = () => {
    switch (tab) {
      // ---- Receipt Printer -----------------------------------
      case 'printer': return (
        <div className="space-y-4">
          <Card title="Printer Mode">
            <div className="space-y-2">
              {(['browser', 'webusb'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-3 p-3 rounded-md border border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <input type="radio" name="printerMode" value={mode} checked={hw.printerMode === mode}
                    onChange={() => hw.update({ printerMode: mode })} className="accent-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {mode === 'browser' ? 'System / Bluetooth Print (recommended)' : 'Direct USB / ESC-POS'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {mode === 'browser'
                        ? 'Uses the Windows print dialog, so paired Bluetooth receipt printers work without extra drivers in the app'
                        : 'Prints instantly without a dialog (Chrome/Edge only, requires USB thermal printer)'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          {hw.printerMode === 'browser' && (
            <Card title="Bluetooth Printer Setup">
              <div className="space-y-2 text-sm text-gray-600">
                <p>Pair the thermal printer in Windows Bluetooth settings first, then choose that printer in the print dialog when you print a test receipt or complete a sale.</p>
                <p className="text-xs text-gray-400">This is the most reliable path for Bluetooth receipt printers because the browser prints through the operating system printer list.</p>
              </div>
            </Card>
          )}

          {hw.printerMode === 'webusb' && (
            <Card title="USB Printer">
              <div className="flex items-center gap-3 flex-wrap">
                <Status ok={usbConnected} label={usbConnected ? (hw.printerName || 'Connected') : 'Not connected'} />
                {!usbConnected
                  ? <button onClick={handleConnectUsb} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><Usb size={14} />Connect Printer</button>
                  : <button onClick={handleDisconnectUsb} className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200">Disconnect</button>}
              </div>
              <p className="text-xs text-gray-400 mt-3">Plug in your thermal printer, then click Connect. Chrome/Edge will show a USB device picker.</p>
            </Card>
          )}

          <Card title="Settings">
            <p className="text-sm text-gray-600">Every completed order now triggers a receipt print. Use the mode above to choose Bluetooth/system printing or direct USB printing.</p>
          </Card>

          <Card title="Test">
            <button onClick={handleTestPrint} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">
              <Printer size={14} />Print Test Receipt
            </button>
          </Card>

          {/* ── Receipt Design ─────────────────────────────────── */}
          <div className="pt-2">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">Receipt Design</p>
            <div className="space-y-4">

              <Card title="Layout">
                <div className="flex gap-2 mb-2">
                  {(['fiscal', 'simple', 'minimal'] as const).map(l => (
                    <button key={l} type="button" onClick={() => setR('layout', l)}
                      className={`flex-1 py-2 rounded-md border text-sm font-medium capitalize transition-colors ${receipt.layout === l ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400">
                  {receipt.layout === 'fiscal'  && 'Full fiscal tax invoice with VAT breakdown, item codes, and payment summary.'}
                  {receipt.layout === 'simple'  && 'Store name, items with qty and price, subtotals, cashier name.'}
                  {receipt.layout === 'minimal' && 'Bare minimum: store name, item totals, grand total, payment method.'}
                </p>
              </Card>

              <Card title="Font & Paper">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Font Family</label>
                    <select value={receipt.fontFamily} onChange={e => setR('fontFamily', e.target.value as ReceiptSettings['fontFamily'])}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      <option value="courier">Courier New</option>
                      <option value="arial">Arial</option>
                      <option value="verdana">Verdana</option>
                      <option value="georgia">Georgia</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Font Size</label>
                    <select value={receipt.fontSize} onChange={e => setR('fontSize', Number(e.target.value) as ReceiptSettings['fontSize'])}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      {([10, 11, 12, 13, 14] as const).map(s => <option key={s} value={s}>{s}px</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Paper Width</label>
                    <select value={receipt.paperWidth} onChange={e => setR('paperWidth', e.target.value as ReceiptSettings['paperWidth'])}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      <option value="58mm">58 mm (small)</option>
                      <option value="80mm">80 mm (standard)</option>
                      <option value="a4">A4</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Divider Style</label>
                    <select value={receipt.dividerStyle} onChange={e => setR('dividerStyle', e.target.value as ReceiptSettings['dividerStyle'])}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      <option value="dashed">Dashed</option>
                      <option value="solid">Solid</option>
                      <option value="double">Double</option>
                    </select>
                  </div>
                </div>
                {receipt.layout === 'fiscal' && (
                  <div className="mt-3">
                    <label className="text-xs text-gray-500 block mb-1">Header Title</label>
                    <input value={receipt.headerTitle} onChange={e => setR('headerTitle', e.target.value)}
                      placeholder="***FISCAL TAX INVOICE***"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                )}
              </Card>

              <Card title="Show / Hide Sections">
                {[
                  { key: 'showCashierName',  label: 'Cashier name',                      hide: false },
                  { key: 'showOrderType',    label: 'Order type (Sit-in / Takeaway)',     hide: false },
                  { key: 'showVatBreakdown', label: 'VAT breakdown',                      hide: receipt.layout === 'minimal' },
                  { key: 'showVatNote',      label: '"All Prices VAT Inclusive" note',    hide: receipt.layout !== 'fiscal' },
                  { key: 'showItemCodes',    label: 'Item barcode / SKU codes',           hide: receipt.layout === 'minimal' },
                ].filter(r => !r.hide).map(({ key, label }) => (
                  <ToggleRow key={key} label={label}
                    checked={receipt[key as keyof ReceiptSettings] as boolean}
                    onChange={v => setR(key as keyof ReceiptSettings, v as any)} />
                ))}
              </Card>

              {/* Live mini preview */}
              <Card title="Preview">
                <div className="border border-gray-200 rounded-lg bg-gray-50 p-3 max-w-[180px]"
                  style={{ fontFamily: FONT_FAMILY_MAP[receipt.fontFamily], fontSize: `${receipt.fontSize}px`, lineHeight: '1.5' }}>
                  <div className="font-bold text-center text-xs">{receipt.layout === 'fiscal' ? (receipt.headerTitle || '***FISCAL TAX INVOICE***') : ''}</div>
                  <div className="font-bold text-center">{receipt.layout !== 'fiscal' ? 'My Store' : ''}</div>
                  {receipt.layout === 'fiscal' && <div className="font-bold text-center" style={{ fontSize: `${receipt.fontSize + 2}px` }}>My Store</div>}
                  <div className="my-1" style={{ borderTop: receipt.dividerStyle === 'solid' ? '1px solid #000' : receipt.dividerStyle === 'double' ? '3px double #000' : '1px dashed #000' }} />
                  {receipt.layout !== 'minimal' && <><div className="flex justify-between"><span>Ref</span><span>001</span></div><div className="flex justify-between"><span>Date</span><span>17 Jun</span></div><div className="my-1" style={{ borderTop: '1px dashed #999' }} /></>}
                  <div className="flex justify-between"><span>Coca Cola</span><span>50.00</span></div>
                  <div className="flex justify-between"><span>Bread</span><span>25.00</span></div>
                  <div className="my-1" style={{ borderTop: receipt.dividerStyle === 'solid' ? '1px solid #000' : receipt.dividerStyle === 'double' ? '3px double #000' : '1px dashed #000' }} />
                  {receipt.showVatBreakdown && receipt.layout !== 'minimal' && <><div className="flex justify-between"><span>Net</span><span>65.22</span></div><div className="flex justify-between"><span>VAT</span><span>9.78</span></div></>}
                  <div className="flex justify-between font-bold"><span>TOTAL</span><span>75.00</span></div>
                  <div className="my-1" style={{ borderTop: '1px dashed #999' }} />
                  <div>CASH</div>
                  {receipt.showCashierName && <div>Cashier: Jane</div>}
                </div>
              </Card>
            </div>
          </div>
        </div>
      );

      // ---- Barcode Scanner -----------------------------------
      case 'scanner': return (
        <div className="space-y-4">
          <Card title="Barcode Scanner">
            <ToggleRow
              label="Enable barcode scanner"
              description="Listens for USB/Bluetooth scanner input (HID keyboard wedge - plug-and-play)"
              checked={hw.barcodeScannerEnabled}
              onChange={(v) => hw.update({ barcodeScannerEnabled: v })}
            />
            <ToggleRow
              label="Auto-add item on scan"
              description="If scan matches exactly one product, add it to cart automatically"
              checked={hw.barcodeAutoAdd}
              onChange={(v) => hw.update({ barcodeAutoAdd: v })}
            />
          </Card>

          <Card title="How it works">
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex gap-3">
                <ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <p>Plug any USB or Bluetooth barcode scanner. Most scanners work in <strong>HID keyboard wedge</strong> mode - no drivers needed.</p>
              </div>
              <div className="flex gap-3">
                <ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <p>Scan a barcode from any screen. Core detects the fast keystroke pattern and routes it to the product search.</p>
              </div>
              <div className="flex gap-3">
                <ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <p>If "Auto-add" is on and the barcode matches one SKU, it's added to the cart instantly.</p>
              </div>
              <div className="flex gap-3">
                <ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <p>2D scanners (QR codes, DataMatrix) work the same way.</p>
              </div>
            </div>
          </Card>

          <Card title="Test">
            <p className="text-sm text-gray-600 mb-3">Scan a barcode now. The value should appear in the product search on the Register page.</p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-md px-4 py-3 text-sm text-gray-500">
              <ScanBarcode size={16} />
              <span>Waiting for scan- (scanner must be enabled above)</span>
            </div>
          </Card>
        </div>
      );

      // ---- Cash Drawer ---------------------------------------
      case 'drawer': return (
        <div className="space-y-4">
          <Card title="Cash Drawer">
            <ToggleRow
              label="Enable cash drawer"
              description="Automatically open the cash drawer on each completed cash sale"
              checked={hw.cashDrawerEnabled}
              onChange={(v) => hw.update({ cashDrawerEnabled: v })}
            />
            <ToggleRow
              label="Open via receipt printer"
              description="Sends ESC/POS kick command through the USB receipt printer (most common wiring)"
              checked={hw.cashDrawerViaPrinter}
              onChange={(v) => hw.update({ cashDrawerViaPrinter: v })}
            />
          </Card>

          <Card title="Wiring guide">
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>Most cash drawers connect via a <strong>RJ-11/RJ-12 cable to the receipt printer</strong>. Make sure the printer is in USB mode above.</p></div>
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>If your drawer has a direct USB port, the WebUSB connection will also send the kick command.</p></div>
            </div>
          </Card>

          <Card title="Test">
            <button onClick={handleTestDrawer} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">
              <DollarSign size={14} />Open Cash Drawer
            </button>
            <p className="text-xs text-gray-400 mt-2">Requires USB printer to be connected above.</p>
          </Card>
        </div>
      );

      // ---- Customer Display ----------------------------------
      case 'display': return (
        <div className="space-y-4">
          <Card title="Customer Display">
            <ToggleRow
              label="Enable customer display"
              description="Show live cart on a second screen facing the customer"
              checked={hw.customerDisplayEnabled}
              onChange={(v) => hw.update({ customerDisplayEnabled: v })}
            />
          </Card>

          <Card title="Setup">
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>Extend your desktop to a second monitor facing the customer.</p></div>
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>Click <strong>Open Display</strong> below, then drag that window to the customer screen and maximise it.</p></div>
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>The display updates in real time using the browser's <code className="bg-gray-100 px-1 rounded">BroadcastChannel</code> API - no extra server required.</p></div>
            </div>
          </Card>

          <Card title="Control">
            <div className="flex gap-3 flex-wrap">
              <button onClick={handleOpenDisplay} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                <Monitor size={14} />Open Display Window
              </button>
              <button onClick={handleTestDisplay} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">
                <Globe size={14} />Send Test Data
              </button>
              <button onClick={() => { closeCustomerDisplay(); toast.success('Display closed'); }}
                className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200">
                Close Display
              </button>
            </div>
          </Card>
        </div>
      );

      // ---- Weighing Scale ------------------------------------
      case 'scale': return (
        <div className="space-y-4">
          <Card title="Weighing Scale">
            <div className="space-y-2">
              {(['webserial', 'none'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-3 p-3 rounded-md border border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <input type="radio" name="scaleMode" value={mode} checked={hw.scaleMode === mode}
                    onChange={() => hw.update({ scaleMode: mode })} className="accent-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{mode === 'webserial' ? 'Web Serial (USB/RS-232)' : 'Disabled'}</p>
                    <p className="text-xs text-gray-500">{mode === 'webserial' ? 'Connect via Chrome/Edge Web Serial API' : 'No scale integration'}</p>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          {hw.scaleMode === 'webserial' && (
            <>
              <Card title="Baud Rate">
                <select
                  value={hw.scaleBaudRate}
                  onChange={(e) => hw.update({ scaleBaudRate: Number(e.target.value) })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                    <option key={b} value={b}>{b} baud</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Check your scale's manual for the correct baud rate (usually 9600).</p>
              </Card>

              <Card title="Connection">
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <Status ok={scale.connected} label={scale.connected ? 'Connected' : 'Disconnected'} />
                  {scale.weight && (
                    <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-semibold">
                      {scale.weight.value} {scale.weight.unit}
                    </span>
                  )}
                </div>
                {scale.error && (
                  <div className="flex items-center gap-2 text-red-600 text-xs mb-3">
                    <AlertTriangle size={13} />{scale.error}
                  </div>
                )}
                <div className="flex gap-3">
                  {!scale.connected
                    ? <button onClick={scale.connect} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><Wifi size={14} />Connect Scale</button>
                    : <button onClick={scale.disconnect} className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200">Disconnect</button>}
                </div>
              </Card>
            </>
          )}

          <Card title="Usage on Register">
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>When a scale is connected, the live weight reading appears in the quantity field for the selected product.</p></div>
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>Place the product on the scale; the weight auto-fills. Tap the product card to add it.</p></div>
            </div>
          </Card>
        </div>
      );

      // ---- Label Printer ------------------------------------
      case 'label': return (
        <div className="space-y-4">
          <Card title="Label Printer Mode">
            <div className="space-y-2">
              {(['browser', 'none'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-3 p-3 rounded-md border border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <input type="radio" name="labelMode" value={mode} checked={hw.labelPrinterMode === mode}
                    onChange={() => hw.update({ labelPrinterMode: mode })} className="accent-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{mode === 'browser' ? 'Browser Print' : 'Disabled'}</p>
                    <p className="text-xs text-gray-500">{mode === 'browser' ? 'Opens system print dialog at label size' : 'No label printing'}</p>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          <Card title="Label Size">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Width (mm)</label>
                <input type="number" min={20} max={200} value={hw.labelWidth}
                  onChange={(e) => hw.update({ labelWidth: Number(e.target.value) })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Height (mm)</label>
                <input type="number" min={10} max={200} value={hw.labelHeight}
                  onChange={(e) => hw.update({ labelHeight: Number(e.target.value) })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[{w:50,h:30,label:'50Ãƒ"30 mm'},{w:60,h:40,label:'60Ãƒ"40 mm'},{w:100,h:50,label:'100Ãƒ"50 mm'}].map((p) => (
                <button key={p.label} onClick={() => hw.update({ labelWidth: p.w, labelHeight: p.h })}
                  className={`px-3 py-1 rounded-lg text-xs border transition-colors ${hw.labelWidth === p.w && hw.labelHeight === p.h ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Test">
            <button onClick={handleTestLabel} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">
              <Tag size={14} />Print Test Label
            </button>
            <p className="text-xs text-gray-400 mt-2">Labels can be printed from the Products page using the label icon next to each product.</p>
          </Card>
        </div>
      );

      // ---- Card Machine ------------------------------------
      case 'card': return (
        <div className="space-y-4">
          <Card title="Card Machine Mode">
            <div className="space-y-2">
              {(['webhook', 'none'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-3 p-3 rounded-md border border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <input type="radio" name="cardMode" value={mode} checked={hw.cardMachineMode === mode}
                    onChange={() => hw.update({ cardMachineMode: mode })} className="accent-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{mode === 'webhook' ? 'Webhook / REST API' : 'Disabled (manual)'}</p>
                    <p className="text-xs text-gray-500">
                      {mode === 'webhook'
                        ? 'Core calls your terminal\'s local REST endpoint when a card payment is initiated'
                        : 'Process card payments on the terminal manually; record them as "Card" in the POS'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          {hw.cardMachineMode === 'webhook' && (
            <Card title="Terminal Webhook URL">
              <input
                type="url"
                value={hw.cardMachineWebhookUrl}
                placeholder="http://127.0.0.1:8080/api/pay"
                onChange={(e) => hw.update({ cardMachineWebhookUrl: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                Core will POST <code className="bg-gray-100 px-1 rounded">{`{ amount, currency, reference }`}</code> to a local or LAN URL and expect <code className="bg-gray-100 px-1 rounded">{`{ success, reference }`}</code> in response.
              </p>
              <div className="mt-3 space-y-1 text-xs text-gray-500">
                <p className="font-medium text-gray-700">Compatible terminals:</p>
                <p>- Yoco Khumo / Yoco Go (via a local bridge)</p>
                <p>- PayAt (via local integration middleware)</p>
                <p>- Any terminal with a local HTTP API</p>
              </div>
            </Card>
          )}

          <Card title="Test">
            <button onClick={handleTestCard} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">
              <CreditCard size={14} />Simulate Card Payment (R100)
            </button>
          </Card>
        </div>
      );

      // ---- Touchscreen ------------------------------------
      case 'touch': return (
        <div className="space-y-4">
          <Card title="Touchscreen Optimisation">
            <ToggleRow
              label="Touchscreen mode"
              description="Increases tap target sizes, removes hover-only effects, and enables swipe gestures on the POS screen"
              checked={hw.touchscreenMode}
              onChange={(v) => hw.update({ touchscreenMode: v })}
            />
          </Card>

          <Card title="Tips for touchscreen POS">
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>Use a <strong>capacitive touchscreen</strong> (all modern touchscreens). Resistive screens may have reduced accuracy.</p></div>
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>Set your OS to <strong>tablet mode</strong> or auto-hide the taskbar to maximise screen space.</p></div>
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>The POS Register page is fully touch-friendly. Product cards, the numpad, and payment buttons all have large tap targets.</p></div>
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>Use <strong>F9</strong> (hardware button) or the on-screen "Process Sale" button to complete a transaction.</p></div>
            </div>
          </Card>
        </div>
      );

      // ---- KDS / Queue Display ----------------------------
      case 'kds': return (
        <div className="space-y-4">

          {/* KDS sub-section */}
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Kitchen Display (KDS)</p>

          <Card title="Theme">
            <div className="flex gap-2">
              {([
                { v: 'dark',          label: 'Dark',          cls: 'bg-gray-900 text-white' },
                { v: 'light',         label: 'Light',         cls: 'bg-white text-gray-900 border border-gray-300' },
                { v: 'high-contrast', label: 'High Contrast', cls: 'bg-black text-yellow-400 border border-yellow-500' },
              ] as const).map(({ v, label, cls }) => (
                <button key={v} type="button" onClick={() => setK('kdsTheme', v)}
                  className={`flex-1 py-2 px-2 rounded-md text-xs font-medium transition-all ${cls} ${kds.kdsTheme === v ? 'ring-2 ring-blue-500 ring-offset-1' : 'opacity-60 hover:opacity-100'}`}>
                  {label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Configuration">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Display Name</label>
                <input value={kds.kdsDisplayName} onChange={e => setK('kdsDisplayName', e.target.value)}
                  placeholder="Kitchen Display" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Refresh Interval</label>
                <select value={kds.kdsRefreshInterval} onChange={e => setK('kdsRefreshInterval', Number(e.target.value) as KdsSettings['kdsRefreshInterval'])}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value={2}>Every 2 seconds</option>
                  <option value={4}>Every 4 seconds</option>
                  <option value={6}>Every 6 seconds</option>
                  <option value={10}>Every 10 seconds</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Grid Columns</label>
                <select value={kds.kdsColumns} onChange={e => setK('kdsColumns', e.target.value as KdsSettings['kdsColumns'])}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="auto">Auto (responsive)</option>
                  <option value="2">2 columns</option>
                  <option value="3">3 columns</option>
                  <option value="4">4 columns</option>
                  <option value="5">5 columns</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Urgent Alert After (min)</label>
                <input type="number" min={1} max={60} value={kds.kdsUrgentMinutes}
                  onChange={e => setK('kdsUrgentMinutes', Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-2">
              <ToggleRow label="Sound alert on new order" description="Play a beep when a new order arrives on the KDS"
                checked={kds.kdsSoundEnabled} onChange={v => setK('kdsSoundEnabled', v)} />
              <ToggleRow label="Show served orders" description="Keep served order cards visible on screen"
                checked={kds.kdsShowServed} onChange={v => setK('kdsShowServed', v)} />
            </div>
          </Card>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1 mb-4">Customer Queue Display</p>
          </div>

          <Card title="Theme">
            <div className="flex gap-2">
              {([
                { v: 'dark',          label: 'Dark',          cls: 'bg-gray-900 text-white' },
                { v: 'light',         label: 'Light',         cls: 'bg-white text-gray-900 border border-gray-300' },
                { v: 'high-contrast', label: 'High Contrast', cls: 'bg-black text-yellow-400 border border-yellow-500' },
              ] as const).map(({ v, label, cls }) => (
                <button key={v} type="button" onClick={() => setK('queueTheme', v)}
                  className={`flex-1 py-2 px-2 rounded-md text-xs font-medium transition-all ${cls} ${kds.queueTheme === v ? 'ring-2 ring-blue-500 ring-offset-1' : 'opacity-60 hover:opacity-100'}`}>
                  {label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Configuration">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Screen Title</label>
                <input value={kds.queueStoreName} onChange={e => setK('queueStoreName', e.target.value)}
                  placeholder="Order Status" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Ticket Number Size</label>
                <select value={kds.queueTicketSize} onChange={e => setK('queueTicketSize', e.target.value as KdsSettings['queueTicketSize'])}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="sm">Small</option>
                  <option value="md">Medium</option>
                  <option value="lg">Large</option>
                  <option value="xl">Extra Large</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">"Preparing" Column Label</label>
                <input value={kds.queuePreparingLabel} onChange={e => setK('queuePreparingLabel', e.target.value)}
                  placeholder="Now Preparing" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">"Ready" Column Label</label>
                <input value={kds.queueReadyLabel} onChange={e => setK('queueReadyLabel', e.target.value)}
                  placeholder="Ready for Collection" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-1">Footer Message</label>
                <input value={kds.queueFooterMessage} onChange={e => setK('queueFooterMessage', e.target.value)}
                  placeholder="Watch this screen — your number will appear when your order is ready"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-2">
              <ToggleRow label="Show clock" description="Display a live clock in the top-right corner of the queue screen"
                checked={kds.queueShowClock} onChange={v => setK('queueShowClock', v)} />
            </div>
          </Card>

          <div className="rounded-md bg-orange-50 border border-orange-100 px-4 py-3 text-sm text-orange-700">
            Open <strong>/kitchen</strong> or <strong>/queue</strong> in a separate browser tab or on a TV — settings apply immediately on reload. Changes save automatically.
          </div>
        </div>
      );

      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-purple-100 flex items-center justify-center">
            <Settings2 size={20} className="text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Hardware</h1>
            <p className="text-sm text-gray-500">Connect and configure POS hardware devices</p>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Sidebar tabs */}
        <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-100 py-4">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${tab === id ? 'bg-blue-50 text-blue-700 font-semibold border-r-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {renderTab()}
        </main>
      </div>
    </div>
  );
}
