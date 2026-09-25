import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { landingPath } from '../../lib/landing';

export function ProtectedRoute() {
  const user = useAuthStore((s: any) => s.user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

export function GuestRoute() {
  const { user } = useAuthStore();
  if (!user) return <Outlet />;
  // Already signed in: same landing as a fresh sign-in (till, dashboard, or the Front/Back of House choice)
  return <Navigate to={landingPath(user)} replace />;
}

// Restricts cashiers to the POS page only — redirects them away from admin pages
export function StaffOnlyRoute() {
  const { user, hasRole } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  if (hasRole('cashier')) return <Navigate to="/pos" replace />;
  return <Outlet />;
}
