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
