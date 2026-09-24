import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { SUPERMARKET_ENABLED, effectiveShop } from '../../lib/shops';

/**
 * Keeps a user assigned to one shop on that shop's till: a supermarket cashier who
 * opens /pos (or a restaurant cashier who opens /cashier) is sent to their own.
 * Admins and unassigned users are never redirected — except that on an
 * installation with the supermarket disabled, nobody can open its till.
 */
export default function ShopGuard({ shop, children }: { shop: 'restaurant' | 'supermarket'; children: React.ReactNode }) {
  const assigned = effectiveShop(useAuthStore((s) => s.user?.business_type));
  const isAdmin = useAuthStore((s) => s.user?.roles?.includes('admin') ?? false);

  if (shop === 'supermarket' && !SUPERMARKET_ENABLED) {
    return <Navigate to="/pos" replace />;
  }
  if (assigned && !isAdmin && assigned !== shop) {
    return <Navigate to={assigned === 'supermarket' ? '/cashier' : '/pos'} replace />;
  }
  return <>{children}</>;
}
