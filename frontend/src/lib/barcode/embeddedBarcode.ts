/**
 * Embedded weight/price barcode decoding — the standard supermarket-scale
 * convention where a printed barcode's digits encode a short PLU
 * (department/product) code plus a weight or price, instead of the barcode
 * being a literal SKU to look up. Configured in Settings → Barcodes as a
 * prefix (which digits identify this as an embedded barcode at all) plus
 * 1-indexed position/length pairs for the PLU code and the weight/price.
 *
 * Returns null whenever the code doesn't match a configured prefix (or the
 * feature is disabled/unconfigured) — callers fall through to their normal
 * exact-match barcode/SKU lookup in that case, so this never changes
 * behavior for a store that hasn't set this up.
 */
export interface EmbeddedBarcodeResult {
  kind: 'weight' | 'price';
  pluCode: string;
  value: number;
}

interface DecodeSpec {
  enabled: boolean;
  prefix: string;
  prefixLength: number;
  codePosition: number;
  codeLength: number;
  valuePosition: number;
  valueLength: number;
  decimalPoint: number;
}

function toBool(v: unknown): boolean {
  return v === true || v === 'true';
}

function toInt(v: unknown, fallback = 0): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function readSpec(settings: Record<string, any>, prefix: 'barcode_weight' | 'barcode_price'): DecodeSpec {
  return {
    enabled: toBool(settings[`${prefix}_enabled`]),
    prefix: String(settings[`${prefix}_prefix`] ?? ''),
    prefixLength: toInt(settings[`${prefix}_prefix_length`]),
    codePosition: toInt(settings[`${prefix}_code_position`]),
    codeLength: toInt(settings[`${prefix}_code_length`]),
    valuePosition: toInt(settings[`${prefix}_${prefix === 'barcode_weight' ? 'qty' : 'value'}_position`]),
    valueLength: toInt(settings[`${prefix}_${prefix === 'barcode_weight' ? 'qty' : 'value'}_length`]),
    decimalPoint: toInt(settings[`${prefix}_decimal_point`]),
  };
}

// 1-indexed, inclusive-of-length slice (matches how the Settings UI and the
// reference system describe "Position 4, Length 3" — the 3 characters
// starting at the 4th digit of the barcode).
function slice(code: string, position: number, length: number): string | null {
  if (position < 1 || length < 1) return null;
  const start = position - 1;
  if (start + length > code.length) return null;
  return code.slice(start, start + length);
}

function tryDecode(code: string, spec: DecodeSpec, kind: 'weight' | 'price'): EmbeddedBarcodeResult | null {
  if (!spec.enabled || !spec.prefix || spec.prefixLength < 1) return null;
  if (code.length < spec.prefixLength) return null;
  if (code.slice(0, spec.prefixLength) !== spec.prefix) return null;

  const pluCode = slice(code, spec.codePosition, spec.codeLength);
  const rawValue = slice(code, spec.valuePosition, spec.valueLength);
  if (pluCode == null || rawValue == null) return null;
  if (!/^\d+$/.test(rawValue)) return null;

  const divisor = 10 ** Math.max(0, spec.decimalPoint);
  const value = parseInt(rawValue, 10) / divisor;
  if (!Number.isFinite(value) || value <= 0) return null;

  return { kind, pluCode, value };
}

export function decodeEmbeddedBarcode(code: string, settings: Record<string, any>): EmbeddedBarcodeResult | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (!/^\d+$/.test(trimmed)) return null; // embedded barcodes are numeric-only (EAN-13 style)

  return (
    tryDecode(trimmed, readSpec(settings, 'barcode_weight'), 'weight') ??
    tryDecode(trimmed, readSpec(settings, 'barcode_price'), 'price')
  );
}

// A scale zero-pads its item code to the barcode's fixed width (item 12 is
// printed as "00012"), while the product's PLU Code was most likely typed
// as "12" — compare the numbers, not the padding.
export function normalizePlu(code: string): string {
  return code.trim().replace(/^0+(?=\d)/, '');
}

export function findProductByPlu<T extends { plu_code?: string | null; sold_by_weight?: boolean }>(products: T[], pluCode: string): T | undefined {
  const want = normalizePlu(pluCode);
  return products.find((p) => p.sold_by_weight && !!p.plu_code && normalizePlu(String(p.plu_code)) === want);
}

/**
 * What a decoded label puts in the cart. A weight label is that many kg at
 * the product's own price per kg. A price label charges exactly the printed
 * amount — the weight is worked back out from the product's price per kg so
 * stock comes off by the kg that actually left the counter (not 1), and the
 * line's unit price is nudged so qty × price still equals the printed
 * amount. With no price per kg to work from, it falls back to one item at
 * the printed amount.
 */
