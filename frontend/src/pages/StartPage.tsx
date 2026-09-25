import { useNavigate } from 'react-router-dom';
import { ShoppingCart, LayoutDashboard, LogOut } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api';
import { frontOfHousePath } from '../lib/landing';

// Shown right after sign-in to staff who work both sides (admin, manager):
// Front of House is the till where orders are punched; Back of House is the
// dashboard and everything behind it (products, stock, reports, settings).
export default function StartPage() {
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();

  const choices = [
    {
      title: 'Front of House',
      description: 'Advanced POS — punch orders, tables and tabs',
      icon: ShoppingCart,
      to: user ? frontOfHousePath(user) : '/pos',
      accent: 'bg-blue-600',
    },
    {
      title: 'Back of House',
      description: 'Dashboard, products, stock, reports and settings',
      icon: LayoutDashboard,
      to: '/',
      accent: 'bg-slate-800',
    },
  ];

  const signOut = async () => {
    try { await authApi.logout(); } catch { /* signing out locally regardless */ }
    clearAuth();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 flex items-center justify-center p-4">
      <div className="relative bg-white rounded-lg shadow-2xl w-full max-w-2xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Welcome, {user?.name ?? 'back'}</h1>
          <p className="text-gray-500 text-sm mt-1">Where are you working?</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {choices.map(({ title, description, icon: Icon, to, accent }) => (
            <button
              key={title}
              type="button"
              onClick={() => navigate(to, { replace: true })}
              className="group flex flex-col items-center text-center gap-3 border-2 border-gray-100 hover:border-blue-500 rounded-lg p-6 transition-colors touch-manipulation"
            >
              <span className={`${accent} text-white w-16 h-16 flex items-center justify-center rounded-lg`}>
                <Icon size={30} />
              </span>
              <span className="text-lg font-bold text-gray-900">{title}</span>
              <span className="text-sm text-gray-500">{description}</span>
            </button>
          ))}
        </div>

        <button type="button" onClick={signOut}
          className="mt-6 mx-auto flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600">
          <LogOut size={13} /> Not you? Sign out
        </button>
      </div>
    </div>
  );
}
