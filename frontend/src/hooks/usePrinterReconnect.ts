import { useEffect, useState } from 'react';
import { useHardwareStore } from '../stores/hardwareStore';
import { reconnectUsbPrinter } from '../lib/hardware/printer';

/**
 * Reopens this device's saved USB receipt/kitchen printers on page load.
 * The browser remembers USB permission but not the open connection, so without
 * this a reload would silently fall back to the print dialog until someone
 * re-clicked Connect in Hardware setup. Bluetooth can't be reopened without a
 * user gesture, so it still needs a manual reconnect each session.
 * Returns which roles ended up connected over USB.
 */
export function usePrinterReconnect(): { receipt: boolean; kitchen: boolean } {
  const hw = useHardwareStore();
  const [connected, setConnected] = useState({ receipt: false, kitchen: false });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const receipt = hw.printerMode === 'webusb'
        && await reconnectUsbPrinter('receipt', hw.printerVendorId, hw.printerProductId);
      const kitchen = hw.kitchenPrinterEnabled && hw.kitchenPrinterMode === 'webusb'
        && await reconnectUsbPrinter('kitchen', hw.kitchenPrinterVendorId, hw.kitchenPrinterProductId);
      if (!cancelled) setConnected({ receipt, kitchen });
    })();
    return () => { cancelled = true; };
  }, [hw.printerMode, hw.printerVendorId, hw.printerProductId, hw.kitchenPrinterEnabled, hw.kitchenPrinterMode, hw.kitchenPrinterVendorId, hw.kitchenPrinterProductId]);

  return connected;
}
