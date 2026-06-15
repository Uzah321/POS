import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, customersApi, salesApi, settingsApi } from '../api';
import type { CartItem } from '../stores/cartStore';
import { useCartStore } from '../stores/cartStore';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { buildReceiptDataFromSale, printReceipt, resolveReceiptPrintMode } from '../lib/hardware/printer';
import { broadcastCart } from '../lib/hardware/customerDisplay';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { useOfflineStore } from '../stores/offlineStore';
import { useDBSync } from '../hooks/useDBSync';
import { db } from '../lib/db';
import {
  Search, Plus, Minus, Trash2, User, Loader2, CreditCard, Banknote, Smartphone,
  X, ShoppingCart, TableProperties, UtensilsCrossed, WifiOff, RefreshCw, CloudUpload, Database, ExternalLink
} from 'lucide-react';
import toast from 'react-hot-toast';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'mobile_money', label: 'Mobile', icon: Smartphone },
];

const TABLES = ['Walk-in', ...Array.from({ length: 20 }, (_, i) => `T-${i + 1}`)];

// One distinct background per category — full class strings so Tailwind keeps them
const TILE_COLORS = [
  'bg-green-100  hover:bg-green-200  text-green-900  border border-green-200',
  'bg-blue-100   hover:bg-blue-200   text-blue-900   border border-blue-200',
  'bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-200',
  'bg-orange-100 hover:bg-orange-200 text-orange-900 border border-orange-200',
  'bg-teal-100   hover:bg-teal-200   text-teal-900   border border-teal-200',
  'bg-pink-100   hover:bg-pink-200   text-pink-900   border border-pink-200',
  'bg-yellow-100 hover:bg-yellow-200 text-yellow-900 border border-yellow-200',
  'bg-indigo-100 hover:bg-indigo-200 text-indigo-900 border border-indigo-200',
  'bg-red-100    hover:bg-red-200    text-red-900    border border-red-200',
  'bg-cyan-100   hover:bg-cyan-200   text-cyan-900   border border-cyan-200',
] as const;

