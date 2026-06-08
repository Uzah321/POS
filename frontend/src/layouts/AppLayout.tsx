import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package, Warehouse, Truck, Users,
  BarChart2, Receipt, Settings, LogOut, ChevronLeft, ChevronRight,
  Bell, Store, CreditCard, Menu, DollarSign, ClipboardList, UserCog,
  Search, History, Clock, CalendarCheck, Cpu, BookOpen, FileText,
  ArrowRightLeft, ClipboardCheck, UserCheck, TrendingUp, Shield,
  Zap, Database, Key, ChevronDown, Smartphone, Banknote, PieChart,
  Building2, GitCompare
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { authApi, currenciesApi } from '../api';
import toast from 'react-hot-toast';

type NavItem = { to: string; label: string; icon: React.ElementType; perm: string };
type NavGroup = { id: string; label: string; icon: React.ElementType; items: NavItem[] };

const topItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'view_dashboard' },
  { to: '/pos', label: 'Register', icon: ShoppingCart, perm: 'create_sales' },
  { to: '/my-sales', label: 'My Sales', icon: History, perm: 'create_sales' },
  { to: '/ecocash', label: 'EcoCash', icon: Smartphone, perm: 'create_sales' },
  { to: '/shift-end', label: 'Shift End', icon: Clock, perm: 'create_sales' },
];

