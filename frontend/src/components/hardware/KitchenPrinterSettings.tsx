import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Usb, Bluetooth, RefreshCw, Star, Cable, CheckCircle, WifiOff, ChefHat } from 'lucide-react';
import toast from 'react-hot-toast';
import { categoriesApi } from '../../api';
import { useHardwareStore, type PrinterMode } from '../../stores/hardwareStore';
import { useAuthStore } from '../../stores/authStore';
import {
  connectUsbPrinter, disconnectUsbPrinter, connectBluetoothPrinter, disconnectBluetoothPrinter,
  isPrinterConnected, isSystemPrintAvailable, listSystemPrinters, printKitchenTicket, resolveReceiptPrintMode,
} from '../../lib/hardware/printer';

// Hardware > Kitchen Printer: a second printer, chosen independently of the
// front receipt printer, that gets an order ticket (no prices) for the back
// whenever a restaurant order is sent to a table or paid.

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
      {title && <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>}
      {children}
    </div>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
      {ok ? <CheckCircle size={12} /> : <WifiOff size={12} />}
      {label}
    </span>
  );
}

const MODES: Array<{ mode: Exclude<PrinterMode, 'none'>; title: string; help: string; desktopOnly?: boolean }> = [
  { mode: 'system', title: 'Choose a Printer (recommended)', help: 'Pick the kitchen printer once — tickets then print there silently, no dialog', desktopOnly: true },
  { mode: 'browser', title: 'System Print Dialog', help: 'Opens the print dialog for every ticket — choose the kitchen printer in it each time' },
  { mode: 'webusb', title: 'Direct USB / ESC-POS', help: 'Prints instantly to a USB thermal printer plugged into this device (Chrome/Edge)' },
  { mode: 'webbluetooth', title: 'Direct Bluetooth / ESC-POS', help: 'Prints instantly to a Bluetooth LE thermal printer (Chrome/Edge, including Android tablets)' },
];