export function embeddedCartLine(decoded: EmbeddedBarcodeResult, pricePerKg: number): { qty: number; soldByWeight: boolean; price?: number } {
  if (decoded.kind === 'weight') return { qty: decoded.value, soldByWeight: true };
  if (pricePerKg > 0) {
    const kg = Math.round((decoded.value / pricePerKg) * 1000) / 1000;
    if (kg > 0) return { qty: kg, soldByWeight: true, price: decoded.value / kg };
  }
  return { qty: 1, soldByWeight: false, price: decoded.value };
}

/**
 * The 13-digit item barcode layouts a DIGI SM-100 / SM-110 label scale can
 * print — its SPEC 00 "Item Barcode" list, numbered as in the scale's manual
 * so a technician can match them up. F = flag, C = item code, X = the price
 * or weight (the scale's SPEC 01 picks which), XCD = a check digit for X,
 * CD = the EAN-13 check digit. Positions are 1-indexed, as in Settings.
 */
export interface ScaleBarcodeLayout {
  spec: number;
  pattern: string;
  flagLength: number;
  codePosition: number;
  codeLength: number;
  valuePosition: number;
  valueLength: number;
}

export const DIGI_SM110_LAYOUTS: ScaleBarcodeLayout[] = [
  { spec: 0,  pattern: 'F1F2 CCCCC XCD XXXX CD', flagLength: 2, codePosition: 3, codeLength: 5, valuePosition: 9, valueLength: 4 },
  { spec: 1,  pattern: 'F2 CCCCCC XCD XXXX CD',  flagLength: 1, codePosition: 2, codeLength: 6, valuePosition: 9, valueLength: 4 },
  { spec: 2,  pattern: 'F1F2 CCCCC 0 XXXX CD',   flagLength: 2, codePosition: 3, codeLength: 5, valuePosition: 9, valueLength: 4 },
  { spec: 3,  pattern: 'F1F2 CCCCCC XXXX CD',    flagLength: 2, codePosition: 3, codeLength: 6, valuePosition: 9, valueLength: 4 },
  { spec: 4,  pattern: 'F1F2 CCCCC XXXXX CD',    flagLength: 2, codePosition: 3, codeLength: 5, valuePosition: 8, valueLength: 5 },
  { spec: 5,  pattern: 'F2 CCCCCC XXXXX CD',     flagLength: 1, codePosition: 2, codeLength: 6, valuePosition: 8, valueLength: 5 },
  { spec: 6,  pattern: 'F2 CCCCC XXXXXX CD',     flagLength: 1, codePosition: 2, codeLength: 5, valuePosition: 7, valueLength: 6 },
  { spec: 8,  pattern: 'F1F2 CCCC XXXXXX CD',    flagLength: 2, codePosition: 3, codeLength: 4, valuePosition: 7, valueLength: 6 },
  { spec: 14, pattern: 'F1F2 CCCC XCD XXXXX CD', flagLength: 2, codePosition: 3, codeLength: 4, valuePosition: 8, valueLength: 5 },
  { spec: 15, pattern: 'F2 CCCCC XCD XXXXX CD',  flagLength: 1, codePosition: 2, codeLength: 5, valuePosition: 8, valueLength: 5 },
  { spec: 16, pattern: 'F1F2 CCC XXXXXXX CD',    flagLength: 2, codePosition: 3, codeLength: 3, valuePosition: 6, valueLength: 7 },
  { spec: 17, pattern: 'F1F2 CC XXXXXXXX CD',    flagLength: 2, codePosition: 3, codeLength: 2, valuePosition: 5, valueLength: 8 },
];

/** The Settings → Barcodes values that decode one scale layout — prices in cents (2 decimals), weights in grams (3 decimals of a kg). */
export function scaleLayoutSettings(layout: ScaleBarcodeLayout, flag: string, kind: 'weight' | 'price'): Record<string, string> {
  const key = kind === 'weight' ? 'barcode_weight' : 'barcode_price';
  const valueKey = kind === 'weight' ? 'qty' : 'value';
  return {
    [`${key}_prefix`]: flag,
    [`${key}_prefix_length`]: String(flag.length),
    [`${key}_code_position`]: String(layout.codePosition),
    [`${key}_code_length`]: String(layout.codeLength),
    [`${key}_${valueKey}_position`]: String(layout.valuePosition),
    [`${key}_${valueKey}_length`]: String(layout.valueLength),
    [`${key}_decimal_point`]: kind === 'weight' ? '3' : '2',
  };
}
