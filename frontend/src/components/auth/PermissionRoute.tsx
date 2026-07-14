import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

/**
 * Gates a single route by permission — admins always pass, everyone else needs
 * the given permission string. Mirrors AppLayout's `canSee()` nav-link check so a
 * page hidden from the sidebar can't be reached by typing its URL directly.
 */
export default function RequirePermission({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { hasPermission, hasRole } = useAuthStore();
  if (hasRole('admin') || hasPermission(perm)) return <>{children}</>;
  return <Navigate to="/" replace />;
}
