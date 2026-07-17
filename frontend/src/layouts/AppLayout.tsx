import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package, Warehouse, Truck, Users,
  BarChart2, Receipt, Settings, LogOut, ChevronLeft, ChevronRight,
  Bell, Store, CreditCard, Menu, DollarSign, ClipboardList, UserCog,
  History, CalendarCheck, Cpu, BookOpen, FileText,
  ArrowRightLeft, ClipboardCheck, UserCheck, TrendingUp, Shield,
  Zap, Database, Key, ChevronDown, Smartphone, Banknote, PieChart,
  Building2, GitCompare, Monitor, UtensilsCrossed, ChefHat, Tv2,
  Factory, WifiOff, Tag, Undo2
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { useCartStore, TABLES } from '../stores/cartStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useServerHealth } from '../hooks/useServerHealth';
import { useDBSync } from '../hooks/useDBSync';
import { authApi, currenciesApi, settingsApi } from '../api';
import toast from 'react-hot-toast';

type NavItem = { to: string; label: string; icon: React.ElementType; perm: string; external?: boolean };
type NavGroup = { id: string; label: string; icon: React.ElementType; items: NavItem[] };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const { user, clearAuth, hasPermission, hasRole } = useAuthStore();
  const { isServerUp } = useServerHealth();
  const isCashier = hasRole('cashier');
  const cart = useCartStore();
  // Mounted here (not per-page) so the offline mutation queue keeps replaying
  // and the products/customers/users/suppliers/branches cache stays warm no
  // matter which screen the user is on — a PO created from the Purchases page
  // must sync just as reliably as a sale made from the till.
  useDBSync();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get().then(r => r.data?.data || {}),
  });
  const businessType = (settings?.business_type ?? null) as 'restaurant' | 'supermarket' | null;
  const isRestaurant  = businessType === 'restaurant';
  const isSupermarket = businessType === 'supermarket';

  const topItems: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'view_dashboard' },
    // Restaurant → Advanced POS only. Supermarket → Cashier Register only. Neither when unset.
    ...(isRestaurant  ? [{ to: '/pos',     label: 'Advanced POS',      icon: ShoppingCart, perm: 'create_sales' }] : []),
    ...(isSupermarket ? [{ to: '/cashier', label: 'Cashier Register',  icon: Monitor,      perm: 'create_sales' }] : []),
    { to: '/my-sales',  label: 'My Sales',   icon: History,   perm: 'create_sales' },
    { to: '/ecocash',   label: 'EcoCash',    icon: Smartphone, perm: 'create_sales' },
    { to: '/shift-end', label: 'Cashup',      icon: Banknote,  perm: 'create_sales' },
  ];

  const navGroups: NavGroup[] = [
    // Restaurant-only group
    ...( isRestaurant ? [{
      id: 'restaurant',
      label: 'Restaurant',
      icon: UtensilsCrossed,
      items: [
        { to: '/orders',  label: 'Orders',          icon: ClipboardList, perm: 'view_sales' },
        { to: '/queue',   label: 'Queue Display',   icon: Tv2,           perm: 'create_sales' },
        { to: '/kitchen', label: 'Kitchen Display', icon: ChefHat,       perm: 'create_sales' },
      ],
    }] : []),
    {
      id: 'sales',
      label: 'Sales',
      icon: Receipt,
      items: [
        ...(!isRestaurant ? [{ to: '/orders', label: 'Orders', icon: ClipboardList, perm: 'view_sales' }] : []),
        { to: '/sales',      label: 'Sales History', icon: Receipt,   perm: 'view_sales' },
        { to: '/refunds',    label: 'Refunds',       icon: Undo2,     perm: 'process_refunds' },
        { to: '/laybys',     label: 'Layby',         icon: BookOpen,  perm: 'create_sales' },
        { to: '/quotations', label: 'Quotations',    icon: FileText,  perm: 'create_sales' },
        { to: '/customers',  label: 'Customers',     icon: Users,     perm: 'view_customers' },
      ],
    },
    {
      id: 'inventory',
      label: 'Inventory',
      icon: Warehouse,
      items: [
        { to: '/products',            label: 'Products',       icon: Package,       perm: 'view_products' },
        { to: '/inventory',          label: 'Stock Levels',   icon: Warehouse,     perm: 'view_inventory' },
        { to: '/stock-production',   label: 'Production',     icon: Factory,       perm: 'view_inventory' },
        { to: '/stocktake',          label: 'Stocktake',      icon: ClipboardCheck,perm: 'view_inventory' },
        { to: '/stock-reconciliation',label: 'Reconciliation',icon: GitCompare,    perm: 'view_inventory' },
        { to: '/stock-transfers',    label: 'Transfers',      icon: ArrowRightLeft,perm: 'view_inventory' },
        { to: '/barcode-labels',     label: 'Barcode Labels', icon: Tag,           perm: 'view_products' },
        { to: '/purchases',          label: 'Purchases',      icon: Truck,         perm: 'view_purchase_orders' },
        { to: '/suppliers',          label: 'Suppliers',      icon: Store,         perm: 'view_suppliers' },
      ],
    },
    {
      id: 'finance',
      label: 'Finance',
      icon: Banknote,
      items: [
        { to: '/financial-report', label: 'Financial Report', icon: PieChart,   perm: 'view_reports' },
        { to: '/ecocash',          label: 'EcoCash',          icon: Smartphone, perm: 'view_reports' },
        { to: '/cashflow',         label: 'Cashflow',         icon: Banknote,   perm: 'view_reports' },
        { to: '/salaries',         label: 'Salaries',         icon: Users,      perm: 'view_reports' },
        { to: '/rentals',          label: 'Rentals',          icon: Building2,  perm: 'view_reports' },
        { to: '/expenses',         label: 'Expenses',         icon: CreditCard, perm: 'view_expenses' },
        { to: '/commissions',      label: 'Commissions',      icon: TrendingUp, perm: 'view_reports' },
      ],
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: BarChart2,
      items: [
        { to: '/reports',    label: 'Reports',    icon: BarChart2,    perm: 'view_reports' },
        { to: '/day-end',    label: 'Day End',    icon: CalendarCheck,perm: 'view_reports' },
        { to: '/attendance', label: 'Attendance', icon: UserCheck,    perm: 'view_reports' },
      ],
    },
    {
      id: 'admin',
      label: 'Admin',
      icon: Settings,
      items: [
        { to: '/branches',         label: 'Branches',     icon: Building2, perm: 'manage_settings' },
        { to: '/users',            label: 'Staff',        icon: UserCog,   perm: 'manage_users' },
        { to: '/roles-permissions',label: 'Roles & Perms',icon: Key,       perm: 'manage_settings' },
        { to: '/settings',         label: 'Settings',     icon: Settings,  perm: 'manage_settings' },
        { to: '/currencies',       label: 'Currencies',   icon: DollarSign,perm: 'manage_settings' },
        { to: '/hardware',         label: 'Hardware',     icon: Cpu,       perm: 'manage_settings' },
        { to: '/webhooks',         label: 'Webhooks',     icon: Zap,       perm: 'manage_settings' },
        { to: '/backups',          label: 'Backups',      icon: Database,  perm: 'manage_settings' },
        { to: '/audit-logs',       label: 'Audit Log',    icon: Shield,    perm: 'manage_settings' },
      ],
    },
  ];
  const { currencies, activeCurrency, setCurrencies, setActiveCurrency, format: formatCurrency } = useCurrencyStore();
  const location = useLocation();
  const navigate = useNavigate();
  // The GAAP-style merged info bar is scoped to Advanced POS only —
  // Cashier Register keeps its own simpler inline table selector.
  const isPosPage = location.pathname === '/pos';

  // Live clock for the POS info strip merged into the top nav
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    if (!isPosPage) return;
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, [isPosPage]);

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
    // Load currencies from local API and update store (also refreshes exchange rates)
    currenciesApi.list().then(res => {
      const list = res.data.data ?? res.data;
      if (Array.isArray(list)) {
        setCurrencies(list);
        // If the active currency is in the list, refresh its exchange rate from server
        const current = activeCurrency;
        if (current) {
          const refreshed = list.find((c: any) => c.code === current.code);
          if (refreshed && refreshed.exchange_rate !== current.exchange_rate) {
            setActiveCurrency(refreshed);
          }
        }
      }
    }).catch(() => {
      // Server unavailable — persisted currencies from store are used (offline-safe)
    });
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

  const NavLink = ({ to, label, icon: Icon, indent = false, external = false }: {
    to: string; label: string; icon: React.ElementType; indent?: boolean; external?: boolean;
  }) => {
    const active = !external && (location.pathname === to || (to !== '/' && location.pathname.startsWith(to)));
    const cls = `flex items-center gap-3 rounded-md transition-all text-sm font-medium
      ${indent && !collapsed ? 'pl-9 pr-3 py-1.5' : 'px-3 py-2'}
      ${active
        ? 'bg-blue-600 text-white shadow-sm shadow-blue-300'
        : 'text-slate-600 hover:bg-blue-50 hover:text-blue-800'}`;
    const content = (
      <>
        <Icon size={15} className="flex-shrink-0" />
        {!collapsed && <span className="truncate">{label}</span>}
        {!collapsed && external && <span className="ml-auto text-gray-300 text-[10px]">Open</span>}
      </>
    );
    if (external) {
      return (
        <Link to={to} onClick={() => setMobileOpen(false)} title={collapsed ? label : undefined} className={cls}>
          {content}
        </Link>
      );
    }
    return (
      <Link to={to} onClick={() => setMobileOpen(false)} title={collapsed ? label : undefined} className={cls}>
        {content}
      </Link>
    );
  };

  const SidebarContent = () => (
    <div className="app-sidebar flex flex-col h-full bg-white border-r border-gray-100 shadow-sm">
      {/* Logo */}
      <div className={`app-titlebar flex items-center gap-3 px-4 h-16 border-b border-gray-100 flex-shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 flex-shrink-0">
          <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
            <path d="M18 2L32.5 10.25V26.75L18 35L3.5 26.75V10.25Z" fill="#2563eb"/>
            <circle cx="18" cy="18" r="8" stroke="white" strokeWidth="2" fill="none" opacity="0.5"/>
            <circle cx="18" cy="18" r="4" fill="white"/>
          </svg>
        </div>
        {!collapsed && (
          <div>
            <span className="font-bold text-slate-950 text-base leading-tight block">Core</span>
            <span className="text-xs text-slate-500 truncate block">{user?.branch?.name ?? 'Main Branch'}</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {/* Top flat items */}
        {topItems
          .filter(item => {
            if (isCashier) return ['/cashier', '/pos', '/my-sales', '/ecocash', '/shift-end'].includes(item.to);
            return hasPermission(item.perm) || user?.roles?.includes('admin');
          })
          .map(item => <NavLink key={item.to} {...item} />)}

        {/* Dropdown groups " hidden for cashiers */}
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
                    className={`w-full flex items-center rounded-md text-sm font-semibold transition-all px-3 py-2
                      ${groupActive && !isOpen ? 'bg-blue-50 text-blue-800 shadow-sm'
                        : isOpen ? 'bg-slate-200 text-slate-900 shadow-inner'
                        : 'text-slate-700 hover:bg-blue-50 hover:text-blue-800'}
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
                      {visibleItems.map(item => <NavLink key={item.to} {...item} indent external={item.external} />)}
                    </div>
                  )}

                  {/* Collapsed sidebar: show all icons stacked under group icon */}
                  {collapsed && visibleItems.map(item => <NavLink key={item.to} {...item} external={item.external} />)}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* User */}
      <div className="border-t border-slate-300 p-3 flex-shrink-0 bg-slate-100/65">
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-blue-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-inner">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-950 truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 capitalize truncate">{user?.roles?.[0] ?? 'user'}</p>
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
    <div className="app-shell flex h-screen bg-slate-50 overflow-hidden">
      {/* Desktop sidebar — cashiers are kiosk-locked to their register, no sidebar at all */}
      {!isCashier && (
        <aside className={`hidden md:flex flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-56'} flex-shrink-0 relative`}>
          <SidebarContent />
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="absolute -right-3 top-16 bg-white text-slate-600 rounded-md p-0.5 border border-slate-300 shadow-sm z-10 hover:text-blue-700"
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
        </aside>
      )}

      {/* Mobile overlay */}
      {!isCashier && mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-56 h-full z-50"><SidebarContent /></aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="app-topbar bg-white border-b border-gray-100 h-16 flex items-center px-5 gap-4 flex-shrink-0">
          {!isCashier && (
            <button className="md:hidden text-gray-500 hover:text-gray-800" onClick={() => setMobileOpen(true)}>
              <Menu size={20} />
            </button>
          )}

          {isPosPage ? (
            /* Table / customer / ticket info — merged into the top nav so the
               page below doesn't need its own separate info-bar row. */
            <div className="hidden sm:flex items-stretch bg-black text-white rounded-md overflow-x-auto text-xs max-w-[70vw]">
              {[
                { label: 'Table', value: cart.tableNumber },
                { label: 'Customer', value: cart.customerName || 'Walk-in' },
                { label: 'Cv', value: String(cart.covers) },
                { label: 'TN', value: String(user?.branch?.id ?? 1) },
                { label: 'Inv No', value: cart.ticketNum.replace('#', '') },
                { label: 'Order', value: cart.orderType === 'delivery' ? 'Delivery' : cart.orderType === 'takeaway' ? 'Takeaway' : 'Walk-in' },
              ].map((seg) => (
                <div key={seg.label} className="px-2.5 py-1.5 flex flex-col justify-center whitespace-nowrap border-r border-slate-700 last:border-r-0">
                  <span className="text-[9px] text-slate-400 uppercase tracking-wide leading-none">{seg.label}</span>
                  <span className="font-bold text-xs leading-tight mt-0.5">{seg.value}</span>
                </div>
              ))}
              <div className="px-2.5 py-1.5 flex flex-col justify-center whitespace-nowrap border-l border-slate-700">
                <span className="text-[9px] text-slate-400 uppercase tracking-wide leading-none">{currentTime.toLocaleDateString('en-ZA')}</span>
                <span className="font-bold text-xs leading-tight mt-0.5 tabular-nums">{currentTime.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </div>
            </div>
          ) : (
            <>
              {!isCashier && (
                <div className={`hidden sm:flex items-center gap-2 rounded-md px-3 py-1.5 border ${
                  isServerUp ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
                }`}>
                  <span className={`w-2 h-2 rounded-full inline-block ${isServerUp ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                  <span className={`text-xs font-semibold ${isServerUp ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {isServerUp ? 'Online' : 'Offline'}
                  </span>
                </div>
              )}
              {isCashier && (
                <div className={`hidden sm:flex items-center gap-2 rounded-md px-3 py-1.5 shadow-sm border ${
                  isServerUp ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50 border-amber-300'
                }`}>
                  <ShoppingCart size={14} className={isServerUp ? 'text-emerald-600' : 'text-amber-600'} />
                  <span className={`text-sm font-semibold ${isServerUp ? 'text-emerald-700' : 'text-amber-700'}`}>
                    Cashier Mode {isServerUp ? '· Online' : '· Offline'}
                  </span>
                </div>
              )}
            </>
          )}

          <div className="flex-1 sm:flex-none" />

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-red-700 px-3 py-2 rounded-md hover:bg-red-50 transition-colors border border-transparent hover:border-red-200"
          >
            <LogOut size={16} />
            <span className="hidden lg:inline">Logout</span>
          </button>

          {isPosPage && (
            <select
              value={cart.tableNumber}
              onChange={(e) => {
                const t = e.target.value;
                const held = cart.heldOrders.find((h) => h.tableNumber === t);
                if (held) {
                  if (cart.items.length > 0) cart.holdCurrentCart();
                  cart.restoreHeldOrder(held.id);
                  toast.success(`Order resumed — ${t}`);
                } else {
                  cart.setTableNumber(t);
                }
              }}
              title="Select table"
              className="border border-slate-300 bg-gray-50 text-slate-700 text-xs font-semibold px-3 py-2 rounded-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TABLES.map((t) => {
                const held = cart.heldOrders.find((h) => h.tableNumber === t);
                const heldTotal = held ? held.items.reduce((s, i) => s + (i.price - i.discount) * i.quantity, 0) : 0;
                return (
                  <option key={t} value={t}>
                    {t}{held ? ` • Held ${formatCurrency(heldTotal)}` : ''}
                  </option>
                );
              })}
            </select>
          )}

          <select
            value={activeCurrency?.code ?? 'USD'}
            onChange={(e) => {
              const c = currencies.find(x => x.code === e.target.value);
              if (c) setActiveCurrency(c);
            }}
            className="border border-slate-300 bg-gray-50 text-slate-700 text-xs font-semibold px-3 py-2 rounded-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {currencies.filter(c => c.is_active).map(c => (
              <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
            ))}
          </select>

          {!isServerUp && (
            <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
              <WifiOff size={11} />
              Server starting...
            </span>
          )}

          <button className="relative text-slate-500 hover:text-blue-700 transition-colors p-1.5 rounded-md hover:bg-blue-50 border border-transparent hover:border-blue-200">
            <Bell size={19} />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>

          <div className="flex items-center gap-2.5 pl-1">
            <div className="w-8 h-8 rounded-md bg-blue-700 flex items-center justify-center text-white font-bold text-xs shadow-inner">
              {userInitials}
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-slate-950 leading-tight">{user?.name}</p>
              <p className="text-xs text-slate-500 capitalize leading-tight">{user?.roles?.[0]}</p>
            </div>
          </div>
        </header>

        {/* flex flex-col here (not just flex-1) is required so pages like POSPage/CashierPage
            that use `flex-1 overflow-hidden` to fill exactly the available height — instead of
            page-level scrolling — actually get that height from their parent. Without it, this
            <main> lets content grow to its natural size and scrolls the whole page instead of
            the page's own internal scroll regions. */}
        <main className="app-workspace flex-1 flex flex-col overflow-y-auto p-5 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
