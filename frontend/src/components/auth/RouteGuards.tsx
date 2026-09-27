import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../api';
import { landingPath, takeChosenDestination } from '../../lib/landing';

/**
 * The signed-in user's roles/permissions are cached in the browser from the
 * moment they logged in. Re-read them from the server (on load, when the tab
 * regains focus, and every minute) so a role or permission change made by an
 * admin applies without the user having to sign out and back in. Offline or
 * failed checks keep the cached copy; a 401 still signs out (lib/axios.ts).
 */
export const AUTH_ME_QUERY_KEY = ['auth-me'];

function useLiveAuth(enabled: boolean) {
  const setAuth = useAuthStore((s) => s.setAuth);
  const { data } = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: () => authApi.me().then((r) => r.data?.data ?? null),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => {
    const current = useAuthStore.getState().user;
    if (!data || !current || data.id !== current.id) return;
    const changed = ['roles', 'permissions', 'business_type', 'branch', 'name']
      .some((k) => JSON.stringify((data as any)[k]) !== JSON.stringify((current as any)[k]));
    if (changed) setAuth({ ...current, ...data });
  }, [data, setAuth]);
}

export function ProtectedRoute() {
  const user = useAuthStore((s: any) => s.user);
  useLiveAuth(!!user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

export function GuestRoute() {
  const { user } = useAuthStore();
  if (!user) return <Outlet />;
  // Already signed in: same landing as a fresh sign-in (till, dashboard, or the Front/Back of House choice)
  return <Navigate to={takeChosenDestination() ?? landingPath(user)} replace />;
}

// Restricts cashiers to the POS page only — redirects them away from admin pages
export function StaffOnlyRoute() {
  const { user, hasRole } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  if (hasRole('cashier')) return <Navigate to="/pos" replace />;
  return <Outlet />;
}
