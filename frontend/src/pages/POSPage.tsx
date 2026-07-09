import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, customersApi, salesApi, settingsApi } from '../api';
import type { CartItem, HeldOrder } from '../stores/cartStore';
import { useCartStore } from '../stores/cartStore';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { buildReceiptDataFromSale, printReceipt, resolveReceiptPrintMode } from '../lib/hardware/printer';
import { broadcastCart } from '../lib/hardware/customerDisplay';
import { useDBSync } from '../hooks/useDBSync';
import { db } from '../lib/db';
import { offlineMutate } from '../lib/offlineMutation';
import NumericKeypad from '../components/ui/NumericKeypad';
import SearchModal from '../components/ui/SearchModal';
import {
  Search, Plus, Minus, Trash2, User, Loader2, CreditCard, Banknote, Smartphone,
  X, ShoppingCart, TableProperties, UtensilsCrossed, ShoppingBag, PauseCircle, PlayCircle, Clock, Keyboard, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'mobile_money', label: 'Mobile', icon: Smartphone },
];

const TABLES = ['Walk-in', ...Array.from({ length: 20 }, (_, i) => `T-${i + 1}`)];

const TILE_COLORS_BY_THEME: Record<string, readonly string[]> = {
  rainbow: [
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
  ],
  blue: [
    'bg-blue-100   hover:bg-blue-200   text-blue-900   border border-blue-200',
    'bg-sky-100    hover:bg-sky-200    text-sky-900    border border-sky-200',
    'bg-cyan-100   hover:bg-cyan-200   text-cyan-900   border border-cyan-200',
    'bg-indigo-100 hover:bg-indigo-200 text-indigo-900 border border-indigo-200',
    'bg-blue-200   hover:bg-blue-300   text-blue-900   border border-blue-300',
    'bg-sky-200    hover:bg-sky-300    text-sky-900    border border-sky-300',
    'bg-cyan-200   hover:bg-cyan-300   text-cyan-900   border border-cyan-300',
    'bg-indigo-200 hover:bg-indigo-300 text-indigo-900 border border-indigo-300',
    'bg-blue-50    hover:bg-blue-100   text-blue-800   border border-blue-100',
    'bg-sky-50     hover:bg-sky-100    text-sky-800    border border-sky-100',
  ],
  green: [
    'bg-green-100   hover:bg-green-200   text-green-900   border border-green-200',
    'bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-200',
    'bg-teal-100    hover:bg-teal-200    text-teal-900    border border-teal-200',
    'bg-green-200   hover:bg-green-300   text-green-900   border border-green-300',
    'bg-emerald-200 hover:bg-emerald-300 text-emerald-900 border border-emerald-300',
    'bg-teal-200    hover:bg-teal-300    text-teal-900    border border-teal-300',
    'bg-green-50    hover:bg-green-100   text-green-800   border border-green-100',
    'bg-emerald-50  hover:bg-emerald-100 text-emerald-800 border border-emerald-100',
    'bg-teal-50     hover:bg-teal-100    text-teal-800    border border-teal-100',
    'bg-lime-100    hover:bg-lime-200    text-lime-900    border border-lime-200',
  ],
  warm: [
    'bg-orange-100 hover:bg-orange-200 text-orange-900 border border-orange-200',
    'bg-amber-100  hover:bg-amber-200  text-amber-900  border border-amber-200',
    'bg-yellow-100 hover:bg-yellow-200 text-yellow-900 border border-yellow-200',
    'bg-red-100    hover:bg-red-200    text-red-900    border border-red-200',
    'bg-pink-100   hover:bg-pink-200   text-pink-900   border border-pink-200',
    'bg-orange-200 hover:bg-orange-300 text-orange-900 border border-orange-300',
    'bg-amber-200  hover:bg-amber-300  text-amber-900  border border-amber-300',
    'bg-yellow-200 hover:bg-yellow-300 text-yellow-900 border border-yellow-300',
    'bg-red-50     hover:bg-red-100    text-red-800    border border-red-100',
    'bg-rose-100   hover:bg-rose-200   text-rose-900   border border-rose-200',
  ],
  monochrome: [
    'bg-gray-100  hover:bg-gray-200  text-gray-800  border border-gray-200',
    'bg-gray-50   hover:bg-gray-100  text-gray-700  border border-gray-200',
    'bg-white     hover:bg-gray-50   text-gray-800  border border-gray-200',
    'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200',
    'bg-zinc-100  hover:bg-zinc-200  text-zinc-800  border border-zinc-200',
    'bg-gray-200  hover:bg-gray-300  text-gray-800  border border-gray-300',
    'bg-slate-50  hover:bg-slate-100 text-slate-700 border border-slate-200',
    'bg-zinc-50   hover:bg-zinc-100  text-zinc-700  border border-zinc-200',
    'bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200',
    'bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200',
  ],
  dark: [
    'bg-gray-800  hover:bg-gray-700  text-white border border-gray-700',
    'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700',
    'bg-zinc-800  hover:bg-zinc-700  text-white border border-zinc-700',
    'bg-neutral-800 hover:bg-neutral-700 text-white border border-neutral-700',
    'bg-stone-800 hover:bg-stone-700 text-white border border-stone-700',
    'bg-gray-700  hover:bg-gray-600  text-white border border-gray-600',
    'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600',
    'bg-zinc-700  hover:bg-zinc-600  text-white border border-zinc-600',
    'bg-gray-900  hover:bg-gray-800  text-white border border-gray-800',
    'bg-slate-900 hover:bg-slate-800 text-white border border-slate-800',
  ],
};