const navGroups: NavGroup[] = [
  {
    id: 'sales',
    label: 'Sales',
    icon: Receipt,
    items: [
      { to: '/orders', label: 'Orders', icon: ClipboardList, perm: 'view_sales' },
      { to: '/sales', label: 'Sales History', icon: Receipt, perm: 'view_sales' },
      { to: '/laybys', label: 'Layby', icon: BookOpen, perm: 'create_sales' },
      { to: '/quotations', label: 'Quotations', icon: FileText, perm: 'create_sales' },
      { to: '/customers', label: 'Customers', icon: Users, perm: 'view_customers' },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Warehouse,
    items: [
      { to: '/products', label: 'Products', icon: Package, perm: 'view_products' },
      { to: '/inventory', label: 'Stock Levels', icon: Warehouse, perm: 'view_inventory' },
      { to: '/stocktake', label: 'Stocktake', icon: ClipboardCheck, perm: 'view_inventory' },
      { to: '/stock-reconciliation', label: 'Reconciliation', icon: GitCompare, perm: 'view_inventory' },
      { to: '/stock-transfers', label: 'Transfers', icon: ArrowRightLeft, perm: 'view_inventory' },
      { to: '/purchases', label: 'Purchases', icon: Truck, perm: 'view_purchase_orders' },
      { to: '/suppliers', label: 'Suppliers', icon: Store, perm: 'view_suppliers' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: Banknote,
    items: [
      { to: '/financial-report', label: 'Financial Report', icon: PieChart, perm: 'view_reports' },
      { to: '/ecocash', label: 'EcoCash', icon: Smartphone, perm: 'view_reports' },
      { to: '/cashflow', label: 'Cashflow', icon: Banknote, perm: 'view_reports' },
      { to: '/salaries', label: 'Salaries', icon: Users, perm: 'view_reports' },
      { to: '/rentals', label: 'Rentals', icon: Building2, perm: 'view_reports' },
      { to: '/expenses', label: 'Expenses', icon: CreditCard, perm: 'view_expenses' },
      { to: '/commissions', label: 'Commissions', icon: TrendingUp, perm: 'view_reports' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart2,
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart2, perm: 'view_reports' },
      { to: '/day-end', label: 'Day End', icon: CalendarCheck, perm: 'view_reports' },
      { to: '/attendance', label: 'Attendance', icon: UserCheck, perm: 'view_reports' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: Settings,
    items: [
      { to: '/branches', label: 'Branches', icon: Building2, perm: 'manage_settings' },
      { to: '/users', label: 'Staff', icon: UserCog, perm: 'manage_users' },
      { to: '/roles-permissions', label: 'Roles & Perms', icon: Key, perm: 'manage_settings' },
      { to: '/settings', label: 'Settings', icon: Settings, perm: 'manage_settings' },
      { to: '/currencies', label: 'Currencies', icon: DollarSign, perm: 'manage_settings' },
      { to: '/hardware', label: 'Hardware', icon: Cpu, perm: 'manage_settings' },
      { to: '/webhooks', label: 'Webhooks', icon: Zap, perm: 'manage_settings' },
      { to: '/backups', label: 'Backups', icon: Database, perm: 'manage_settings' },
      { to: '/audit-logs', label: 'Audit Log', icon: Shield, perm: 'manage_settings' },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const { user, clearAuth, hasPermission, hasRole } = useAuthStore();
  const isCashier = hasRole('cashier');
  const { currencies, activeCurrency, setCurrencies, setActiveCurrency } = useCurrencyStore();
  const location = useLocation();
  const navigate = useNavigate();

  // Auto-open the group containing the active route
  useEffect(() => {
    const activeGroup = navGroups.find(g =>
      g.items.some(i => location.pathname === i.to || (i.to !== '/' && location.pathname.startsWith(i.to)))
    );
    if (activeGroup) {
      setOpenGroups(prev => new Set([...prev, activeGroup.id]));
    }
  }, [location.pathname]);

  useEffect(() => {
    currenciesApi.list().then(res => {
      const list = res.data.data ?? res.data;
      if (Array.isArray(list)) setCurrencies(list);
    }).catch(() => {});
  }, []);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    clearAuth();
    navigate('/login');
    toast.success('Logged out');
  };

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const canSee = (perm: string) =>
    !isCashier && (hasPermission(perm) || user?.roles?.includes('admin'));

  const userInitials = user?.name
    ? user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  const NavLink = ({ to, label, icon: Icon, indent = false }: {
    to: string; label: string; icon: React.ElementType; indent?: boolean;
  }) => {
    const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
    return (
      <Link
        to={to}
        onClick={() => setMobileOpen(false)}
        title={collapsed ? label : undefined}
        className={`flex items-center gap-3 rounded-xl transition-all text-sm font-medium
          ${indent && !collapsed ? 'pl-9 pr-3 py-1.5' : 'px-3 py-2'}
          ${active
            ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
      >
        <Icon size={15} className="flex-shrink-0" />
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    );
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white border-r border-gray-100 shadow-sm">
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 h-16 border-b border-gray-100 flex-shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-white text-lg flex-shrink-0">D</div>
        {!collapsed && (
          <div>
            <span className="font-bold text-gray-900 text-base leading-tight block">DiaperMart Store</span>
            <span className="text-xs text-gray-400 truncate block">{user?.branch?.name ?? 'Main Branch'}</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {/* Top flat items */}
        {topItems
          .filter(item => {
            if (isCashier) return ['/pos', '/my-sales', '/ecocash', '/shift-end'].includes(item.to);
            return canSee(item.perm);
          })
          .map(item => <NavLink key={item.to} {...item} />)}

        {/* Dropdown groups — hidden for cashiers */}
        {!isCashier && (
          <div className="pt-2 space-y-0.5">
            {navGroups.map(group => {
              const visibleItems = group.items.filter(i => canSee(i.perm));
              if (visibleItems.length === 0) return null;

              const isOpen = openGroups.has(group.id);
              const groupActive = visibleItems.some(i =>
                location.pathname === i.to || (i.to !== '/' && location.pathname.startsWith(i.to))
              );
              const GroupIcon = group.icon;

              return (
                <div key={group.id}>
                  {/* Group trigger button */}
                  <button
                    onClick={() => !collapsed && toggleGroup(group.id)}
                    title={collapsed ? group.label : undefined}
                    className={`w-full flex items-center rounded-xl text-sm font-semibold transition-all px-3 py-2
                      ${groupActive && !isOpen ? 'bg-blue-50 text-blue-700'
                        : isOpen ? 'bg-gray-100 text-gray-800'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
                      ${collapsed ? 'justify-center' : 'justify-between'}`}
                  >
                    <span className={`flex items-center ${collapsed ? '' : 'gap-3'}`}>
                      <GroupIcon size={16} className="flex-shrink-0" />
                      {!collapsed && <span>{group.label}</span>}
                    </span>
                    {!collapsed && (
                      <ChevronDown
                        size={14}
                        className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    )}
                  </button>

                  {/* Expanded items */}
                  {!collapsed && isOpen && (
                    <div className="mt-0.5 mb-1 space-y-0.5">
                      {visibleItems.map(item => <NavLink key={item.to} {...item} indent />)}
                    </div>
                  )}

                  {/* Collapsed sidebar: show all icons stacked under group icon */}
                  {collapsed && visibleItems.map(item => <NavLink key={item.to} {...item} />)}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* User */}
      <div className="border-t border-gray-100 p-3 flex-shrink-0">
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
        <header className="bg-white border-b border-gray-100 h-16 flex items-center px-5 gap-4 flex-shrink-0">
          <button className="md:hidden text-gray-500 hover:text-gray-800" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>

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
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-red-600 px-3 py-2 rounded-xl hover:bg-red-50 transition-colors"
          >
            <LogOut size={16} />
            <span className="hidden lg:inline">Logout</span>
          </button>

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

          <button className="relative text-gray-400 hover:text-blue-600 transition-colors p-1.5 rounded-lg hover:bg-blue-50">
            <Bell size={19} />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>

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

        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