function CartRow({ item, format }: { item: CartItem; format: (v: number) => string }) {
  const { updateQty, removeItem } = useCartStore();
  const lineTotal = (item.price - item.discount) * item.quantity;
  return (
    <div className="flex items-center gap-2 py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
        <p className="text-xs text-gray-400">{format(item.price)} each</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => updateQty(item.product_id, item.quantity - 1)}
          className="w-6 h-6 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
        >
          <Minus size={11} />
        </button>
        <span className="w-7 text-center text-sm font-bold text-gray-900">{item.quantity}</span>
        <button
          type="button"
          onClick={() => updateQty(item.product_id, item.quantity + 1)}
          className="w-6 h-6 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
        >
          <Plus size={11} />
        </button>
      </div>
      <div className="w-16 text-right">
        <p className="text-sm font-bold text-gray-900">{format(lineTotal)}</p>
      </div>
      <button type="button" onClick={() => removeItem(item.product_id)} className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg text-red-400 hover:text-white hover:bg-red-500 transition-colors ml-1" title="Remove item">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export default function POSPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [tableNumber, setTableNumber] = useState('Walk-in');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitPayments, setSplitPayments] = useState<Array<{method: string; amount: string}>>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [ticketNum] = useState(() => `#${Math.floor(Math.random() * 9000) + 1000}`);
  const searchRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const cart = useCartStore();
  const { user } = useAuthStore();
  const { format: formatCurrency } = useCurrencyStore();

  const branchId = user?.branch?.id ?? 1;
  const hw = useHardwareStore();
  const { activeCurrency } = useCurrencyStore();
  const currency = activeCurrency?.symbol ?? '$';

  const { isOnline, queue: offlineQueue, isSyncing, syncQueue } = useOfflineSync();
  const enqueue = useOfflineStore((s) => s.enqueue);
  const { isSyncing: isDBSyncing, lastSynced, syncNow } = useDBSync();

  const { data: storeSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      try {
        const data = await settingsApi.get().then(r => r.data?.data || {});
        try { localStorage.setItem('Core-settings-cache', JSON.stringify(data)); } catch {}
        return data;
      } catch {
        const cached = localStorage.getItem('Core-settings-cache');
        return cached ? JSON.parse(cached) : {};
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  const storeName = storeSettings?.company_name || 'Core';

  const { data: kdsRaw } = useQuery({
    queryKey: ['pos-kds-orders'],
    queryFn: () => axios.get('/api/kds/orders').then(r => r.data?.data ?? []),
    refetchInterval: 4000,
  });
  const kdsOrders: any[] = Array.isArray(kdsRaw) ? kdsRaw : [];
  const kdsNew      = kdsOrders.filter((o: any) => o.kds_status === 'new').length;
  const kdsPreparing = kdsOrders.filter((o: any) => o.kds_status === 'preparing').length;
  const kdsReady    = kdsOrders.filter((o: any) => o.kds_status === 'ready').length;
  const storeAddress = user?.branch?.address || storeSettings?.company_address;
  const storePhone = user?.branch?.phone || storeSettings?.company_phone;

  useEffect(() => { searchRef.current?.focus(); }, []);

  // Barcode scanner - intercepts fast keystroke sequences and routes to product search
  const handleBarcodeScan = useCallback((code: string) => {
    setSearch(code);
    searchRef.current?.focus();
    if (hw.barcodeAutoAdd) {
      // Auto-add handled after product list re-renders (see filteredProducts effect below)
      barcodeRef.current = code;
    }
  }, [hw.barcodeAutoAdd]);

  const barcodeRef = useRef<string | null>(null);
  useBarcodeScanner({ enabled: hw.barcodeScannerEnabled, onScan: handleBarcodeScan });

  // Keyboard shortcuts - keep latest handlers in a ref to avoid stale closures
  const kbRef = useRef<any>({});
  useEffect(() => {
    kbRef.current = { handleProcessSale, handleHoldOrder, cart, saleMutation, holdMutation };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const { handleProcessSale, handleHoldOrder, cart, saleMutation, holdMutation } = kbRef.current;
      if (e.key === 'F2' || (e.key === '/' && !inInput)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (cart.items.length > 0 && !saleMutation.isPending) handleProcessSale();
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cart.items.length > 0 && !holdMutation.isPending) handleHoldOrder();
      } else if (e.key === 'F5') {
        e.preventDefault();
        if (cart.items.length > 0) cart.clearCart();
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearch('');
      } else if (!inInput) {
        if (e.key === '1') setPaymentMethod('cash');
        else if (e.key === '2') setPaymentMethod('card');
        else if (e.key === '3') setPaymentMethod('mobile_money');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data: allProductsData, isLoading: productsLoading } = useQuery({
    queryKey: ['pos-products'],
    queryFn: async () => {
      if (!navigator.onLine) {
        return db.products.toArray();
      }
      try {
        const data = await productsApi.list({ per_page: 500, is_active: 1 })
          .then(r => r.data?.data?.data ?? r.data?.data ?? []);
        // Keep IndexedDB current as a side-effect of the normal online fetch
        db.products.clear().then(() => db.products.bulkPut(data)).catch(() => {});
        return data;
      } catch {
        // API failed while nominally online - fall back to IndexedDB
        const cached = await db.products.toArray();
        return cached.length > 0 ? cached : [];
      }
    },
    staleTime: 60000,
  });

  const { data: customerResults } = useQuery({
    queryKey: ['customer-search', customerSearch, isOnline],
    queryFn: async () => {
      if (!isOnline) {
        const q = customerSearch.toLowerCase();
        return db.customers
          .filter(c =>
            c.name.toLowerCase().includes(q) ||
            (c.phone ?? '').includes(customerSearch) ||
            (c.email ?? '').toLowerCase().includes(q)
          )
          .limit(5)
          .toArray();
      }
      return customersApi.list({ search: customerSearch, per_page: 5 }).then((r) => r.data?.data?.data || []);
    },
    enabled: customerSearch.length >= 2,
  });

  const allProducts: any[] = Array.isArray(allProductsData) ? allProductsData : [];

  // Derive categories
  const categories = ['All', ...Array.from(new Set(allProducts.map((p: any) => p.category?.name).filter(Boolean))) as string[]];

  // Stable colour index per category name
  const categoryColorIndex = useMemo(() => {
    const map: Record<string, number> = {};
    categories.filter(c => c !== 'All').forEach((c, i) => { map[c] = i; });
    return map;
  }, [categories]);

  // Filter products
  const filteredProducts = allProducts.filter((p: any) => {
    const matchCat = activeCategory === 'All' || p.category?.name === activeCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? '').toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  // Auto-add when barcode scan yields exactly 1 match
  useEffect(() => {
    if (barcodeRef.current && filteredProducts.length === 1) {
      handleAddProduct(filteredProducts[0]);
      setSearch('');
      barcodeRef.current = null;
    }
  }, [filteredProducts]);

  // Broadcast cart to customer display on every cart change
  useEffect(() => {
    if (!hw.customerDisplayEnabled) return;
    broadcastCart({
      type: cart.items.length > 0 ? 'cart' : 'idle',
      storeName,
      currency,
      items: cart.items.map((i) => ({ name: i.name, qty: i.quantity, price: i.price, total: i.price * i.quantity })),
      subtotal: cart.subtotal(),
      tax: cart.taxTotal(),
      discount: cart.discount,
      total: cart.total(),
    });
  }, [cart.items, hw.customerDisplayEnabled]);

  const saleMutation = useMutation({
    mutationFn: (payload: object) => salesApi.create(payload),
    onSuccess: (res) => {
      const sale = res.data?.data;
      toast.success(`Sale ${sale?.reference} completed!`);

      if (sale) {
        void printReceipt(
          buildReceiptDataFromSale(sale, {
            storeName,
            storeAddress,
            storePhone,
            cashier: user?.name ?? '',
            currency,
            paymentMethod,
            amountTendered: paymentMethod === 'cash' ? parseFloat(cashTendered) || cart.total() : undefined,
            change: paymentMethod === 'cash' ? Math.max(0, (parseFloat(cashTendered) || 0) - cart.total()) : undefined,
            itemsFallback: cart.items.map((item) => ({
              name: item.name,
              qty: item.quantity,
              price: item.price,
              total: item.price * item.quantity,
            })),
          }),
          resolveReceiptPrintMode(hw.printerMode)
        ).catch((error: any) => {
          toast.error(error?.message ?? 'Sale completed, but receipt printing failed');
        });
      }

      // Broadcast "thank you" to customer display
      broadcastCart({ type: 'thankyou', storeName, currency });
      setTimeout(() => broadcastCart({ type: 'idle', storeName, currency }), 4000);

      cart.clearCart();
      setCashTendered('');
      setSplitPayments([]);
      setIsSplitPayment(false);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Sale failed'),
  });

  const holdMutation = useMutation({
    mutationFn: (payload: object) => salesApi.hold(payload),
    onSuccess: () => {
      toast.success('Order held!');
      cart.clearCart();
      qc.invalidateQueries({ queryKey: ['held-sales-dashboard'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Hold failed'),
  });

  const handleAddProduct = (product: any) => {
    cart.addItem({
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      price: parseFloat(product.selling_price),
      cost: parseFloat(product.cost_price || 0),
      tax_rate: product.tax_rate?.rate || 0,
    });
    toast.success(`Added ${product.name}`, { duration: 800 });
  };

  const handleProcessSale = () => {
    if (cart.items.length === 0) return;

    let paymentsPayload: Array<{method: string; amount: number}>;
    if (isSplitPayment) {
      if (splitPayments.length === 0) { toast.error('Add at least one payment'); return; }
      const splitTotal = splitPayments.reduce((s, p) => s + parseFloat(p.amount || '0'), 0);
      if (Math.abs(splitTotal - total) > 0.01) { toast.error(`Split payments (${formatCurrency(splitTotal)}) must equal total (${formatCurrency(total)})`); return; }
      paymentsPayload = splitPayments.map(p => ({ method: p.method, amount: parseFloat(p.amount) }));
    } else {
      if (paymentMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) <= 0)) {
        toast.error('Please enter the cash amount received before processing');
        return;
      }
      paymentsPayload = [{ method: paymentMethod, amount: cart.total() }];
    }

    const salePayload = {
      branch_id: branchId,
      warehouse_id: 1,
      customer_id: cart.customerId,
      table_number: tableNumber !== 'Walk-in' ? tableNumber : null,
      items: cart.items.map((i) => ({
        product_id: i.product_id,
        product_variant_id: i.variant_id,
        quantity: i.quantity,
        unit_price: i.price,
        discount_type: i.discount > 0 ? 'fixed' : null,
        discount_value: i.discount > 0 ? i.discount : 0,
      })),
      payments: paymentsPayload,
      discount_value: cart.discount,
      notes: cart.note,
    };

    if (!isOnline) {
      const reference = `OFFLINE-${Date.now()}`;
      enqueue(salePayload, {
        reference,
        items: cart.items.map((i) => ({ name: i.name, qty: i.quantity, price: i.price, total: (i.price - i.discount) * i.quantity })),
        subtotal: cart.subtotal(),
        tax: cart.taxTotal(),
        discount: cart.discount,
        total: cart.total(),
        paymentMethod: isSplitPayment ? 'split' : paymentMethod,
        amountTendered: !isSplitPayment && paymentMethod === 'cash' ? parseFloat(cashTendered) || undefined : undefined,
        change: !isSplitPayment && paymentMethod === 'cash' ? Math.max(0, (parseFloat(cashTendered) || 0) - cart.total()) : undefined,
      });

      toast.success(`Sale saved offline - will sync when connected`, { duration: 4000 });

      void printReceipt(
        buildReceiptDataFromSale({ reference }, {
          storeName,
          storeAddress,
          storePhone,
          cashier: user?.name ?? '',
          currency,
          paymentMethod: isSplitPayment ? 'split' : paymentMethod,
          amountTendered: !isSplitPayment && paymentMethod === 'cash' ? parseFloat(cashTendered) || cart.total() : undefined,
          change: !isSplitPayment && paymentMethod === 'cash' ? Math.max(0, (parseFloat(cashTendered) || 0) - cart.total()) : undefined,
          itemsFallback: cart.items.map((item) => ({ name: item.name, qty: item.quantity, price: item.price, total: item.price * item.quantity })),
        }),
        resolveReceiptPrintMode(hw.printerMode)
      ).catch((error: any) => {
        toast.error(error?.message ?? 'Receipt printing failed');
      });

      broadcastCart({ type: 'thankyou', storeName, currency });
      setTimeout(() => broadcastCart({ type: 'idle', storeName, currency }), 4000);

      cart.clearCart();
      setCashTendered('');
      setSplitPayments([]);
      setIsSplitPayment(false);
      return;
    }

    saleMutation.mutate(salePayload);
  };

  const handleHoldOrder = () => {
    if (cart.items.length === 0) return;
    holdMutation.mutate({
      branch_id: branchId,
      customer_id: cart.customerId,
      table_number: tableNumber !== 'Walk-in' ? tableNumber : null,
      cart_data: {
        items: cart.items,
        subtotal: cart.subtotal(),
        tax: cart.taxTotal(),
        total: cart.total(),
        discount: cart.discount,
      },
      note: cart.note,
    });
  };

  const total = cart.total();
  const change = paymentMethod === 'cash' && parseFloat(cashTendered) > total
    ? parseFloat(cashTendered) - total : 0;

  return (
    <div className="-m-6 flex flex-col bg-slate-50" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Offline banner */}
      {!isOnline && (
        <div className="flex items-center justify-between bg-amber-500 text-white px-5 py-2 text-sm font-medium flex-shrink-0">
          <span className="flex items-center gap-2">
            <WifiOff size={15} />
            Offline mode  sales will be queued and uploaded when reconnected
            {offlineQueue.length > 0 && (
              <span className="bg-white text-amber-600 text-xs font-bold px-2 py-0.5 rounded-full">
                {offlineQueue.length} pending
              </span>
            )}
          </span>
        </div>
      )}
      {/* DB sync status bar - shown when online */}
      {isOnline && (
        <div className="flex items-center justify-between bg-gray-100 border-b border-gray-200 px-5 py-1 text-xs text-gray-500 flex-shrink-0">
          <span className="flex items-center gap-1.5">
            {isDBSyncing ? <RefreshCw size={11} className="animate-spin" /> : <Database size={11} />}
            {isDBSyncing
              ? 'Syncing offline database...'
              : lastSynced
              ? `Offline DB synced ${new Date(lastSynced).toLocaleTimeString()}`
              : 'Offline database not yet synced'}
          </span>
          {!isDBSyncing && (
            <button type="button" onClick={() => void syncNow(false)} className="text-blue-600 hover:underline">
              Sync now
            </button>
          )}
        </div>
      )}

      {/* Sync indicator when back online with pending sales */}
      {isOnline && offlineQueue.length > 0 && (
        <div className="flex items-center justify-between bg-blue-600 text-white px-5 py-2 text-sm font-medium flex-shrink-0">
          <span className="flex items-center gap-2">
            {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <CloudUpload size={14} />}
            {isSyncing
              ? `Syncing ${offlineQueue.length} offline sale${offlineQueue.length !== 1 ? 's' : ''}...`
              : `${offlineQueue.length} offline sale${offlineQueue.length !== 1 ? 's' : ''} pending upload`}
          </span>
          {!isSyncing && (
            <button type="button" onClick={() => void syncQueue()} className="text-xs bg-white text-blue-600 px-2.5 py-1 rounded-lg font-semibold hover:bg-blue-50 transition-colors">
              Sync now
            </button>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
      {/* Left: product area */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Search bar */}
        <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex-shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by name or SKU... (F2)"
              className="w-full pl-10 pr-9 py-2.5 border-2 border-blue-400 focus:border-blue-600 rounded-xl text-sm
                bg-blue-50 focus:bg-white focus:outline-none transition-colors"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Category tabs */}
        <div className="bg-white border-b border-gray-200 flex-shrink-0 overflow-x-auto">
          <div className="flex min-w-max">
            {categories.map((cat) => (
              <button
                type="button"
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-5 py-3 font-semibold text-sm border-b-2 transition-colors whitespace-nowrap
                  ${activeCategory === cat
                    ? 'border-blue-600 text-blue-600 bg-blue-50/60'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Touch-friendly product tile grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {productsLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 size={24} className="animate-spin text-blue-500" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
              <Search size={32} className="text-gray-200" />
              <p className="text-sm">No products found</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
              {filteredProducts.map((product: any) => {
                const stock      = product.total_stock ?? 0;
                const outOfStock = stock <= 0;
                const catName    = product.category?.name ?? 'Other';
                const idx        = categoryColorIndex[catName] ?? 0;
                const color      = outOfStock
                  ? 'bg-gray-100 border border-gray-200 text-gray-400 opacity-60 cursor-not-allowed'
                  : TILE_COLORS[idx % TILE_COLORS.length];
                return (
                  <button
                    type="button"
                    key={product.id}
                    onClick={() => !outOfStock && handleAddProduct(product)}
                    disabled={outOfStock}
                    className={`${color} rounded-xl p-3 text-left transition-all active:scale-95 active:brightness-90
                      flex flex-col justify-between shadow-sm min-h-[88px] touch-manipulation`}
                  >
                    <span className="font-semibold text-sm leading-snug line-clamp-2 flex-1">
                      {product.name}
                    </span>
                    <div className="mt-2 flex items-end justify-between gap-1">
                      <span className="font-black text-sm tabular-nums font-mono">
                        {formatCurrency(parseFloat(product.selling_price))}
                      </span>
                      {!outOfStock && stock <= 10 && (
                        <span className="text-[10px] font-semibold opacity-60">{stock} left</span>
                      )}
                      {outOfStock && (
                        <span className="text-[10px] font-semibold text-red-500">Out</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: Cart sidebar */}
      <div className="w-80 xl:w-96 bg-white border-l border-gray-100 flex flex-col overflow-hidden flex-shrink-0">
        {/* Ticket header */}
        <div className="px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-lg font-bold text-gray-900">Ticket {ticketNum}</span>
            <button
              type="button"
              onClick={() => cart.clearCart()}
              aria-label="Clear cart (F5)"
              aria-keyshortcuts="F5"
              className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors"
            >
              <X size={13} /> Clear
            </button>
          </div>
          {/* Table selector */}
          <div className="flex items-center gap-2">
            <TableProperties size={15} className="text-gray-400 flex-shrink-0" />
            <select
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            >
              {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Customer selector */}
        <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <User size={15} className="text-gray-400 flex-shrink-0" />
            {cart.customerId ? (
              <div className="flex-1 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{cart.customerName}</span>
                <button onClick={() => cart.setCustomer(null, '')} type="button" className="text-gray-400 hover:text-red-500"><X size={13} /></button>
              </div>
            ) : (
              <div className="flex-1 relative">
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Walk-in customer (optional)"
                  className="w-full text-sm border-0 focus:outline-none text-gray-600 placeholder-gray-400 bg-transparent"
                />
                {(customerResults as any[])?.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-md shadow-xl z-10 mt-1 overflow-hidden">
                    {(customerResults as any[]).map((c: any) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => { cart.setCustomer(c.id, c.name); setCustomerSearch(''); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors"
                      >
                        <p className="font-medium text-gray-800">{c.name}</p>
                        <p className="text-xs text-gray-400">{c.phone || c.email}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {cart.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-3">
              <ShoppingCart size={40} />
              <p className="text-sm">Add items to start</p>
            </div>
          ) : (
            cart.items.map((item) => <CartRow key={item.product_id} item={item} format={formatCurrency} />)
          )}
        </div>

        {/* Totals */}
        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 space-y-1.5">
          <div className="flex justify-between text-sm text-gray-500">
            <span>Subtotal</span><span>{formatCurrency(cart.subtotal())}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>Tax</span><span>{formatCurrency(cart.taxTotal())}</span>
          </div>
          {cart.discount > 0 && (
            <div className="flex justify-between text-sm text-emerald-600">
              <span>Discount</span><span>-{formatCurrency(cart.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-xl font-bold text-gray-900 border-t border-gray-100 pt-2">
            <span>Total</span><span className="text-blue-600">{formatCurrency(total)}</span>
          </div>
        </div>

        {/* Payment methods */}
        <div className="px-5 pb-3 flex-shrink-0">
          {/* Split payment toggle */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment</span>
            <button
              type="button"
              onClick={() => { setIsSplitPayment(!isSplitPayment); setSplitPayments([]); }}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${isSplitPayment ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >
              Split Payment
            </button>
          </div>

          {isSplitPayment ? (
            <div className="space-y-2 mb-3">
              {splitPayments.map((sp, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-2">
                  <select value={sp.method} onChange={e => setSplitPayments(ps => ps.map((p,i) => i===idx ? {...p, method: e.target.value} : p))} className="text-xs border-0 bg-transparent focus:outline-none text-gray-700 font-medium">
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <input type="number" value={sp.amount} onChange={e => setSplitPayments(ps => ps.map((p,i) => i===idx ? {...p, amount: e.target.value} : p))} className="flex-1 text-sm text-right bg-transparent border-0 focus:outline-none font-semibold text-gray-800" placeholder="0.00" />
                  <button type="button" onClick={() => setSplitPayments(ps => ps.filter((_,i) => i!==idx))} className="text-red-400 hover:text-red-600"><X size={13} /></button>
                </div>
              ))}
              {(() => {
                const paid = splitPayments.reduce((s,p) => s + parseFloat(p.amount||'0'), 0);
                const remaining = total - paid;
                return (
                  <>
                    {remaining !== 0 && <div className={`text-xs text-right font-semibold ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{remaining > 0 ? `Remaining: ${formatCurrency(remaining)}` : `Over by: ${formatCurrency(-remaining)}`}</div>}
                    <button type="button" onClick={() => setSplitPayments(ps => [...ps, {method: PAYMENT_METHODS[0]?.value ?? 'cash', amount: remaining > 0 ? remaining.toFixed(2) : ''}])} className="w-full py-1.5 border-2 border-dashed border-gray-200 rounded-md text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center gap-1">
                      <Plus size={12} /> Add payment method
                    </button>
                  </>
                );
              })()}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {PAYMENT_METHODS.map(({ value, label, icon: Icon }, idx) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setPaymentMethod(value)}
                    aria-label={`Pay by ${label} (${idx + 1})`}
                    aria-pressed={paymentMethod === value}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-md text-xs font-semibold border-2 transition-all ${
                      paymentMethod === value
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-200 text-gray-500 hover:border-blue-200 hover:text-blue-600'
                    }`}
                  >
                    <Icon size={17} />
                    {label}
                    <span className={`text-xs font-mono ${paymentMethod === value ? 'text-blue-200' : 'text-gray-300'}`}>{idx + 1}</span>
                  </button>
                ))}
              </div>

              {paymentMethod === 'cash' && (
                <div className="mb-3">
                  <input
                    type="number"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value)}
                    placeholder="Cash tendered"
                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {change > 0 && (
                    <div className="mt-1.5 bg-emerald-50 rounded-lg px-3 py-1.5 flex justify-between text-sm">
                      <span className="text-gray-500">Change:</span>
                      <span className="font-bold text-emerald-600">{formatCurrency(change)}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <button
            type="button"
            onClick={handleProcessSale}
            disabled={cart.items.length === 0 || saleMutation.isPending || (!isSplitPayment && paymentMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) <= 0))}
            aria-label="Process sale (F9)"
            aria-keyshortcuts="F9"
            className={`w-full text-white font-bold py-3.5 rounded-md text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-md mb-2 ${
              isOnline
                ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-100'
                : 'bg-amber-500 hover:bg-amber-600 shadow-amber-100'
            }`}
          >
            {saleMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isOnline ? (
              <CreditCard size={16} />
            ) : (
              <WifiOff size={16} />
            )}
            {saleMutation.isPending
              ? 'Processing...'
              : isOnline
              ? `Process Sale  ${formatCurrency(total)}`
              : `Save Offline  ${formatCurrency(total)}`}
            {!saleMutation.isPending && <span className="ml-auto text-white/50 text-xs font-normal">F9</span>}
          </button>

          <button
            type="button"
            onClick={handleHoldOrder}
            disabled={cart.items.length === 0 || holdMutation.isPending}
            aria-label="Hold order (F8)"
            aria-keyshortcuts="F8"
            className="w-full border border-gray-200 hover:border-blue-300 text-gray-600 hover:text-blue-600 font-semibold py-2.5 rounded-md text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {holdMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <UtensilsCrossed size={14} />}
            Hold Order
            {!holdMutation.isPending && <span className="ml-auto text-gray-300 text-xs font-normal">F8</span>}
          </button>

          {/* Live kitchen orders panel */}
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <UtensilsCrossed size={12} />
                Live Orders
              </span>
              <div className="flex items-center gap-2 text-xs font-medium">
                <a href="/kitchen" target="_blank" rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-700 flex items-center gap-0.5">
                  Kitchen <ExternalLink size={10} />
                </a>
                <span className="text-gray-200">|</span>
                <a href="/queue" target="_blank" rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-700 flex items-center gap-0.5">
                  Queue <ExternalLink size={10} />
                </a>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="flex flex-col items-center bg-blue-50 rounded-lg py-2.5">
                <span className="text-2xl font-black text-blue-700 tabular-nums leading-none">{kdsNew}</span>
                <span className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mt-0.5">New</span>
              </div>
              <div className="flex flex-col items-center bg-amber-50 rounded-lg py-2.5">
                <span className="text-2xl font-black text-amber-700 tabular-nums leading-none">{kdsPreparing}</span>
                <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide mt-0.5">Cooking</span>
              </div>
              <div className="flex flex-col items-center bg-green-50 rounded-lg py-2.5">
                <span className="text-2xl font-black text-green-700 tabular-nums leading-none">{kdsReady}</span>
                <span className="text-[10px] font-semibold text-green-500 uppercase tracking-wide mt-0.5">Ready</span>
              </div>
            </div>
          </div>

          {/* Keyboard shortcuts hint */}
          <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap gap-x-3 gap-y-1">
            {[['/', 'Search'], ['F9', 'Charge'], ['F8', 'Hold'], ['F5', 'Clear'], ['1/2/3', 'Pay']].map(([key, label]) => (
              <span key={key} className="flex items-center gap-1 text-xs text-gray-400">
                <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">{key}</kbd>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
