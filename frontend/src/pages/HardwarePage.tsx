import { useEffect, useState } from 'react';
import { useHardwareStore } from '../stores/hardwareStore';
import {
  Printer, ScanBarcode, DollarSign, Monitor, Scale, Tag, CreditCard, Touchpad,
  Wifi, WifiOff, CheckCircle, AlertTriangle, Settings2, Usb, Globe, ChevronRight
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
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
      storeName: 'NexaPOS Store',
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
      footer: '*** TEST RECEIPT — NOT A VALID RECEIPT ***',
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
      storeName: 'NexaPOS Store',
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
    const loadingToast = toast.loading('Simulating card payment…');
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
                <label key={mode} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer">
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
        </div>
      );

      // ---- Barcode Scanner -----------------------------------
      case 'scanner': return (
        <div className="space-y-4">
          <Card title="Barcode Scanner">
            <ToggleRow
              label="Enable barcode scanner"
              description="Listens for USB/Bluetooth scanner input (HID keyboard wedge — plug-and-play)"
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
                <p>Plug any USB or Bluetooth barcode scanner. Most scanners work in <strong>HID keyboard wedge</strong> mode — no drivers needed.</p>
              </div>
              <div className="flex gap-3">
                <ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <p>Scan a barcode from any screen. NexaPOS detects the fast keystroke pattern and routes it to the product search.</p>
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
            <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-500">
              <ScanBarcode size={16} />
              <span>Waiting for scan… (scanner must be enabled above)</span>
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
              <div className="flex gap-3"><ChevronRight size={16} className="text-blue-500 mt-0.5 flex-shrink-0" /><p>The display updates in real time using the browser's <code className="bg-gray-100 px-1 rounded">BroadcastChannel</code> API — no extra server required.</p></div>
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
                <label key={mode} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer">
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
                <label key={mode} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer">
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
              {[{w:50,h:30,label:'50×30 mm'},{w:60,h:40,label:'60×40 mm'},{w:100,h:50,label:'100×50 mm'}].map((p) => (
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
                <label key={mode} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <input type="radio" name="cardMode" value={mode} checked={hw.cardMachineMode === mode}
                    onChange={() => hw.update({ cardMachineMode: mode })} className="accent-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{mode === 'webhook' ? 'Webhook / REST API' : 'Disabled (manual)'}</p>
                    <p className="text-xs text-gray-500">
                      {mode === 'webhook'
                        ? 'NexaPOS calls your terminal\'s REST endpoint when a card payment is initiated'
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
                placeholder="http://localhost:8080/api/pay"
                onChange={(e) => hw.update({ cardMachineWebhookUrl: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                NexaPOS will POST <code className="bg-gray-100 px-1 rounded">{`{ amount, currency, reference }`}</code> to this URL and expect <code className="bg-gray-100 px-1 rounded">{`{ success, reference }`}</code> in response.
              </p>
              <div className="mt-3 space-y-1 text-xs text-gray-500">
                <p className="font-medium text-gray-700">Compatible terminals:</p>
                <p>• Yoco Khumo / Yoco Go (via Yoco Konnect bridge)</p>
                <p>• PayAt (via PayAt integration middleware)</p>
                <p>• Any terminal with a local HTTP API</p>
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

      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
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
