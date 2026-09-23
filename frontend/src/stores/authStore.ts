import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: number;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
  branch?: { id: number; name: string; address?: string; phone?: string; city?: string };
  avatar?: string;
  // Which shop this user works in. Null/absent = follows the system-wide mode.
  business_type?: 'restaurant' | 'supermarket' | null;
}

interface AuthState {
  user: User | null;
  setAuth: (user: User) => void;
  clearAuth: () => void;
  hasRole: (role: string) => boolean;
  hasPermission: (perm: string) => boolean;
}

// Auth itself is an httpOnly session cookie the browser manages — nothing
// readable by JS. `user` here is just a cache for rendering role-gated UI
// before the first API call; a 401 (see lib/axios.ts) clears it.
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      setAuth: (user) => set({ user }),
      clearAuth: () => set({ user: null }),
      hasRole: (role) => get().user?.roles?.includes(role) ?? false,
      hasPermission: (perm) => get().user?.permissions?.includes(perm) ?? false,
    }),
    { name: 'auth-storage', partialize: (s) => ({ user: s.user }) }
  )
);
