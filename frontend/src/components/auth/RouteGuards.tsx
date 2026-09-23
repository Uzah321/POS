import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export function ProtectedRoute() {
  const user = useAuthStore((s: any) => s.user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

export function GuestRoute() {
  const { user, hasRole } = useAuthStore();
  if (!user) return <Outlet />;
  // Cashiers go directly to the POS register on login
  return <Navigate to={hasRole('cashier') ? '/pos' : '/'} replace />;
}

// Restricts cashiers to the POS page only — redirects them away from admin pages
export function StaffOnlyRoute() {
  const { user, hasRole } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  if (hasRole('cashier')) return <Navigate to="/pos" replace />;
  return <Outlet />;
}
