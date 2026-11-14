/**
 * What a customer's receipt / tax invoice shows — chosen once for the whole
 * shop in Settings > Receipts & Invoices (stored as settings, so every till,
 * printer and the Android app print the same). Everything is on unless turned
 * off. A receipt ZIMRA has fiscalised always keeps what ZIMRA requires.
 */
export interface ReceiptShow {
  fiscalTitle: boolean;
  logo: boolean;
  address: boolean;
  phone: boolean;
  email: boolean;
  vatNumber: boolean;
  tinNumber: boolean;
  cashier: boolean;
  customer: boolean;
  table: boolean;
  orderType: boolean;
  itemCodes: boolean;
  tax: boolean;
  vatNote: boolean;
  tendered: boolean;
  itemCount: boolean;
  payment: boolean;
  fiscalDevice: boolean;
  footer: boolean;
}

export interface ReceiptOption {
  key: keyof ReceiptShow;
  /** The settings key it is saved under ('true' / 'false'). */
  setting: string;
  label: string;
  hint?: string;
  group: 'Top of the receipt' | 'Sale details' | 'Totals & tax' | 'Bottom of the receipt';
}

export const RECEIPT_OPTIONS: ReceiptOption[] = [
  { key: 'logo',         setting: 'receipt_show_logo',          group: 'Top of the receipt', label: 'Logo' },
  { key: 'fiscalTitle',  setting: 'receipt_fiscal_title',       group: 'Top of the receipt', label: '"FISCAL TAX INVOICE" title', hint: 'At the top and near the bottom. Turn off if this shop isn\'t fiscalised.' },
  { key: 'address',      setting: 'receipt_show_address',       group: 'Top of the receipt', label: 'Address' },
  { key: 'cashier',      setting: 'receipt_show_cashier',       group: 'Sale details', label: 'Cashier name' },
  { key: 'customer',     setting: 'receipt_show_customer',      group: 'Sale details', label: 'Customer name' },
  { key: 'table',        setting: 'receipt_show_table',         group: 'Sale details', label: 'Table and covers' },
  { key: 'orderType',    setting: 'receipt_show_order_type',    group: 'Sale details', label: 'Order type (Walk-in / Takeaway / Delivery)' },
  { key: 'itemCodes',    setting: 'receipt_show_item_codes',    group: 'Sale details', label: 'Item barcode / SKU codes' },
  { key: 'tax',          setting: 'receipt_show_vat_breakdown', group: 'Totals & tax', label: 'Tax (VAT) breakdown', hint: 'Total excluding tax, the tax amount and rate, and total including tax.' },
  { key: 'vatNote',      setting: 'receipt_show_vat_note',      group: 'Totals & tax', label: '"All Prices VAT Inclusive" note' },
  { key: 'tendered',     setting: 'receipt_show_tendered',      group: 'Totals & tax', label: 'Amount tendered and change' },
  { key: 'itemCount',    setting: 'receipt_show_item_count',    group: 'Totals & tax', label: 'Number of items' },
  { key: 'payment',      setting: 'receipt_show_payment',       group: 'Totals & tax', label: 'Payment summary', hint: 'How it was paid, and the exchange rate used.' },
  { key: 'phone',        setting: 'receipt_show_phone',         group: 'Bottom of the receipt', label: 'Phone number' },
  { key: 'email',        setting: 'receipt_show_email',         group: 'Bottom of the receipt', label: 'Email address' },
  { key: 'vatNumber',    setting: 'receipt_show_vat_number',    group: 'Bottom of the receipt', label: 'VAT number' },
  { key: 'tinNumber',    setting: 'receipt_show_tin_number',    group: 'Bottom of the receipt', label: 'TIN number' },
  { key: 'fiscalDevice', setting: 'receipt_show_fiscal_device', group: 'Bottom of the receipt', label: 'Fiscal device details', hint: 'Device Id, REC GN, REC 68 and Fiscal Day as typed in Settings.' },
  { key: 'footer',       setting: 'receipt_show_footer',        group: 'Bottom of the receipt', label: 'Footer message' },
];

/** Kept on a receipt ZIMRA has fiscalised, whatever Settings say. */
export const ZIMRA_REQUIRED: (keyof ReceiptShow)[] = ['fiscalTitle', 'tax', 'vatNumber', 'tinNumber'];

const isOn = (value: unknown) => value !== 'false' && value !== false;

export function receiptShowFromSettings(settings?: Record<string, any> | null): ReceiptShow {
  const out = {} as ReceiptShow;
  for (const o of RECEIPT_OPTIONS) out[o.key] = isOn(settings?.[o.setting]);
  return out;
}

/** What actually prints: Settings' choices, plus ZIMRA's must-haves on a fiscalised receipt. */
export function effectiveReceiptShow(show: Partial<ReceiptShow> | undefined, fiscalised: boolean): ReceiptShow {
  const out = {} as ReceiptShow;
  for (const o of RECEIPT_OPTIONS) out[o.key] = show?.[o.key] !== false;
  if (fiscalised) for (const k of ZIMRA_REQUIRED) out[k] = true;
  return out;
}
