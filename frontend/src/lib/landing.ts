import { effectiveShop } from './shops';

// The login page's Front/Back of House choice. Signing in flips the guest-only
// guard on /login, which redirects immediately — it reads this to send the
// user where they chose instead of the generic landing.
const CHOSEN_DESTINATION_KEY = 'core-login-destination';

export function setChosenDestination(path: string) {
  try { sessionStorage.setItem(CHOSEN_DESTINATION_KEY, path); } catch { /* storage unavailable */ }
}

export function takeChosenDestination(): string | null {
  try {
    const path = sessionStorage.getItem(CHOSEN_DESTINATION_KEY);
    sessionStorage.removeItem(CHOSEN_DESTINATION_KEY);
    return path;
  } catch {
    return null;
  }
}

interface LandingUser {
  roles?: string[];
  permissions?: string[];
  business_type?: 'restaurant' | 'supermarket' | null;
}

/** The till this user punches orders on (front of house). */
export function frontOfHousePath(user: LandingUser): string {
  return effectiveShop(user.business_type) === 'supermarket' ? '/cashier' : '/pos';
}

/**
 * Where a user lands after signing in:
 * - cashiers and waiters (front of house only) go straight to their till;
 * - staff who can both take orders and manage the business (admin, manager)
 *   pick Front of House or Back of House on /start;
 * - everyone else (e.g. accountant, storekeeper) goes to the dashboard.
 */
export function landingPath(user: LandingUser): string {
  const roles = user.roles ?? [];
  const isAdmin = roles.includes('admin');
  const can = (perm: string) => isAdmin || (user.permissions ?? []).includes(perm);

  if (roles.includes('cashier') || roles.includes('waiter')) return frontOfHousePath(user);
  const front = can('create_sales');
  const back = can('view_dashboard');
  if (front && back) return '/start';
  if (front) return frontOfHousePath(user);
  return '/';
}
