import { productsApi } from '../api';

/**
 * Product search shared by every till and picker (the server and the Android
 * app match the same way — App\Support\ProductSearch, models.dart):
 *
 *  - every word typed appears in the product NAME, in any order — "chicken
 *    burger" finds "Burger - Chicken";
 *  - a number must be a whole number in the name, so a size finds that size:
 *    "blouse 32" finds "MINDA BLOUSE 32" but not "BLOUSE 132" — and never a
 *    product whose SKU or barcode merely contains the digits 32;
 *  - or the whole search is the product's SKU or barcode (or, from 4
 *    characters, the start of one), for typed or scanned codes.
 *
 * A scale label / PLU code is matched separately (productsNamedByPlu) by the caller.
 */
export function searchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

const DIGITS = /^\d+$/;

function wordInName(name: string, word: string): boolean {
  if (!DIGITS.test(word)) return name.includes(word);
  // A whole number: not part of a longer one ("32" in "SIZE 32" or "32CM", not "132").
  let from = 0;
  for (;;) {
    const at = name.indexOf(word, from);
    if (at < 0) return false;
    const before = at > 0 ? name[at - 1] : '';
    const after = name[at + word.length] ?? '';
    if (!/\d/.test(before) && !/\d/.test(after)) return true;
    from = at + 1;
  }
}

type Searchable = { name?: string | null; sku?: string | null; barcode?: string | null };

export function productMatchesSearch(p: Searchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (p.name ?? '').toLowerCase();
  if (searchWords(q).every((w) => wordInName(name, w))) return true;
  const sku = (p.sku ?? '').toLowerCase();
  const barcode = (p.barcode ?? '').toLowerCase();
  if (sku === q || barcode === q) return true;
  return q.length >= 4 && ((sku !== '' && sku.startsWith(q)) || (barcode !== '' && barcode.startsWith(q)));
}

/** How many matches a search dropdown lists before saying "N more — keep typing". */
export const PICKER_LIMIT = 100;

const PAGE_SIZE = 500;
const MAX_PAGES = 40; // 20,000 products — a runaway guard, not a real limit

/**
 * Every product matching `params`, not just the first page: the tills and
 * pickers search this list in the browser, so a product past the first page
 * would never turn up in a search.
 */
export async function fetchAllProducts(params: Record<string, unknown> = {}): Promise<any[]> {
  const pageOf = (page: number) => productsApi.list({ ...params, per_page: PAGE_SIZE, page }).then((r) => r.data?.data);
  const first = await pageOf(1);
  const rows: any[] = Array.isArray(first) ? first : (first?.data ?? []);
  const lastPage = Math.min(Number(first?.last_page ?? 1) || 1, MAX_PAGES);
  if (lastPage <= 1) return rows;
  const rest = await Promise.all(
    Array.from({ length: lastPage - 1 }, (_, i) => pageOf(i + 2).then((b) => (Array.isArray(b) ? b : (b?.data ?? [])))),
  );
  return rows.concat(...rest);
}