// Default rainbow palette (kept for direct reference in the component)
const TILE_COLORS = TILE_COLORS_BY_THEME.rainbow;

function CartRow({ item, format }: { item: CartItem; format: (v: number) => string }) {
  const { updateQty, removeItem } = useCartStore();
  const [editingQty, setEditingQty] = useState(false);
  const [qtyInput, setQtyInput] = useState('');
  const lineTotal = (item.price - item.discount) * item.quantity;

  const openQtyEdit = () => { setQtyInput(String(item.quantity)); setEditingQty(true); };
  const confirmQty = () => {
    const n = parseInt(qtyInput, 10);
    if (!isNaN(n) && n > 0) updateQty(item.product_id, n);
    else if (n === 0) removeItem(item.product_id);
    setEditingQty(false);
  };

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-base font-medium text-gray-900 truncate">{item.name}</p>
        <p className="text-sm text-gray-400">{format(item.price)} each</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => updateQty(item.product_id, item.quantity - 1)}
          className="w-10 h-10 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors touch-manipulation"
        >
          <Minus size={16} />
        </button>
        {/* Tap qty to open keypad */}
        <button
          type="button"
          onClick={openQtyEdit}
          className="w-12 h-10 text-center text-base font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-md hover:bg-blue-50 hover:border-blue-300 transition-colors touch-manipulation"
          title="Tap to set quantity"
        >
          {item.quantity}
        </button>
        <button
          type="button"
          onClick={() => updateQty(item.product_id, item.quantity + 1)}
          className="w-10 h-10 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors touch-manipulation"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="w-20 text-right">
        <p className="text-base font-bold text-gray-900">{format(lineTotal)}</p>
      </div>
      <button type="button" onClick={() => removeItem(item.product_id)} className="w-10 h-10 flex items-center justify-center rounded-lg text-red-400 hover:text-white hover:bg-red-500 transition-colors touch-manipulation" title="Remove item">
        <Trash2 size={16} />
      </button>

      {/* Qty keypad modal */}
      {editingQty && (
        <NumericKeypad
          modal
          value={qtyInput}
          onChange={setQtyInput}
          onConfirm={confirmQty}
          onClose={() => setEditingQty(false)}
          label={`Quantity — ${item.name}`}
          allowDecimal={false}
          confirmLabel="✓ Set Qty"
          confirmCls="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
        />
      )}
    </div>
  );
}

