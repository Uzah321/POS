export type Shop = 'restaurant' | 'supermarket';

/**
 * Whether this installation offers the supermarket side at all. A
 * restaurant-only deployment builds with VITE_SUPERMARKET_ENABLED=false
 * (e.g. in frontend/.env.production.local on that server, which git ignores)
 * and the frontend then never offers, shows or opens the supermarket. Nothing
 * is deleted: the backend, data and pages all stay, so turning it back on is
 * just removing that line and rebuilding.
 */
export const SUPERMARKET_ENABLED = import.meta.env.VITE_SUPERMARKET_ENABLED !== 'false';

/**
 * The shop to actually use for a stored setting or user assignment. With the
 * supermarket disabled everything resolves to the restaurant, including an
 * unset mode — so there's no first-run "which shop?" choice either.
 */
export function effectiveShop(shop: Shop | null | undefined): Shop | null {
  if (!SUPERMARKET_ENABLED) return 'restaurant';
  return shop ?? null;
}
