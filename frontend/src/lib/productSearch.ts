import { productsApi } from '../api';

/**
 * Product search shared by every till and picker: each word typed must appear
 * somewhere in the product's name, SKU or barcode, in any order — so
 * "chicken burger" finds "Burger - Chicken" and "coke 500" finds
 * "Coke Zero 500ml". A scale label / PLU code is matched separately
 * (productsNamedByPlu) by the caller.
 */
export function searchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function productMatchesWords(p: { name?: string | null; sku?: string | null; barcode?: string | null }, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = `${p.name ?? ''} ${p.sku ?? ''} ${p.barcode ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
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