export default function POSPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [tableNumber, setTableNumber] = useState('Walk-in');
  const [orderType, setOrderType] = useState<'sit_in' | 'takeaway'>('sit_in');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitPayments, setSplitPayments] = useState<Array<{method: string; amount: string}>>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [ticketNum, setTicketNum] = useState(() => `#${Math.floor(Math.random() * 9000) + 1000}`);
  const [showHeldOrders, setShowHeldOrders] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const cart = useCartStore();
  const { user } = useAuthStore();
  const { format: formatCurrency } = useCurrencyStore();

  const branchId = user?.branch?.id ?? 1;
  const hw = useHardwareStore();
  const { activeCurrency } = useCurrencyStore();
  const currency = activeCurrency?.symbol ?? '$';

  useDBSync();

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
  // Active colour palette — driven by the pos_tile_theme setting
  const activeTileColors = TILE_COLORS_BY_THEME[storeSettings?.pos_tile_theme ?? 'rainbow'] ?? TILE_COLORS;

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
    queryKey: ['customer-search', customerSearch],
    queryFn: () => customersApi.list({ search: customerSearch, per_page: 5 }).then((r) => r.data?.data?.data || []),
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

  // Snapshot of cart data captured at the moment Process Order is clicked.
  // Allows cart to be cleared immediately (no freeze) while mutation is in-flight.
  type CartSnapshot = {
    items: CartItem[];
    subtotal: number;
    tax: number;
    total: number;
    discount: number;
    paymentMethod: string;
    cashTendered: string;
    orderType: 'sit_in' | 'takeaway';
  };
  const saleSnapshotRef = useRef<CartSnapshot | null>(null);

  const saleMutation = useMutation({
    mutationFn: (payload: object) => offlineMutate(() => salesApi.create(payload), 'sales', 'create', payload as Record<string, unknown>),
    onSuccess: (result, variables) => {
      const sale = (result as any).data?.data;
      const snap = saleSnapshotRef.current;

      // Persist to IndexedDB so My Sales / Cashup / Dashboard work when API is unavailable
      const paymentsFromPayload = (variables as any).payments ?? [];
      const now = new Date().toISOString();
      db.sales.put({
        id: sale?.id ?? -(Date.now()),
        reference: sale?.reference ?? `ONLINE-${Date.now()}`,
        status: 'completed',
        total: snap?.total ?? 0,
        subtotal: snap?.subtotal ?? 0,
        tax: snap?.tax ?? 0,
        discount: snap?.discount ?? 0,
        items: (snap?.items ?? []).map(i => ({ name: i.name, qty: i.quantity, price: i.price, total: (i.price - i.discount) * i.quantity })),
        items_count: snap?.items?.length ?? 0,
        payments: paymentsFromPayload,
        cashier_id: user?.id ?? 0,
        cashier_name: user?.name ?? '',
        branch_id: branchId,
        created_at: now,
        completed_at: now,
        is_offline: !!result.offline,
      }).catch(() => {});

      if (result.offline) toast.success(`Sale ${sale?.reference} completed!`);
      else toast.success(`Sale ${sale?.reference} completed!`);

      const snapPayMethod = snap?.paymentMethod ?? 'cash';
      const snapTendered = snap?.cashTendered ?? '';
      const snapTotal = snap?.total ?? 0;

      void printReceipt(
        buildReceiptDataFromSale(sale ?? null, {
          storeName,
          storeAddress,
          storePhone,
          cashier: user?.name ?? '',
          currency,
          paymentMethod: snapPayMethod,
          amountTendered: snapPayMethod === 'cash' ? parseFloat(snapTendered) || snapTotal : undefined,
          change: snapPayMethod === 'cash' ? Math.max(0, (parseFloat(snapTendered) || 0) - snapTotal) : undefined,
          itemsFallback: (snap?.items ?? []).map((item) => ({
            name: item.name,
            qty: item.quantity,
            price: item.price,
            total: item.price * item.quantity,
          })),
          vatNumber: storeSettings?.company_vat_number,
          currencyCode: activeCurrency?.code ?? 'USD',
          currencyRate: activeCurrency?.exchange_rate ?? 1,
          posNumber: String(user?.branch?.id ?? 1),
          orderType: snap?.orderType ?? 'sit_in',
        }),
        resolveReceiptPrintMode(hw.printerMode)
      ).catch((error: any) => {
        toast.error(error?.message ?? 'Sale completed, but receipt printing failed');
      });

      broadcastCart({ type: 'thankyou', storeName, currency });
      setTimeout(() => broadcastCart({ type: 'idle', storeName, currency }), 4000);
      saleSnapshotRef.current = null;

      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: () => {
      // Restore cart from snapshot if the sale failed
      if (saleSnapshotRef.current) {
        toast.error('Sale failed. Your cart has been restored.');
        saleSnapshotRef.current = null;
      }
    },
  });

  const holdMutation = useMutation({
    mutationFn: (payload: object) => offlineMutate(() => salesApi.hold(payload), 'sales', 'hold', payload as Record<string, unknown>),
    onSuccess: (_result) => {
      qc.invalidateQueries({ queryKey: ['held-sales-dashboard'] });
      // Cart already cleared in handleHoldOrder — nothing more to do here
    },
  });

  const handleAddProduct = (product: any) => {
    // Block sale if stock is zero/negative and setting is enabled
    const stock = product.total_stock ?? product.stock_quantity ?? product.quantity_in_stock ?? null;
    const blockNegStock = storeSettings?.block_negative_stock !== 'false' && storeSettings?.block_negative_stock !== false;
    if (blockNegStock && stock !== null && stock <= 0) {
      toast.error(`${product.name} is out of stock`, { duration: 3000 });
      return;
    }
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

    // Capture snapshot BEFORE clearing — allows immediate cart reset without freezing
    const snap: CartSnapshot = {
      items: [...cart.items],
      subtotal: cart.subtotal(),
      tax: cart.taxTotal(),
      total: cart.total(),
      discount: cart.discount,
      paymentMethod: isSplitPayment ? 'split' : paymentMethod,
      cashTendered,
      orderType,
    };
    saleSnapshotRef.current = snap;

    const salePayload = {
      branch_id: branchId,
      warehouse_id: 1,
      customer_id: cart.customerId,
      table_number: tableNumber !== 'Walk-in' ? tableNumber : null,
      order_type: orderType,
      items: snap.items.map((i) => ({
        product_id: i.product_id,
        product_variant_id: i.variant_id,
        quantity: i.quantity,
        unit_price: i.price,
        discount_type: i.discount > 0 ? 'fixed' : null,
        discount_value: i.discount > 0 ? i.discount : 0,
      })),
      payments: paymentsPayload,
      discount_value: snap.discount,
      notes: cart.note,
    };

    // Clear UI immediately so cashier can start next sale without waiting for API
    cart.clearCart();
    setCashTendered('');
    setSplitPayments([]);
    setIsSplitPayment(false);
    setTicketNum(`#${Math.floor(Math.random() * 9000) + 1000}`);

    saleMutation.mutate(salePayload);
  };

  const handleHoldOrder = () => {
    if (cart.items.length === 0) return;
    // Save current cart to local held orders and clear cart immediately
    const holdPayload = {
      branch_id: branchId,
      customer_id: cart.customerId,
      table_number: tableNumber !== 'Walk-in' ? tableNumber : null,
      order_type: orderType,
      cart_data: {
        items: cart.items,
        subtotal: cart.subtotal(),
        tax: cart.taxTotal(),
        total: cart.total(),
        discount: cart.discount,
      },
      note: cart.note,
    };
    cart.holdCurrentCart();
    setCashTendered('');
    setSplitPayments([]);
    setIsSplitPayment(false);
    setTicketNum(`#${Math.floor(Math.random() * 9000) + 1000}`);
    toast.success('Order held — start a new order or tap a held order to resume', { duration: 3000 });
    // Sync to server in background (non-blocking)
    holdMutation.mutate(holdPayload);
  };

  const handleRestoreHeld = (heldId: string) => {
    if (cart.items.length > 0) {
      // Hold current cart first, then restore the selected one
      cart.holdCurrentCart();
    }
    cart.restoreHeldOrder(heldId);
    setTicketNum(`#${Math.floor(Math.random() * 9000) + 1000}`);
    setShowHeldOrders(false);
    toast.success('Order resumed');
  };

  const total = cart.total();
  const change = paymentMethod === 'cash' && parseFloat(cashTendered) > total
    ? parseFloat(cashTendered) - total : 0;

  return (
    <>
      <div className="flex flex-1 overflow-hidden">
      {/* Left: product area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Search bar */}
        <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex-shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by name or SKU... (F2)"
              className="w-full pl-10 pr-20 py-2.5 border-2 border-blue-400 focus:border-blue-600 rounded-xl text-sm
                bg-blue-50 focus:bg-white focus:outline-none transition-colors"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')}
                className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
            {/* Touch keyboard button */}
            <button
              type="button"
              onClick={() => setShowSearchModal(true)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded-lg touch-manipulation"
              title="Open on-screen keyboard"
            >
              <Keyboard size={15} />
            </button>
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
                const catName = product.category?.name ?? 'Other';
                const idx     = categoryColorIndex[catName] ?? 0;
                const color   = activeTileColors[idx % activeTileColors.length];
                return (
                  <button
                    type="button"
                    key={product.id}
                    onClick={() => handleAddProduct(product)}
                    className={`${color} rounded-xl p-3 text-left transition-all active:scale-95 active:brightness-90
                      flex flex-col justify-between shadow-sm min-h-[88px] touch-manipulation`}
                  >
                    <span className="font-semibold text-sm leading-snug line-clamp-2 flex-1">
                      {product.name}
                    </span>
                    <span className="mt-2 font-black text-sm tabular-nums font-mono">
                      {formatCurrency(parseFloat(product.selling_price))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: Cart sidebar */}
      <div className="w-[33.333%] min-w-[380px] xl:min-w-[440px] 2xl:min-w-[500px] max-w-[580px] bg-white border-l border-gray-100 flex flex-col overflow-hidden flex-shrink-0">
        {/* Ticket header */}
        <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-gray-900">Ticket {ticketNum}</span>
              {/* Held orders badge */}
              {cart.heldOrders.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHeldOrders(true)}
                  className="relative flex items-center gap-1 px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-semibold transition-colors touch-manipulation"
                  title="View held orders"
                >
                  <PauseCircle size={13} />
                  {cart.heldOrders.length} held
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] text-sm text-gray-400 hover:text-blue-500 flex items-center gap-1 px-3 py-2 rounded-md transition-colors touch-manipulation"
                title="Refresh page if frozen"
              >
                <RefreshCw size={15} />
              </button>
              <button
                type="button"
                onClick={() => cart.clearCart()}
                aria-label="Clear cart (F5)"
                aria-keyshortcuts="F5"
                className="min-h-[44px] text-sm text-gray-400 hover:text-red-500 flex items-center gap-1 px-3 py-2 rounded-md transition-colors touch-manipulation"
              >
                <X size={16} /> Clear
              </button>
            </div>
          </div>
          {/* Sit-in / Takeaway + Table in one row */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOrderType('sit_in')}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold border transition-colors touch-manipulation ${
                orderType === 'sit_in'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <UtensilsCrossed size={16} /> Sit-in
            </button>
            <button
              type="button"
              onClick={() => setOrderType('takeaway')}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold border transition-colors touch-manipulation ${
                orderType === 'takeaway'
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <ShoppingBag size={16} /> Takeaway
            </button>
            <div className="flex items-center gap-2 flex-1">
              <TableProperties size={16} className="text-gray-400 flex-shrink-0" />
              <select
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded-md px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
              >
                {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Customer selector */}
        <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <User size={17} className="text-gray-400 flex-shrink-0" />
            {cart.customerId ? (
              <div className="flex-1 flex items-center justify-between">
                <span className="text-base font-medium text-gray-700">{cart.customerName}</span>
                <button onClick={() => cart.setCustomer(null, '')} type="button" className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-red-500 touch-manipulation"><X size={16} /></button>
              </div>
            ) : (
              <div className="flex-1 relative">
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Walk-in customer (optional)"
                  className="w-full text-base border-0 focus:outline-none text-gray-600 placeholder-gray-400 bg-transparent py-2"
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
        <div className="flex-1 overflow-y-auto px-5 py-3">
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
        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0 space-y-2">
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
          <div className="flex justify-between text-2xl font-bold text-gray-900 border-t border-gray-100 pt-3">
            <span>Total</span><span className="text-blue-600">{formatCurrency(total)}</span>
          </div>
        </div>

        {/* Payment methods */}
        <div className="px-5 pb-4 flex-shrink-0">
          {/* Split payment toggle */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Payment</span>
            <button
              type="button"
              onClick={() => { setIsSplitPayment(!isSplitPayment); setSplitPayments([]); }}
              className={`min-h-[44px] text-sm px-4 py-2 rounded-lg font-medium transition-colors touch-manipulation ${isSplitPayment ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >
              Split
            </button>
          </div>

          {isSplitPayment ? (
            <div className="space-y-2.5 mb-3">
              {splitPayments.map((sp, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-3">
                  <select value={sp.method} onChange={e => setSplitPayments(ps => ps.map((p,i) => i===idx ? {...p, method: e.target.value} : p))} className="text-sm border-0 bg-transparent focus:outline-none text-gray-700 font-medium">
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <input type="number" value={sp.amount} onChange={e => setSplitPayments(ps => ps.map((p,i) => i===idx ? {...p, amount: e.target.value} : p))} className="flex-1 text-base text-right bg-transparent border-0 focus:outline-none font-semibold text-gray-800" placeholder="0.00" />
                  <button type="button" onClick={() => setSplitPayments(ps => ps.filter((_,i) => i!==idx))} className="w-10 h-10 flex items-center justify-center text-red-400 hover:text-red-600 touch-manipulation"><X size={16} /></button>
                </div>
              ))}
              {(() => {
                const paid = splitPayments.reduce((s,p) => s + parseFloat(p.amount||'0'), 0);
                const remaining = total - paid;
                return (
                  <>
                    {remaining !== 0 && <div className={`text-sm text-right font-semibold ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{remaining > 0 ? `Remaining: ${formatCurrency(remaining)}` : `Over by: ${formatCurrency(-remaining)}`}</div>}
                    <button type="button" onClick={() => setSplitPayments(ps => [...ps, {method: PAYMENT_METHODS[0]?.value ?? 'cash', amount: remaining > 0 ? remaining.toFixed(2) : ''}])} className="w-full min-h-[52px] py-3 border-2 border-dashed border-gray-200 rounded-md text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center gap-2 touch-manipulation">
                      <Plus size={16} /> Add payment method
                    </button>
                  </>
                );
              })()}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2.5 mb-3">
                {PAYMENT_METHODS.map(({ value, label, icon: Icon }, idx) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setPaymentMethod(value)}
                    aria-label={`Pay by ${label} (${idx + 1})`}
                    aria-pressed={paymentMethod === value}
                    className={`min-h-[56px] flex items-center justify-center gap-2 py-4 rounded-md text-sm font-semibold border-2 transition-all touch-manipulation ${
                      paymentMethod === value
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-200 text-gray-500 hover:border-blue-200 hover:text-blue-600'
                    }`}
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                ))}
              </div>

              {paymentMethod === 'cash' && (
                <div className="mb-3">
                  {/* Inline numeric keypad — no external keyboard needed */}
                  <NumericKeypad
                    value={cashTendered}
                    onChange={setCashTendered}
                    onConfirm={() => {
                      if (cart.items.length > 0 && cashTendered && parseFloat(cashTendered) > 0) handleProcessSale();
                    }}
                    label="Cash Tendered"
                    confirmLabel={change > 0 ? `✓  Change: ${formatCurrency(change)}` : '✓ Process'}
                    confirmCls={cart.items.length > 0 && cashTendered && parseFloat(cashTendered) > 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600' : 'bg-gray-200 text-gray-400 border-gray-200'}
                    disabled={cart.items.length === 0 || saleMutation.isPending}
                  />
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
            className={`w-full min-h-[64px] text-white font-bold py-4 rounded-md text-base transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-md mb-2 bg-blue-600 hover:bg-blue-700 shadow-blue-100 touch-manipulation ${!isSplitPayment && paymentMethod === 'cash' ? 'hidden' : ''}`}
          >
            {saleMutation.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <CreditCard size={18} />
            )}
            {saleMutation.isPending
              ? 'Processing...'
              : `Process Order  ${formatCurrency(total)}`}
            {!saleMutation.isPending && <span className="ml-auto text-white/50 text-xs font-normal">F9</span>}
          </button>

          <button
            type="button"
            onClick={handleHoldOrder}
            disabled={cart.items.length === 0 || holdMutation.isPending}
            aria-label="Hold order (F8)"
            aria-keyshortcuts="F8"
            className="w-full min-h-[56px] border border-gray-200 hover:border-amber-300 text-gray-600 hover:text-amber-700 font-semibold py-3.5 rounded-md text-base transition-colors flex items-center justify-center gap-2 disabled:opacity-50 touch-manipulation"
          >
            {holdMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <PauseCircle size={16} />}
            Hold Order
            {!holdMutation.isPending && <span className="ml-auto text-gray-300 text-xs font-normal">F8</span>}
          </button>

          {/* Compact live kitchen status */}
          <div className="mt-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                  <UtensilsCrossed size={11} /> Kitchen
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">
                    {kdsNew} <span className="font-normal text-blue-400">new</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">
                    {kdsPreparing} <span className="font-normal text-amber-400">cooking</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 rounded px-1.5 py-0.5">
                    {kdsReady} <span className="font-normal text-green-400">ready</span>
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Link to="/kitchen" className="text-blue-500 hover:text-blue-700 flex items-center gap-0.5">
                  KDS
                </Link>
                <Link to="/queue" className="text-blue-500 hover:text-blue-700 flex items-center gap-0.5">
                  Queue
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Held Orders Panel */}
    {showHeldOrders && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <PauseCircle size={18} className="text-amber-600" />
              <h2 className="font-bold text-gray-900">Held Orders</h2>
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{cart.heldOrders.length}</span>
            </div>
            <button type="button" onClick={() => setShowHeldOrders(false)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.heldOrders.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">No held orders</p>
            ) : (
              cart.heldOrders.map((held: HeldOrder) => (
                <div key={held.id} className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{held.label}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                      <Clock size={11} />
                      {new Date(held.heldAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      &nbsp;·&nbsp;{held.items.length} item{held.items.length !== 1 ? 's' : ''}
                      &nbsp;·&nbsp;{formatCurrency(held.items.reduce((s, i) => s + (i.price - i.discount) * i.quantity, 0))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRestoreHeld(held.id)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold transition-colors touch-manipulation"
                    >
                      <PlayCircle size={13} /> Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => cart.removeHeldOrder(held.id)}
                      className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors touch-manipulation"
                      title="Discard held order"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center">Tap Resume to restore a held order. Your current cart will be held automatically if not empty.</p>
          </div>
        </div>
      </div>
    )}

    {/* Touch keyboard search modal */}
    {showSearchModal && (
      <SearchModal
        value={search}
        onChange={setSearch}
        onClose={() => { setShowSearchModal(false); searchRef.current?.focus(); }}
        placeholder="Search products by name or SKU..."
        label="Product Search"
      />
    )}
    </>
  );
}
