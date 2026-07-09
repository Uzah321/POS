export interface ReceiptSettings {
  layout: 'fiscal' | 'simple' | 'minimal';
  fontFamily: 'courier' | 'arial' | 'verdana' | 'georgia';
  fontSize: 10 | 11 | 12 | 13 | 14;
  paperWidth: '58mm' | '80mm' | 'a4';
  showVatBreakdown: boolean;
  showItemCodes: boolean;
  showCashierName: boolean;
  showOrderType: boolean;
  showVatNote: boolean;
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
  showVatBreakdown: true,
  showItemCodes: true,
  showCashierName: true,
  showOrderType: true,
  showVatNote: true,
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

/** Sync receipt settings from the flat backend settings object (string values). */
export function receiptSettingsFromBackend(data: Record<string, any>): Partial<ReceiptSettings> {
  const out: Partial<ReceiptSettings> = {};
  if (data.receipt_layout)       out.layout        = data.receipt_layout;
  if (data.receipt_font_family)  out.fontFamily    = data.receipt_font_family;
  if (data.receipt_font_size)    out.fontSize      = Number(data.receipt_font_size) as ReceiptSettings['fontSize'];
  if (data.receipt_paper_width)  out.paperWidth    = data.receipt_paper_width;
  if (data.receipt_header_title) out.headerTitle   = data.receipt_header_title;
  if (data.receipt_divider)      out.dividerStyle  = data.receipt_divider;
  if (data.receipt_show_vat_breakdown !== undefined) out.showVatBreakdown = data.receipt_show_vat_breakdown === 'true' || data.receipt_show_vat_breakdown === true;
  if (data.receipt_show_item_codes    !== undefined) out.showItemCodes    = data.receipt_show_item_codes    === 'true' || data.receipt_show_item_codes    === true;
  if (data.receipt_show_cashier       !== undefined) out.showCashierName  = data.receipt_show_cashier       === 'true' || data.receipt_show_cashier       === true;
  if (data.receipt_show_order_type    !== undefined) out.showOrderType    = data.receipt_show_order_type    === 'true' || data.receipt_show_order_type    === true;
  if (data.receipt_show_vat_note      !== undefined) out.showVatNote      = data.receipt_show_vat_note      === 'true' || data.receipt_show_vat_note      === true;
  return out;
}

/** Flatten receipt settings into the backend-compatible flat key/value object. */
export function receiptSettingsToBackend(s: ReceiptSettings): Record<string, string> {
  return {
    receipt_layout:              s.layout,
    receipt_font_family:         s.fontFamily,
    receipt_font_size:           String(s.fontSize),
    receipt_paper_width:         s.paperWidth,
    receipt_header_title:        s.headerTitle,
    receipt_divider:             s.dividerStyle,
    receipt_show_vat_breakdown:  String(s.showVatBreakdown),
    receipt_show_item_codes:     String(s.showItemCodes),
    receipt_show_cashier:        String(s.showCashierName),
    receipt_show_order_type:     String(s.showOrderType),
    receipt_show_vat_note:       String(s.showVatNote),
  };
}
