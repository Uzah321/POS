/**
 * How this device lays out a receipt it prints itself (Hardware > Receipt):
 * layout, font, paper and divider. What a receipt shows is chosen for the
 * whole shop in Settings > Receipts & Invoices (see receiptOptions.ts).
 */
export interface ReceiptSettings {
  layout: 'fiscal' | 'simple' | 'minimal';
  fontFamily: 'courier' | 'arial' | 'verdana' | 'georgia';
  fontSize: 10 | 11 | 12 | 13 | 14;
  paperWidth: '58mm' | '80mm' | 'a4';
  headerTitle: string;
  dividerStyle: 'dashed' | 'solid' | 'double';
}

export const FONT_FAMILY_MAP: Record<ReceiptSettings['fontFamily'], string> = {
  courier: "'Courier New', Courier, monospace",
  arial:   'Arial, Helvetica, sans-serif',
  verdana: 'Verdana, Geneva, sans-serif',
  georgia: "Georgia, 'Times New Roman', serif",
};

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  layout: 'fiscal',
  fontFamily: 'courier',
  fontSize: 11,
  paperWidth: '80mm',
  headerTitle: '***FISCAL TAX INVOICE***',
  dividerStyle: 'dashed',
};

const STORAGE_KEY = 'Core-receipt-settings';

export function loadReceiptSettings(): ReceiptSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_RECEIPT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_RECEIPT_SETTINGS };
}

export function saveReceiptSettings(s: ReceiptSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}
