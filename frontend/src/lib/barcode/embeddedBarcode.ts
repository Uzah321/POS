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

// What a field left blank in Settings → Barcodes means — the placeholders
// shown there, so a layout that looks filled in really is. The weight one is
// the counter scale's label: flag "20", a 3-digit PLU code from digit 4 and a
// 5-digit weight in grams from digit 8 — and it's on until switched off, so
// those labels ring up without a trip to Settings first (a product's own
// barcode that happens to start with 20 still wins: the tills try an exact
// barcode match before decoding). The server's product searches assume the
// same (App\Support\ScaleBarcode).
const LAYOUT_DEFAULTS = {
  barcode_weight: { enabled: true, prefix: '20', codePosition: 4, codeLength: 3, valuePosition: 8, valueLength: 5, decimalPoint: 3 },
  barcode_price: { enabled: false, prefix: '2', codePosition: 4, codeLength: 4, valuePosition: 9, valueLength: 4, decimalPoint: 2 },
};

/** Whether a layout is on: as saved in Settings, or its default when it never was. */
export function layoutEnabled(settings: Record<string, any>, prefix: 'barcode_weight' | 'barcode_price'): boolean {
  const saved = settings[`${prefix}_enabled`];
  return saved == null || saved === '' ? LAYOUT_DEFAULTS[prefix].enabled : toBool(saved);
}

