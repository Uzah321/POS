import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package, Warehouse, Truck, Users,
  BarChart2, Receipt, Settings, LogOut, ChevronLeft, ChevronRight,
  Bell, Store, CreditCard, Menu, DollarSign, ClipboardList, UserCog,
  Search, History
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { authApi, currenciesApi } from '../api';
import toast from 'react-hot-toast';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'view_dashboard' },
  { to: '/pos', label: 'Register', icon: ShoppingCart, perm: 'create_sales' },
  { to: '/my-sales', label: 'My Sales', icon: History, perm: 'create_sales' },
  { to: '/orders', label: 'Orders', icon: ClipboardList, perm: 'view_sales' },
  { to: '/products', label: 'Menu & Stock', icon: Package, perm: 'view_products' },
  { to: '/inventory', label: 'Inventory', icon: Warehouse, perm: 'view_inventory' },
  { to: '/purchases', label: 'Purchases', icon: Truck, perm: 'view_purchase_orders' },
  { to: '/suppliers', label: 'Suppliers', icon: Store, perm: 'view_suppliers' },
  { to: '/customers', label: 'Customers', icon: Users, perm: 'view_customers' },
  { to: '/expenses', label: 'Expenses', icon: CreditCard, perm: 'view_expenses' },
  { to: '/sales', label: 'Sales History', icon: Receipt, perm: 'view_sales' },
  { to: '/reports', label: 'Reports', icon: BarChart2, perm: 'view_reports' },
  { to: '/users', label: 'Staff', icon: UserCog, perm: 'manage_users' },
  { to: '/currencies', label: 'Currencies', icon: DollarSign, perm: 'manage_settings' },
  { to: '/settings', label: 'Settings', icon: Settings, perm: 'manage_settings' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, clearAuth, hasPermission, hasRole } = useAuthStore();
  const isCashier = hasRole('cashier');
  const { currencies, activeCurrency, setCurrencies, setActiveCurrency } = useCurrencyStore();

  useEffect(() => {
    currenciesApi.list().then(res => {
      const list = res.data.data ?? res.data;
      if (Array.isArray(list)) setCurrencies(list);
    }).catch(() => {});
  }, []);

  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    clearAuth();
    navigate('/login');
    toast.success('Logged out');
  };

  const userInitials = user?.name
    ? user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white border-r border-gray-100 shadow-sm">
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 h-16 border-b border-gray-100 flex-shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-white text-lg flex-shrink-0">N</div>
        {!collapsed && (
          <div>
            <span className="font-bold text-gray-900 text-base leading-tight block">NexaPOS</span>
            <span className="text-xs text-gray-400 truncate block">{user?.branch?.name ?? 'Main Branch'}</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navItems
          .filter(item => {
            // Cashiers see only the POS register and their order history
            if (isCashier) return item.to === '/pos' || item.to === '/my-sales';
            return hasPermission(item.perm) || user?.roles?.includes('admin');
          })
          .map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 transition-all text-sm font-medium
                  ${active
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
              >
                <Icon size={17} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </Link>
            );
          })}
      </nav>

      {/* User section */}
      <div className={`border-t border-gray-100 p-3 flex-shrink-0`}>
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 capitalize truncate">{user?.roles?.[0] ?? 'user'}</p>
            </div>
            <button type="button" onClick={handleLogout} title="Logout" className="text-gray-400 hover:text-red-500 transition-colors">
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={handleLogout} className="w-full flex justify-center text-gray-400 hover:text-red-500">
            <LogOut size={16} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-56'} flex-shrink-0 relative`}>
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-16 bg-white text-gray-500 rounded-full p-0.5 border border-gray-200 shadow-sm z-10 hover:text-blue-600"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-56 h-full z-50"><SidebarContent /></aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="bg-white border-b border-gray-100 h-16 flex items-center px-5 gap-4 flex-shrink-0">
          <button className="md:hidden text-gray-500 hover:text-gray-800" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>

          {/* Search bar — hidden for cashiers (they use the POS search) */}
          {!isCashier && (
            <div className="hidden sm:flex flex-1 max-w-sm items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <Search size={15} className="text-gray-400 flex-shrink-0" />
              <input
                type="text"
                placeholder="Search products, sales..."
                className="bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none w-full"
              />
            </div>
          )}
          {isCashier && (
            <div className="hidden sm:flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-1.5">
              <ShoppingCart size={14} className="text-blue-600" />
              <span className="text-sm font-semibold text-blue-700">Cashier Mode</span>
            </div>
          )}

          <div className="flex-1 sm:flex-none" />

          <button
            type="button"
            onClick={handleLogout}
            title="Logout"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-red-600 px-3 py-2 rounded-xl hover:bg-red-50 transition-colors"
          >
            <LogOut size={16} />
            <span className="hidden lg:inline">Logout</span>
          </button>

          {/* Currency selector */}
          <select
            value={activeCurrency?.code ?? 'USD'}
            onChange={(e) => {
              const c = currencies.find(x => x.code === e.target.value);
              if (c) setActiveCurrency(c);
            }}
            className="border border-gray-200 bg-gray-50 text-gray-700 text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {currencies.filter(c => c.is_active).map(c => (
              <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
            ))}
          </select>

          {/* Notification bell */}
          <button className="relative text-gray-400 hover:text-blue-600 transition-colors p-1.5 rounded-lg hover:bg-blue-50">
            <Bell size={19} />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>

          {/* User avatar */}
          <div className="flex items-center gap-2.5 pl-1">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
              {userInitials}
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-gray-900 leading-tight">{user?.name}</p>
              <p className="text-xs text-gray-400 capitalize leading-tight">{user?.roles?.[0]}</p>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
