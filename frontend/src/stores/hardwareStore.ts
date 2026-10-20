import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { loadReceiptSettings } from '../lib/receiptSettings';

export type PrinterMode = 'browser' | 'webusb' | 'webbluetooth' | 'system' | 'none';
export type CardMachineMode = 'webhook' | 'none';

/** A printer ticked in the list of printers Windows has installed (mode 'system'). */
export interface ChosenPrinter {
  /** The exact Windows printer name — what gets printed to. */
  name: string;
  /** Thermal roll width; A4 only in the desktop app, which prints HTML (the Core Bridge sends ESC/POS). */
  paper: '58mm' | '80mm' | 'a4';
  /** Kitchen printers: only lines from these category ids; empty = every item. */
  categoryIds: number[];
}

export interface HardwareConfig {
  // Receipt printer
  printerMode: PrinterMode;
  printerVendorId: number | null;
  printerProductId: number | null;
  // 'webusb' / 'webbluetooth': the connected device's name (display only).
  printerName: string;
  // 'system': every bill prints on each of these.
  receiptPrinters: ChosenPrinter[];
  // Mode 'system' in a browser: the program on this computer that reaches
  // the chosen printers. (The desktop app prints to them itself.)
  printConnector: 'qz' | 'bridge';
  autoPrintReceipt: boolean;

  // Kitchen printer — prints an order ticket (no prices) for the back when a
  // restaurant order is sent (held to a table) or paid. Same modes as the
  // receipt printer, chosen independently per device.
  kitchenPrinterEnabled: boolean;
  kitchenPrinterMode: PrinterMode;
  kitchenPrinterName: string;
  kitchenPrinterVendorId: number | null;
  kitchenPrinterProductId: number | null;
  // 'system': each ticket prints on every one of these that takes any of its lines.
  kitchenPrinters: ChosenPrinter[];
  // The other modes' one kitchen printer: only lines from these category
  // ids go on its tickets; empty = all (keeps a bar's drinks off it).
  kitchenCategoryIds: number[];

  // Cash drawer
  cashDrawerEnabled: boolean;
  cashDrawerViaPrinter: boolean; // open via ESC/POS kick command

  // Barcode scanner
  barcodeScannerEnabled: boolean;
  barcodeAutoAdd: boolean; // auto-add product on scan if exactly 1 match

  // Customer display
  customerDisplayEnabled: boolean;

  // Pole display — a 2x20 character display on a USB virtual COM port
  // (e.g. HP LM940), driven over Web Serial. The port's USB ids pick it back
  // out of the browser's granted ports after a reload.
  poleDisplayEnabled: boolean;
  poleDisplayVendorId: number | null;
  poleDisplayProductId: number | null;

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
  receiptPrinters: [],
  printConnector: 'qz',
  autoPrintReceipt: true,

  kitchenPrinterEnabled: false,
  kitchenPrinterMode: 'browser',
  kitchenPrinterName: '',
  kitchenPrinterVendorId: null,
  kitchenPrinterProductId: null,
  kitchenPrinters: [],
  kitchenCategoryIds: [],

  cashDrawerEnabled: false,
  cashDrawerViaPrinter: true,

  barcodeScannerEnabled: true,
  barcodeAutoAdd: true,

  customerDisplayEnabled: false,

  poleDisplayEnabled: false,
  poleDisplayVendorId: null,
  poleDisplayProductId: null,

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
    {
      name: 'hardware-config',
      version: 1,
      // Before version 1, mode 'system' printed to one printer by name: it
      // becomes the first chosen one (a kitchen one keeps its category list).
      migrate: (persisted: any, version) => {
        const state = { ...DEFAULTS, ...(persisted ?? {}) };
        if (version < 1) {
          if (state.printerMode === 'system' && state.printerName) {
            state.receiptPrinters = [{ name: state.printerName, paper: loadReceiptSettings().paperWidth, categoryIds: [] }];
            state.printerName = '';
          }
          if (state.kitchenPrinterMode === 'system' && state.kitchenPrinterName) {
            state.kitchenPrinters = [{ name: state.kitchenPrinterName, paper: '80mm', categoryIds: state.kitchenCategoryIds ?? [] }];
            state.kitchenPrinterName = '';
          }
        }
        return state as HardwareStore;
      },
    }
  )
);