function readSpec(settings: Record<string, any>, prefix: 'barcode_weight' | 'barcode_price'): DecodeSpec {
  const defaults = LAYOUT_DEFAULTS[prefix];
  const valueKey = prefix === 'barcode_weight' ? 'qty' : 'value';
  const text = (field: string) => String(settings[`${prefix}_${field}`] ?? '').trim();
  const num = (field: string, fallback: number) => (text(field) === '' ? fallback : toInt(text(field)));
  const flag = text('prefix') || defaults.prefix;
  return {
    enabled: layoutEnabled(settings, prefix),
    prefix: flag,
    // The prefix's own length — a separate "Prefix Length" setting left blank
    // used to switch decoding off without saying why.
    prefixLength: flag.length,
    codePosition: num('code_position', defaults.codePosition),
    codeLength: num('code_length', defaults.codeLength),
    valuePosition: num(`${valueKey}_position`, defaults.valuePosition),
    valueLength: num(`${valueKey}_length`, defaults.valueLength),
    decimalPoint: num('decimal_point', defaults.decimalPoint),
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

type PluProduct = { plu_code?: string | null; sku?: string | null; barcode?: string | null; sold_by_weight?: boolean };

// The product's PLU Code first (a sold-by-weight one if two share it), then
// its SKU or Barcode — where a shop coming from another till may have put
// the scale's item code instead.
export function findProductByPlu<T extends PluProduct>(products: T[], pluCode: string): T | undefined {
  const want = normalizePlu(pluCode);
  const same = (v: unknown) => v != null && String(v).trim() !== '' && normalizePlu(String(v)) === want;
  return products.find((p) => p.sold_by_weight && same(p.plu_code))
    ?? products.find((p) => same(p.plu_code))
    ?? products.find((p) => same(p.sku))
    ?? products.find((p) => same(p.barcode));
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
    [`${key}_code_position`]: String(layout.codePosition),
    [`${key}_code_length`]: String(layout.codeLength),
    [`${key}_${valueKey}_position`]: String(layout.valuePosition),
    [`${key}_${valueKey}_length`]: String(layout.valueLength),
    [`${key}_decimal_point`]: kind === 'weight' ? '3' : '2',
  };
}

// EAN-13's own check digit (the last one) — proves the scan wasn't misread.
function ean13Valid(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const sum = [...code.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

// The GS1 check digit for a 4- or 5-digit price/weight: the XCD a DIGI
// scale prints just before the value. Weighting tables "2-", "3", "5+" and
// "5-" from the GS1 General Specifications.
const W2M = [0, 2, 4, 6, 8, 9, 1, 3, 5, 7];
const W3 = [0, 3, 6, 9, 2, 5, 8, 1, 4, 7];
const W5P = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9];
const W5M = [0, 5, 9, 4, 8, 3, 7, 2, 6, 1];
function valueCheckDigit(value: string): number | null {
  const d = [...value].map(Number);
  if (d.length === 4) return ((W2M[d[0]] + W2M[d[1]] + W3[d[2]] + W5M[d[3]]) * 3) % 10;
  if (d.length === 5) return W5M.indexOf((10 - ((W5P[d[0]] + W2M[d[1]] + W5M[d[2]] + W5P[d[3]] + W2M[d[4]]) % 10)) % 10);
  return null;
}

export interface ScaleLabelReading<T> {
  layout: ScaleBarcodeLayout;
  /** The flag digits as printed on this label. */
  flag: string;
  pluCode: string;
  /** The weight/price digits, before any decimal point. */
  digits: string;
  product: T;
}

/**
 * The DIGI layouts this label could have been printed with, worked out from
 * the label alone: only layouts that carry a check digit for the
 * weight/price, only where that check digit and the barcode's own both hold,
 * and only where the item code is one of the products. Whether the digits
 * are a weight or a price the label can't say.
 */
export function readScaleLabel<T extends PluProduct>(code: string, products: T[], minCodePosition = 2): ScaleLabelReading<T>[] {
  if (!ean13Valid(code)) return [];
  return DIGI_SM110_LAYOUTS
    .filter((l) => l.pattern.includes('XCD') && l.codePosition >= minCodePosition)
    .flatMap((layout) => {
      const digits = code.slice(layout.valuePosition - 1, layout.valuePosition - 1 + layout.valueLength);
      if (valueCheckDigit(digits) !== Number(code[layout.valuePosition - 2]) || !/[1-9]/.test(digits)) return [];
      const pluCode = code.slice(layout.codePosition - 1, layout.codePosition - 1 + layout.codeLength);
      const product = findProductByPlu(products, pluCode);
      return product ? [{ layout, flag: code.slice(0, layout.flagLength), pluCode, digits, product }] : [];
    });
}

/** Several layouts reading the same item and amount are one answer; anything else is a guess. */
export function singleReading<T>(readings: ScaleLabelReading<T>[]): ScaleLabelReading<T> | null {
  return readings.length > 0 && readings.every((r) => r.product === readings[0].product && Number(r.digits) === Number(readings[0].digits))
    ? readings[0]
    : null;
}

export interface ResolvedLabel<T> {
  decoded: EmbeddedBarcodeResult;
  product?: T;
  /** Set when the label was read from its own check digits, not the positions in Settings. */
  layout?: ScaleBarcodeLayout;
  /** The positions in Settings and the label's check digits name different items — nothing is rung up. */
  conflict?: boolean;
}

// Positions that read every digit from the flag to the barcode's check digit
// (bar one between code and value, for a check digit or a fixed 0) are a
// layout set up on purpose. Gaps mean they were probably counted another way.
function readsWholeLabel(spec: DecodeSpec, length: number): boolean {
  const gap = spec.valuePosition - (spec.codePosition + spec.codeLength);
  return spec.codePosition === spec.prefixLength + 1 && (gap === 0 || gap === 1) && spec.valuePosition + spec.valueLength === length;
}

/**
 * A scanned scale label and the product it rings up. Decoded with the
 * positions in Settings → Barcodes; when those find no product, or skip
 * digits the way positions copied from another till (counted differently)
 * do, the label is also read by its own check digits under the flag and
 * weight-or-price choice from Settings. If the two name different items
 * nothing is rung up rather than guessing. Null when the code isn't a scale
 * label at all.
 */
export function resolveEmbeddedBarcode<T extends PluProduct>(code: string, settings: Record<string, any>, products: T[]): ResolvedLabel<T> | null {
  const trimmed = code.trim();
  const decoded = decodeEmbeddedBarcode(trimmed, settings);
  const product = decoded ? findProductByPlu(products, decoded.pluCode) : undefined;
  if (decoded && product
    && readsWholeLabel(readSpec(settings, decoded.kind === 'weight' ? 'barcode_weight' : 'barcode_price'), trimmed.length)) {
    return { decoded, product };
  }

  const readings = checkDigitReadings(trimmed, settings, products);
  const same = (a: ResolvedLabel<T>, b: ResolvedLabel<T>) => a.product === b.product && Math.abs(a.decoded.value - b.decoded.value) < 1e-9;
  if (decoded && product) {
    const mine = { decoded, product };
    return readings.every((r) => same(r, mine)) ? mine : { decoded, conflict: true };
  }
  if (readings.length > 0) {
    return readings.every((r) => same(r, readings[0])) ? readings[0] : { decoded: readings[0].decoded, conflict: true };
  }
  return decoded ? { decoded } : null;
}

// readScaleLabel() under the flag and weight-or-price choice from Settings.
function checkDigitReadings<T extends PluProduct>(code: string, settings: Record<string, any>, products: T[]): ResolvedLabel<T>[] {
  for (const kind of ['weight', 'price'] as const) {
    const spec = readSpec(settings, kind === 'weight' ? 'barcode_weight' : 'barcode_price');
    if (!spec.enabled || !spec.prefix || !code.startsWith(spec.prefix)) continue;
    return readScaleLabel(code, products, spec.prefixLength + 1).map((r) => ({
      decoded: { kind, pluCode: r.pluCode, value: parseInt(r.digits, 10) / 10 ** spec.decimalPoint },
      product: r.product,
      layout: r.layout,
    }));
  }
  return [];
}

/**
 * The products a search box's text names by PLU code: the one a scale label
 * scanned (or typed) into it rings up at the till, and any whose PLU Code is
 * the text itself. Leading zeros don't matter. Goes alongside a list's own
 * name/SKU/barcode matching — the server's product searches do the same
 * (App\Support\ScaleBarcode).
 */
export function productsNamedByPlu<T extends PluProduct>(query: string, settings: Record<string, any>, products: T[]): Set<T> {
  const found = new Set<T>();
  const q = query.trim();
  if (!/^\d+$/.test(q)) return found;
  const typed = normalizePlu(q);
  for (const p of products) {
    if (p.plu_code != null && String(p.plu_code).trim() !== '' && normalizePlu(String(p.plu_code)) === typed) found.add(p);
  }
  const label = resolveEmbeddedBarcode(q, settings, products);
  if (label?.product) found.add(label.product);
  return found;
}
