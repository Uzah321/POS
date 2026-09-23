import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package, Warehouse, Truck, Users,
  BarChart2, Receipt, Settings, LogOut,
  Store, CreditCard, Menu, DollarSign, ClipboardList, UserCog,
  Cpu, BookOpen, FileText, CalendarCheck,
  ArrowRightLeft, ClipboardCheck, UserCheck, TrendingUp, Shield,
  Zap, Database, Key, ChevronDown, Smartphone, Banknote, PieChart,
  Building2, GitCompare, Monitor, UtensilsCrossed, ChefHat, Tv2,
  Factory, WifiOff, Tag, Undo2, Wheat, BadgeCheck, Utensils, ListChecks, CalendarDays
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { useCartStore, TABLES } from '../stores/cartStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useServerHealth } from '../hooks/useServerHealth';
import { useDBSync } from '../hooks/useDBSync';
import { authApi, currenciesApi, settingsApi } from '../api';
import LicenseBanner from '../components/LicenseBanner';
import NotificationBell from '../components/ui/NotificationBell';
import { TopbarSlotContext } from './TopbarSlot';
import toast from 'react-hot-toast';

type NavItem = { to: string; label: string; icon: React.ElementType; perm: string; external?: boolean };
type NavGroup = { id: string; label: string; icon: React.ElementType; items: NavItem[] };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // Portal target inside the topbar that CashierPage renders its own header
  // controls into, so the two rows appear as a single line. useState (not a
  // plain ref) so setting it re-renders and the portal actually attaches.
  const [topbarSlotEl, setTopbarSlotEl] = useState<HTMLDivElement | null>(null);
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
  // A user assigned to a shop always sees that shop; otherwise follow the system-wide mode.
  const businessType = (user?.business_type ?? settings?.business_type ?? null) as 'restaurant' | 'supermarket' | null;
  const isRestaurant  = businessType === 'restaurant';
  const isSupermarket = businessType === 'supermarket';

  const topItems: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'view_dashboard' },
    // Restaurant → Advanced POS only. Supermarket → Cashier Register only. Neither when unset.
    ...(isRestaurant  ? [{ to: '/pos',     label: 'Advanced POS',      icon: ShoppingCart, perm: 'create_sales' }] : []),
    ...(isSupermarket ? [{ to: '/cashier', label: 'Cashier Register',  icon: Monitor,      perm: 'create_sales' }] : []),
    { to: '/ecocash',   label: 'EcoCash',    icon: Smartphone, perm: 'create_sales' },
    { to: '/shift-end', label: 'Cashup',      icon: Banknote,  perm: 'create_sales' },
    // Own top-level item (not inside the Reports group) so a role with
    // manage_day_end but not view_reports — e.g. manager — can still reach
    // it from the sidebar regardless of which POS screen their store uses.
    { to: '/day-end',   label: 'End Day',    icon: CalendarCheck, perm: 'manage_day_end' },
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
        { to: '/ingredients',        label: 'Ingredients',    icon: Wheat,         perm: 'view_inventory' },
        { to: '/inventory',          label: 'Stock Levels',   icon: Warehouse,     perm: 'view_inventory' },
        { to: '/stock-production',   label: 'Production',     icon: Factory,       perm: 'view_inventory' },
        { to: '/stocktake',          label: 'Stocktake',      icon: ClipboardCheck,perm: 'manage_stocktake' },
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
        { to: '/financial-report', label: 'Financial Report', icon: PieChart,   perm: 'view_financial_reports' },
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
        { to: '/attendance', label: 'Attendance', icon: UserCheck,    perm: 'view_reports' },
      ],
    },
    {
      id: 'admin',
      label: 'Admin',
      icon: Settings,
      items: [
        { to: '/branches',         label: 'Branches',     icon: Building2, perm: 'manage_settings' },
        // Admin-only regardless of who else has manage_settings — every
        // other role is locked to its own branch, so cross-branch
        // comparison only makes sense for admin.
        ...(hasRole('admin') ? [{ to: '/branch-comparison', label: 'Compare Branches', icon: TrendingUp, perm: 'manage_settings' }] : []),
        { to: '/users',            label: 'Staff',        icon: UserCog,   perm: 'manage_users' },
        { to: '/roles-permissions',label: 'Roles & Perms',icon: Key,       perm: 'manage_settings' },
        { to: '/settings',         label: 'Settings',     icon: Settings,  perm: 'manage_settings' },
        { to: '/currencies',       label: 'Currencies',   icon: DollarSign,perm: 'manage_settings' },
        { to: '/hardware',         label: 'Hardware',     icon: Cpu,       perm: 'manage_settings' },
        { to: '/webhooks',         label: 'Webhooks',     icon: Zap,       perm: 'manage_settings' },
        { to: '/backups',          label: 'Backups',      icon: Database,  perm: 'manage_settings' },
        { to: '/license',          label: 'License',      icon: BadgeCheck,perm: 'manage_settings' },
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
  // Cashier Register renders its own online-status pill + user avatar in its
  // header card right below this bar — skip the topbar's copies here so the
  // two bars read as one continuous toolbar instead of repeating the same info.
  const isCashierRegisterPage = location.pathname === '/cashier';

  // Live clock for the POS info strip merged into the top nav
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    if (!isPosPage) return;
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, [isPosPage]);

  // Arrow-up/down scroll whichever panel the user is actually in — the main
  // workspace normally, but a modal's own list/table instead when one is open.
  // Never falls back to scrolling the main screen from inside a modal, since
  // that scrolls a panel the user can't even see. Skipped while typing/
  // selecting so it doesn't fight normal field editing.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const findScrollable = (start: HTMLElement): HTMLElement | null => {
      let node: HTMLElement | null = start;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      const el = findScrollable(target);
      if (!el) return;
      e.preventDefault();
      el.scrollBy({ top: e.key === 'ArrowDown' ? 80 : -80, behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const handleLogout = async (reason?: 'idle') => {
    try { await authApi.logout(); } catch {}
    clearAuth();
    navigate('/login');
    toast.success(reason === 'idle' ? 'Logged out after 15 minutes of inactivity' : 'Logged out');
  };

  // Idle timeout: only real interaction (mouse/keyboard/touch/scroll) resets the
  // clock — background polling (server-health checks, offline sync, etc.) does
  // not, so someone actively using the app is never logged out mid-use, only
  // after they've genuinely stepped away for 15 minutes.
  const IDLE_LIMIT_MS = 15 * 60 * 1000;
  useEffect(() => {
    if (!user) return;
    let idleTimer: ReturnType<typeof setTimeout>;
    let lastReset = 0;
    const scheduleLogout = () => { idleTimer = setTimeout(() => handleLogout('idle'), IDLE_LIMIT_MS); };
    const resetTimer = () => {
      const now = Date.now();
      if (now - lastReset < 1000) return; // throttle high-frequency events (mousemove/scroll)
      lastReset = now;
      clearTimeout(idleTimer);
      scheduleLogout();
    };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    scheduleLogout();
    return () => {
      clearTimeout(idleTimer);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user]);

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
    const cls = `flex items-center gap-3 rounded-xl transition-all text-sm font-medium
      ${indent ? 'pl-9 pr-3 py-2' : 'px-3 py-2.5'}
      ${active
        ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
        : 'text-slate-300 hover:bg-white/10 hover:text-white'}`;
    return (
      <Link to={to} onClick={() => setSidebarOpen(false)} className={cls}>
        <Icon size={18} className="flex-shrink-0" />
        <span className="truncate">{label}</span>
        {external && <span className="ml-auto text-slate-400 text-[10px]">Open</span>}
      </Link>
    );
  };

  const SidebarContent = () => (
    <div className="app-sidebar flex flex-col h-full shadow-xl">
      {/* Logo */}
      <div className="app-titlebar flex items-center gap-3 px-4 h-16 flex-shrink-0">
        <div className="w-9 h-9 flex-shrink-0">
          <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
            <path d="M18 2L32.5 10.25V26.75L18 35L3.5 26.75V10.25Z" fill="#3b82f6"/>
            <circle cx="18" cy="18" r="8" stroke="white" strokeWidth="2" fill="none" opacity="0.5"/>
            <circle cx="18" cy="18" r="4" fill="white"/>
          </svg>
        </div>
        <div>
          <span className="font-bold text-white text-base leading-tight block">Core</span>
          <span className="text-xs text-slate-400 truncate block">{user?.branch?.name ?? 'Main Branch'}</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-1">
        {/* Top flat items */}
        {topItems
          .filter(item => {
            if (isCashier) return ['/cashier', '/pos', '/ecocash', '/shift-end'].includes(item.to);
            return hasPermission(item.perm) || user?.roles?.includes('admin');
          })
          .map(item => <NavLink key={item.to} {...item} />)}

        {/* Dropdown groups " hidden for cashiers */}
        {!isCashier && (
          <div className="pt-2 space-y-1">
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
                    onClick={() => toggleGroup(group.id)}
                    className={`w-full flex items-center justify-between rounded-xl text-sm font-semibold transition-all px-3 py-2.5
                      ${groupActive && !isOpen ? 'bg-white/10 text-white'
                        : isOpen ? 'bg-white/15 text-white'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
                  >
                    <span className="flex items-center gap-3">
                      <GroupIcon size={18} className="flex-shrink-0" />
                      <span>{group.label}</span>
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {/* Expanded items */}
                  {isOpen && (
                    <div className="mt-0.5 mb-1 space-y-0.5">
                      {visibleItems.map(item => <NavLink key={item.to} {...item} indent external={item.external} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* User */}
      <div className="border-t border-white/10 p-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow">
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
            <p className="text-xs text-slate-400 capitalize truncate">{user?.roles?.[0] ?? 'user'}</p>
          </div>
          <button type="button" onClick={() => handleLogout()} title="Logout" className="text-slate-400 hover:text-red-400 transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-shell flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar drawer — collapsed by default, opened via the hamburger
          icon in the top bar. Cashiers are kiosk-locked to their register,
          no sidebar at all for that role. */}
      {!isCashier && sidebarOpen && (
        <div className="fixed inset-0 z-40 will-change-transform">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-60 h-full z-50 will-change-transform"><SidebarContent /></aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {isPosPage ? (
          /* Advanced POS — dark navy brand bar: logo, order info tiles, clock, currency, user, menu */
          <header className="pos-screen flex items-center gap-2 lg:gap-3 h-16 px-3 sm:px-4 flex-shrink-0 text-white" style={{ background: '#0b1f44' }}>
            <div className="flex items-center gap-2.5 flex-shrink-0 pr-2 lg:pr-4 lg:border-r border-white/10 h-10">
              <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="34" height="34">
                <path d="M18 2L32.5 10.25V26.75L18 35L3.5 26.75V10.25Z" fill="#2f6df6" />
                <circle cx="18" cy="18" r="8" stroke="white" strokeWidth="2" fill="none" opacity="0.5" />
                <circle cx="18" cy="18" r="4" fill="white" />
              </svg>
              <div className="leading-tight hidden sm:block">
                <p className="font-bold text-[17px]">Core POS</p>
                <p className="text-[10px] text-blue-200/80">Simple. Smart. Sales.</p>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-2 min-w-0 overflow-x-auto">
              {/* Table — a real select underneath so choosing/resuming a table still works */}
              <label className="relative flex items-center gap-2.5 rounded-xl px-3 h-11 cursor-pointer flex-shrink-0" style={{ background: '#16305e' }}>
                <Utensils size={18} className="text-blue-200" />
                <span className="leading-tight">
                  <span className="block text-[10px] text-blue-200/80">Table</span>
                  <span className="block text-xs font-bold whitespace-nowrap">{cart.tableNumber}</span>
                </span>
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
                  aria-label="Select table"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-slate-900"
                >
                  {TABLES.map((t) => {
                    const held = cart.heldOrders.find((h) => h.tableNumber === t);
                    const heldTotal = held ? held.items.reduce((s, i) => s + (i.price - i.discount) * i.quantity, 0) : 0;
                    return <option key={t} value={t}>{t}{held ? ` • Held ${formatCurrency(heldTotal)}` : ''}</option>;
                  })}
                </select>
              </label>

              {[
                { icon: ListChecks, label: 'CV / TN', value: `${cart.covers} / ${user?.branch?.id ?? 1}`, cls: 'hidden xl:flex' },
                { icon: FileText, label: 'Invoice No', value: cart.ticketNum.replace('#', '') },
              ].map(({ icon: Icon, label, value, cls }: { icon: any; label: string; value: string; cls?: string }) => (
                <div key={label} className={`${cls ?? 'flex'} items-center gap-2.5 rounded-xl px-3 h-11 flex-shrink-0`} style={{ background: '#16305e' }}>
                  <Icon size={18} className="text-blue-200" />
                  <span className="leading-tight">
                    <span className="block text-[10px] text-blue-200/80">{label}</span>
                    <span className="block text-xs font-bold whitespace-nowrap">{value}</span>
                  </span>
                </div>
              ))}

              <div className="hidden xl:flex items-center gap-2.5 rounded-xl px-3 h-11 flex-shrink-0" style={{ background: '#16305e' }}>
                <CalendarDays size={18} className="text-blue-200" />
                <span className="leading-tight">
                  <span className="block text-[10px] text-blue-200/80 whitespace-nowrap">{currentTime.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  <span className="block text-xs font-bold tabular-nums">{currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </span>
              </div>
            </div>

            <div className="flex-1" />

            <select
              value={activeCurrency?.code ?? 'USD'}
              onChange={(e) => {
                const c = currencies.find(x => x.code === e.target.value);
                if (c) setActiveCurrency(c);
              }}
              className="rounded-xl px-3 h-10 text-sm font-semibold text-white cursor-pointer focus:outline-none border border-white/10"
              style={{ background: '#16305e' }}
            >
              {currencies.filter(c => c.is_active).map(c => (
                <option key={c.code} value={c.code} className="text-slate-900">{c.symbol} {c.code}</option>
              ))}
            </select>

            <div className="text-blue-100 [&_button]:text-blue-100 [&_button:hover]:bg-white/10 [&_button:hover]:text-white"><NotificationBell /></div>

            <div className="flex items-center gap-2.5">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-base" style={{ background: '#2f6df6' }}>{userInitials}</div>
              <div className="hidden xl:block leading-tight">
                <p className="text-sm font-bold">{user?.name}</p>
                <p className="text-xs text-blue-200/80 capitalize">{user?.roles?.[0]}</p>
              </div>
            </div>

            <button type="button" onClick={() => handleLogout()} title="Logout" className="w-10 h-10 flex items-center justify-center rounded-xl text-blue-100 hover:bg-white/10 hover:text-red-300 transition-colors">
              <LogOut size={18} />
            </button>
            {!isCashier && (
              <button type="button" onClick={() => setSidebarOpen(true)} title="Menu" className="w-10 h-10 flex items-center justify-center rounded-xl text-white hover:bg-white/10">
                <Menu size={22} />
              </button>
            )}
          </header>
        ) : (
        <header
          className={`app-topbar h-16 flex items-center px-3 sm:px-5 gap-2 sm:gap-4 flex-shrink-0 ${isCashierRegisterPage ? 'pos-screen text-white' : 'bg-white border-b border-gray-100'}`}
          style={isCashierRegisterPage ? { background: '#0b1f44' } : undefined}
        >
          {!isCashier && (
            <button className="text-gray-500 hover:text-gray-800" onClick={() => setSidebarOpen(true)} title="Menu">
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
          ) : isCashierRegisterPage ? (
            // CashierPage portals its store/cashier name, held-orders/void
            // controls, online status, and clock in here via TopbarSlotContext.
            <div ref={setTopbarSlotEl} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 overflow-x-auto" />
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

          {!isCashierRegisterPage && <div className="flex-1 sm:flex-none" />}

          <button
            type="button"
            onClick={() => handleLogout()}
            className={`inline-flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-md transition-colors border border-transparent ${isCashierRegisterPage ? 'text-blue-100 hover:text-red-300 hover:bg-white/10 rounded-xl' : 'text-slate-600 hover:text-red-700 hover:bg-red-50 hover:border-red-200'}`}
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
            className={`text-xs font-semibold px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${isCashierRegisterPage ? 'text-white border border-white/10 rounded-xl h-10 text-sm' : 'border border-slate-300 bg-gray-50 text-slate-700 rounded-md'}`}
            style={isCashierRegisterPage ? { background: '#16305e' } : undefined}
          >
            {currencies.filter(c => c.is_active).map(c => (
              <option key={c.code} value={c.code} className="text-slate-900">{c.symbol} {c.code}</option>
            ))}
          </select>

          {!isServerUp && !isCashierRegisterPage && (
            <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
              <WifiOff size={11} />
              Server starting...
            </span>
          )}

          {isCashierRegisterPage
            ? <div className="text-blue-100 [&_button]:text-blue-100 [&_button:hover]:bg-white/10 [&_button:hover]:text-white"><NotificationBell /></div>
            : <NotificationBell />}

          {/* Cashier Register already names the logged-in cashier in its own
              header content (portaled in above), so this avatar+name would
              just repeat it — skip it there. */}
          {!isCashierRegisterPage && (
          <div className="flex items-center gap-2.5 pl-1">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs shadow">
              {userInitials}
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-slate-950 leading-tight">{user?.name}</p>
              <p className="text-xs text-slate-500 capitalize leading-tight">{user?.roles?.[0]}</p>
            </div>
          </div>
          )}
        </header>
        )}

        {/* flex flex-col here (not just flex-1) is required so pages like POSPage/CashierPage
            that use `flex-1 overflow-hidden` to fill exactly the available height — instead of
            page-level scrolling — actually get that height from their parent. Without it, this
            <main> lets content grow to its natural size and scrolls the whole page instead of
            the page's own internal scroll regions. */}
        <LicenseBanner />
        <main ref={mainRef} className="app-workspace flex-1 flex flex-col overflow-y-auto overscroll-contain p-3 sm:p-5 lg:p-6">
          <TopbarSlotContext.Provider value={topbarSlotEl}>
            {children}
          </TopbarSlotContext.Provider>
        </main>
      </div>
    </div>
  );
}
