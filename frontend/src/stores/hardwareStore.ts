import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PrinterMode = 'browser' | 'webusb' | 'none';
export type ScaleMode = 'webserial' | 'none';
export type CardMachineMode = 'webhook' | 'none';

export interface HardwareConfig {
  // Receipt printer
  printerMode: PrinterMode;
  printerVendorId: number | null;
  printerProductId: number | null;
  printerName: string;
  autoPrintReceipt: boolean;

  // Cash drawer
  cashDrawerEnabled: boolean;
  cashDrawerViaPrinter: boolean; // open via ESC/POS kick command

  // Barcode scanner
  barcodeScannerEnabled: boolean;
  barcodeAutoAdd: boolean; // auto-add product on scan if exactly 1 match

  // Customer display
  customerDisplayEnabled: boolean;

  // Weighing scale
  scaleMode: ScaleMode;
  scaleBaudRate: number;

  // Label printer
  labelPrinterMode: PrinterMode;
  labelWidth: number;  // mm
  labelHeight: number; // mm

  // Card machine
  cardMachineMode: CardMachineMode;
  cardMachineWebhookUrl: string;

  // Touchscreen
  touchscreenMode: boolean;
}

interface HardwareStore extends HardwareConfig {
  update: (patch: Partial<HardwareConfig>) => void;
  reset: () => void;
}

const DEFAULTS: HardwareConfig = {
  printerMode: 'browser',
  printerVendorId: null,
  printerProductId: null,
  printerName: '',
  autoPrintReceipt: true,

  cashDrawerEnabled: false,
  cashDrawerViaPrinter: true,

  barcodeScannerEnabled: true,
  barcodeAutoAdd: true,

  customerDisplayEnabled: false,

  scaleMode: 'none',
  scaleBaudRate: 9600,

  labelPrinterMode: 'browser',
  labelWidth: 50,
  labelHeight: 30,

  cardMachineMode: 'none',
  cardMachineWebhookUrl: '',

  touchscreenMode: false,
};

export const useHardwareStore = create<HardwareStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      update: (patch) => set((s) => ({ ...s, ...patch })),
      reset: () => set(DEFAULTS),
    }),
    { name: 'hardware-config' }
  )
);
