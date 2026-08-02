// Shared color logic for product/category tiles and cart-line accents —
// used by both POSPage (restaurant grid) and CashierPage (supermarket till)
// so the two feel like one visual system instead of drifting apart.

// True WCAG relative luminance (gamma-corrected) — the naive "average the
// raw 0-255 channels" shortcut misjudges saturated colors like #EF4444 red
// as "dark enough for white text" when white on that red actually falls
// below the readable contrast threshold; picking whichever candidate wins
// the real contrast-ratio comparison avoids that.
function relLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
// Picks readable text (white or near-black) for a solid tile background —
// whichever gives the higher WCAG contrast ratio against that background.
export function contrastText(hex: string): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  const bgLum = relLuminance(r, g, b);
  const whiteContrast = contrastRatio(bgLum, 1);
  const darkContrast = contrastRatio(bgLum, relLuminance(0x11, 0x18, 0x27)); // #111827
  return darkContrast >= whiteContrast ? '#111827' : '#ffffff';
}

// Mirrors the swatches shown under Settings → "Product Tile Colour Theme"
// (same Tailwind shades, as hex) — auto-assigns a color to any tile that has
// no explicit product/category color of its own, cycling deterministically
// per product id so a given item's tile doesn't change color on every render.
export const TILE_THEMES: Record<string, string[]> = {
  rainbow:    ['#bbf7d0', '#bfdbfe', '#e9d5ff', '#fed7aa', '#fbcfe8'],
  blue:       ['#dbeafe', '#bfdbfe', '#93c5fd', '#e0f2fe', '#cffafe'],
  green:      ['#dcfce7', '#d1fae5', '#ccfbf1', '#bbf7d0', '#a7f3d0'],
  warm:       ['#ffedd5', '#fef3c7', '#fef9c3', '#fee2e2', '#fce7f3'],
  monochrome: ['#f9fafb', '#f3f4f6', '#e5e7eb', '#f9fafb', '#ffffff'],
  dark:       ['#1f2937', '#374151', '#1e293b', '#27272a', '#262626'],
};

// Per-product accent colour for cart line items — distinct, stable colour per product id
export const CART_LINE_ACCENTS = [
  'border-l-emerald-400', 'border-l-blue-400', 'border-l-purple-400', 'border-l-orange-400',
  'border-l-pink-400', 'border-l-teal-400', 'border-l-amber-400', 'border-l-red-400',
  'border-l-indigo-400', 'border-l-cyan-400',
];
export function cartLineAccent(productId: number): string {
  return CART_LINE_ACCENTS[productId % CART_LINE_ACCENTS.length];
}
