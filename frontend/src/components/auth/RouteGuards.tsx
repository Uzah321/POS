import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export function ProtectedRoute() {
  const token = useAuthStore((s: any) => s.token);
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

export function GuestRoute() {
  const { token, hasRole } = useAuthStore();
  if (!token) return <Outlet />;
  // Cashiers go directly to the POS register on login
  return <Navigate to={hasRole('cashier') ? '/pos' : '/'} replace />;
}

// Restricts cashiers to the POS page only — redirects them away from admin pages
export function StaffOnlyRoute() {
  const { token, hasRole } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (hasRole('cashier')) return <Navigate to="/pos" replace />;
  return <Outlet />;
}