export default function KitchenPrinterSettings({ usbReconnected }: { usbReconnected: boolean }) {
  const hw = useHardwareStore();
  const { user } = useAuthStore();
  const desktopAppAvailable = isSystemPrintAvailable();
  const [usbConnected, setUsbConnected] = useState(() => isPrinterConnected('kitchen', 'webusb'));
  const [bleConnected, setBleConnected] = useState(() => isPrinterConnected('kitchen', 'webbluetooth'));
  const [systemPrinters, setSystemPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }>>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => { if (usbReconnected) setUsbConnected(true); }, [usbReconnected]);

  const { data: categories = [] } = useQuery({
    queryKey: ['kitchen-printer-categories'],
    queryFn: () => categoriesApi.list().then((r) => r.data?.data ?? []),
    staleTime: 60000,
  });

  const handleScan = async () => {
    setScanning(true);
    try {
      const found = await listSystemPrinters();
      setSystemPrinters(found);
      if (found.length === 0) toast.error("No printers found — check it's installed/paired in Windows first");
    } finally {
      setScanning(false);
    }
  };

  const handleConnectUsb = async () => {
    try {
      const info = await connectUsbPrinter('kitchen');
      hw.update({ kitchenPrinterMode: 'webusb', kitchenPrinterName: info.name, kitchenPrinterVendorId: info.vendorId, kitchenPrinterProductId: info.productId });
      setUsbConnected(true);
      toast.success(`Kitchen printer connected: ${info.name}`);
    } catch (e: any) {
      toast.error(e.message ?? 'Could not connect printer');
    }
  };

  const handleConnectBluetooth = async () => {
    try {
      const info = await connectBluetoothPrinter('kitchen');
      hw.update({ kitchenPrinterMode: 'webbluetooth', kitchenPrinterName: info.name });
      setBleConnected(true);
      toast.success(`Kitchen printer connected: ${info.name}`);
    } catch (e: any) {
      toast.error(e.message ?? 'Could not connect Bluetooth printer');
    }
  };

  const handleDisconnect = async (mode: 'webusb' | 'webbluetooth') => {
    if (mode === 'webusb') { await disconnectUsbPrinter('kitchen'); setUsbConnected(false); }
    else { await disconnectBluetoothPrinter('kitchen'); setBleConnected(false); }
    hw.update({ kitchenPrinterMode: 'browser', kitchenPrinterName: '' });
    toast.success('Kitchen printer disconnected');
  };

  const handleTest = () => {
    void printKitchenTicket({
      title: 'TEST TICKET',
      ticket: '#0000',
      table: 'T-1',
      orderType: 'sit_in',
      covers: 2,
      waiter: user?.name ?? 'Waiter',
      items: [
        { name: 'Grilled Chicken Burger', qty: 2 },
        { name: 'Chips (large)', qty: 1 },
        { name: 'Greek Salad', qty: 1 },
      ],
      note: 'No onions on one burger',
    }, resolveReceiptPrintMode(hw.kitchenPrinterMode), hw.kitchenPrinterName).catch((e: any) => {
      toast.error(e?.message ?? 'Could not print test ticket');
    });
  };

  const toggleCategory = (id: number) => {
    const ids = hw.kitchenCategoryIds.includes(id) ? hw.kitchenCategoryIds.filter((c) => c !== id) : [...hw.kitchenCategoryIds, id];
    hw.update({ kitchenCategoryIds: ids });
  };

  return (
    <div className="space-y-4">
      <Card title="Kitchen Printer">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={hw.kitchenPrinterEnabled} onChange={(e) => hw.update({ kitchenPrinterEnabled: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-blue-600" />
          <div>
            <p className="text-sm font-medium text-gray-900">Print kitchen order tickets from this device</p>
            <p className="text-xs text-gray-500 mt-0.5">
              On the restaurant POS, a ticket (table, waiter, items — no prices) prints on this printer when an order is <b>held / sent to a table</b> or <b>paid</b>.
              The customer's receipt still prints on the Receipt Printer. Adding items to a table later prints an "ADD TO ORDER" ticket with only the new items.
            </p>
          </div>
        </label>
      </Card>

      {hw.kitchenPrinterEnabled && (
        <>
          <Card title="Which Printer">
            <div className="space-y-2">
              {MODES.map(({ mode, title, help, desktopOnly }) => {
                const disabled = !!desktopOnly && !desktopAppAvailable;
                return (
                  <label key={mode} className={`flex items-center gap-3 p-3 rounded-md border border-gray-100 hover:bg-gray-50 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input type="radio" name="kitchenPrinterMode" checked={hw.kitchenPrinterMode === mode} disabled={disabled}
                      onChange={() => hw.update({ kitchenPrinterMode: mode })} className="accent-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{title}</p>
                      <p className="text-xs text-gray-500">{disabled ? 'Requires the Core desktop app (not a browser tab)' : help}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </Card>

          {hw.kitchenPrinterMode === 'system' && (
            <Card title="Choose Kitchen Printer">
              <p className="text-sm text-gray-600 mb-3">
                Scans every printer Windows knows about — USB, Bluetooth-paired or network (e.g. an Ethernet printer in the kitchen installed in Windows). Pick the one in the kitchen.
              </p>
              <button onClick={handleScan} disabled={scanning}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 mb-3">
                <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
                {scanning ? 'Scanning…' : 'Scan for Printers'}
              </button>
              {hw.kitchenPrinterName && systemPrinters.length === 0 && (
                <p className="text-sm text-gray-700">Current kitchen printer: <b>{hw.kitchenPrinterName}</b></p>
              )}
              {systemPrinters.length > 0 && (
                <div className="space-y-2">
                  {systemPrinters.map((p) => {
                    const selected = hw.kitchenPrinterName === p.name;
                    return (
                      <div key={p.name} className={`flex items-center justify-between gap-3 p-3 rounded-md border ${selected ? 'border-blue-300 bg-blue-50' : 'border-gray-100'}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Cable size={15} className="text-gray-400 flex-shrink-0" />
                          <p className="text-sm font-medium text-gray-900 truncate">{p.displayName}</p>
                        </div>
                        {selected ? (
                          <span className="flex items-center gap-1 text-xs font-semibold text-blue-700 flex-shrink-0"><Star size={13} className="fill-blue-700" />Kitchen</span>
                        ) : (
                          <button onClick={() => { hw.update({ kitchenPrinterMode: 'system', kitchenPrinterName: p.name }); toast.success(`"${p.displayName}" is now the kitchen printer`); }}
                            className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg hover:bg-gray-800 flex-shrink-0">
                            Use for Kitchen
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {hw.printerMode === 'system' && hw.printerName && hw.printerName === hw.kitchenPrinterName && (
                <p className="text-xs text-amber-600 mt-3">This is also the receipt printer — both tickets will come out of the same printer.</p>
              )}
            </Card>
          )}

          {hw.kitchenPrinterMode === 'webusb' && (
            <Card title="USB Kitchen Printer">
              <div className="flex items-center gap-3 flex-wrap">
                <Status ok={usbConnected} label={usbConnected ? (hw.kitchenPrinterName || 'Connected') : 'Not connected'} />
                {!usbConnected
                  ? <button onClick={handleConnectUsb} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><Usb size={14} />Connect Printer</button>
                  : <button onClick={() => handleDisconnect('webusb')} className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200">Disconnect</button>}
              </div>
              <p className="text-xs text-gray-400 mt-3">Plug the kitchen printer into this device, then Connect — it reconnects automatically after that.</p>
            </Card>
          )}

          {hw.kitchenPrinterMode === 'webbluetooth' && (
            <Card title="Bluetooth Kitchen Printer">
              <div className="flex items-center gap-3 flex-wrap">
                <Status ok={bleConnected} label={bleConnected ? (hw.kitchenPrinterName || 'Connected') : 'Not connected'} />
                {!bleConnected
                  ? <button onClick={handleConnectBluetooth} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><Bluetooth size={14} />Connect Printer</button>
                  : <button onClick={() => handleDisconnect('webbluetooth')} className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200">Disconnect</button>}
              </div>
              <p className="text-xs text-amber-600 mt-3">Reconnect at the start of each shift — the browser doesn't keep Bluetooth connections across restarts.</p>
            </Card>
          )}

          <Card title="What Goes to the Kitchen">
            <p className="text-sm text-gray-600 mb-3">
              Tick the categories the kitchen should get. Leave all unticked to send every item (tick e.g. food only to keep bar drinks off the kitchen ticket).
            </p>
            <div className="flex flex-wrap gap-2">
              {(categories as any[]).map((c: any) => {
                const on = hw.kitchenCategoryIds.includes(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggleCategory(c.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                    {c.name}
                  </button>
                );
              })}
              {(categories as any[]).length === 0 && <p className="text-xs text-gray-400">No categories yet.</p>}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              {hw.kitchenCategoryIds.length === 0 ? 'Sending: every item' : `Sending: ${hw.kitchenCategoryIds.length} categor${hw.kitchenCategoryIds.length === 1 ? 'y' : 'ies'} only`}
            </p>
          </Card>

          <Card title="Test">
            <button onClick={handleTest} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">
              <Printer size={14} /><ChefHat size={14} />Print Test Kitchen Ticket
            </button>
          </Card>
        </>
      )}
    </div>
  );
}
