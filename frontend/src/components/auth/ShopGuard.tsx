import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

/**
 * Keeps a user assigned to one shop on that shop's till: a supermarket cashier who
 * opens /pos (or a restaurant cashier who opens /cashier) is sent to their own.
 * Admins and unassigned users are never redirected.
 */
export default function ShopGuard({ shop, children }: { shop: 'restaurant' | 'supermarket'; children: React.ReactNode }) {
  const assigned = useAuthStore((s) => s.user?.business_type);
  const isAdmin = useAuthStore((s) => s.user?.roles?.includes('admin') ?? false);

  if (assigned && !isAdmin && assigned !== shop) {
    return <Navigate to={assigned === 'supermarket' ? '/cashier' : '/pos'} replace />;
  }
  return <>{children}</>;
}
