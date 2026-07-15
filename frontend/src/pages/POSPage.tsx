import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, salesApi, settingsApi, customersApi } from '../api';
import type { CartItem, HeldOrder } from '../stores/cartStore';
import { useCartStore } from '../stores/cartStore';
import { usePosUIStore } from '../stores/posUIStore';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { buildReceiptDataFromSale, printReceipt, resolveReceiptPrintMode } from '../lib/hardware/printer';
import { broadcastCart } from '../lib/hardware/customerDisplay';
import { db } from '../lib/db';
import { offlineMutate } from '../lib/offlineMutation';
import { effectiveTaxRate } from '../lib/taxSettings';
import NumericKeypad from '../components/ui/NumericKeypad';
import CashNotesPad from '../components/ui/CashNotesPad';
import OnScreenKeyboard from '../components/ui/OnScreenKeyboard';
import {
  Search, Plus, Minus, Trash2, Loader2, CreditCard, Banknote, Smartphone,
  X, ShoppingCart, UtensilsCrossed, ShoppingBag, PauseCircle, PlayCircle, Clock, Keyboard, RefreshCw,
  User, Award,
  ChevronLeft, ChevronRight, Truck,
} from 'lucide-react';
import toast from 'react-hot-toast';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'mobile_money', label: 'Mobile', icon: Smartphone },
];

// Per-product accent colour for cart line items — distinct, stable colour per product id
const CART_LINE_ACCENTS = [
  'border-l-emerald-400', 'border-l-blue-400', 'border-l-purple-400', 'border-l-orange-400',
  'border-l-pink-400', 'border-l-teal-400', 'border-l-amber-400', 'border-l-red-400',
  'border-l-indigo-400', 'border-l-cyan-400',
];
function cartLineAccent(productId: number): string {
  return CART_LINE_ACCENTS[productId % CART_LINE_ACCENTS.length];
}

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
    <div className={`flex items-center gap-2 py-2 pl-3 border-l-4 border-b border-gray-50 last:border-b-0 ${cartLineAccent(item.product_id)}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => updateQty(item.product_id, item.quantity - 1)}
          className="w-8 h-8 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors touch-manipulation"
        >
          <Minus size={14} />
        </button>
        {/* Tap qty to open keypad */}
        <button
          type="button"
          onClick={openQtyEdit}
          className="w-9 h-8 text-center text-sm font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-md hover:bg-blue-50 hover:border-blue-300 transition-colors touch-manipulation"
          title="Tap to set quantity"
        >
          {item.quantity}
        </button>
        <button
          type="button"
          onClick={() => updateQty(item.product_id, item.quantity + 1)}
          className="w-8 h-8 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors touch-manipulation"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="w-14 text-right flex-shrink-0">
        <p className="text-xs text-gray-400 tabular-nums">{format(item.price)}</p>
      </div>
      <div className="w-16 text-right flex-shrink-0">
        <p className="text-sm font-bold text-gray-900 tabular-nums">{format(lineTotal)}</p>
      </div>
      <button type="button" onClick={() => removeItem(item.product_id)} className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-300 hover:text-white hover:bg-red-500 transition-colors touch-manipulation" title="Remove item">
        <Trash2 size={14} />
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
  const [productPage, setProductPage] = useState(0);
  const [showHeldOrders, setShowHeldOrders] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const cart = useCartStore();
  const { user } = useAuthStore();
  const { format: formatCurrency } = useCurrencyStore();
  const {
    showCustomerPicker, setShowCustomerPicker,
    showLoyaltyPanel, setShowLoyaltyPanel,
    showCoversKeypad, setShowCoversKeypad,
    coversInput, setCoversInput,
  } = usePosUIStore();
  const { paymentMethod, setPaymentMethod, cashTendered, setCashTendered, isSplitPayment, setIsSplitPayment, splitPayments, setSplitPayments } = cart;

  const branchId = user?.branch?.id ?? 1;
  const hw = useHardwareStore();
  const { activeCurrency } = useCurrencyStore();
  const currency = activeCurrency?.symbol ?? '$';

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
    queryKey: ['pos-products', user?.branch?.id],
    queryFn: async () => {
      try {
        // Always this till's own branch — even an admin ringing up a sale here
        // should only see what's actually on the shelf at this location.
        const data = await productsApi.list({ per_page: 500, is_active: 1, branch_id: user?.branch?.id })
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

  const allProducts: any[] = Array.isArray(allProductsData) ? allProductsData : [];

  // Derive categories
  const categories = ['All', ...Array.from(new Set(allProducts.map((p: any) => p.category?.name).filter(Boolean))) as string[]];

  // Filter products
  const filteredProducts = allProducts.filter((p: any) => {
    const matchCat = activeCategory === 'All' || p.category?.name === activeCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? '').toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  // Paginated instead of scrolled — the whole grid stays on screen
  const PRODUCTS_PER_PAGE = 200;
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE));
  const clampedPage = Math.min(productPage, pageCount - 1);
  const pagedProducts = filteredProducts.slice(clampedPage * PRODUCTS_PER_PAGE, (clampedPage + 1) * PRODUCTS_PER_PAGE);

  // Reset to page 1 whenever the visible product set changes
  useEffect(() => { setProductPage(0); }, [activeCategory, search]);

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
    totalDue: number;
    discount: number;
    paymentMethod: string;
    cashTendered: string;
    orderType: 'sit_in' | 'takeaway' | 'delivery';
    customerName: string;
    tableNumber: string;
    covers: number;
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
        reference: sale?.reference ?? `OFFLINE-${Date.now()}`,
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

      if (result.offline) toast.success('Sale finalized — saved locally, will sync automatically', { duration: 4000 });
      else toast.success('Sale finalized');

      const snapPayMethod = snap?.paymentMethod ?? 'cash';
      const snapTendered = snap?.cashTendered ?? '';
      const snapTotal = snap?.totalDue ?? snap?.total ?? 0;

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
          tinNumber: storeSettings?.company_tin_number,
          currencyCode: activeCurrency?.code ?? 'USD',
          currencyRate: activeCurrency?.exchange_rate ?? 1,
          posNumber: String(user?.branch?.id ?? 1),
          orderType: snap?.orderType ?? 'sit_in',
          branchName: user?.branch?.name,
          customerName: snap?.customerName || undefined,
          tableNumber: snap?.tableNumber || undefined,
          covers: snap?.covers,
          deviceId: storeSettings?.fiscal_device_id || undefined,
          fiscalDay: storeSettings?.fiscal_day || undefined,
          recGn: storeSettings?.fiscal_rec_gn || undefined,
          rec68: storeSettings?.fiscal_rec_68 || undefined,
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
    if (blockNegStock && product.track_stock !== false && stock !== null && stock <= 0) {
      toast.error(`${product.name} is out of stock`, { duration: 3000 });
      return;
    }
    cart.addItem({
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      price: parseFloat(product.selling_price),
      cost: parseFloat(product.cost_price || 0),
      tax_rate: effectiveTaxRate(product, storeSettings),
    });
    toast.success(`Added ${product.name}`, { duration: 800 });
  };

  // Search-box Enter — look up an exact SKU/barcode match (or a single filtered
  // result) and add it directly, so a cashier can key in a code without touching the grid
  const handleSearchEnter = () => {
    const code = search.trim();
    if (!code) return;
    const exact = allProducts.find((p: any) => (p.sku ?? '') === code || (p.barcode ?? '') === code);
    if (exact) { handleAddProduct(exact); setSearch(''); return; }
    if (filteredProducts.length === 1) { handleAddProduct(filteredProducts[0]); setSearch(''); return; }
    toast.error(`No exact match for "${code}"`);
  };

  const { data: customerResults, isFetching: customerSearching } = useQuery({
    queryKey: ['pos-customer-search', customerSearch],
    queryFn: () => customersApi.list({ search: customerSearch, per_page: 8 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
    enabled: showCustomerPicker && customerSearch.trim().length > 0,
  });

  const selectCustomer = (c: any) => {
    cart.setCustomer(c.id, c.name);
    setShowCustomerPicker(false);
    setCustomerSearch('');
  };

  const { data: loyaltyData, isLoading: loyaltyLoading } = useQuery({
    queryKey: ['pos-customer-loyalty', cart.customerId],
    queryFn: () => customersApi.getLoyalty(cart.customerId as number).then(r => r.data?.data),
    enabled: showLoyaltyPanel && !!cart.customerId,
  });

  const redeemLoyaltyMutation = useMutation({
    mutationFn: (points: number) => customersApi.redeemLoyalty(cart.customerId as number, points),
    onSuccess: () => {
      toast.success('Loyalty points redeemed');
      qc.invalidateQueries({ queryKey: ['pos-customer-loyalty'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not redeem points'),
  });

  const handleProcessSale = () => {
    if (cart.items.length === 0) return;

    let paymentsPayload: Array<{method: string; amount: number}>;
    if (isSplitPayment) {
      if (splitPayments.length === 0) { toast.error('Add at least one payment'); return; }
      // Amounts here are typed by the cashier in the active currency (same as
      // "Cash Tendered" and the note buttons) — compare against totalDue, and
      // convert back to the base currency (USD) before sending, same as every
      // other payment amount the backend receives.
      const splitTotal = splitPayments.reduce((s, p) => s + parseFloat(p.amount || '0'), 0);
      if (Math.abs(splitTotal - totalDue) > 0.01) { toast.error(`Split payments (${fmtActive(splitTotal)}) must equal total (${fmtActive(totalDue)})`); return; }
      paymentsPayload = splitPayments.map(p => ({ method: p.method, amount: parseFloat(p.amount) / exchangeRate }));
    } else {
      if (paymentMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) < totalDue)) {
        toast.error('Enter cash amount — must cover the total');
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
      totalDue,
      discount: cart.discount,
      paymentMethod: isSplitPayment ? 'split' : paymentMethod,
      cashTendered,
      orderType: cart.orderType,
      customerName: cart.customerName,
      tableNumber: cart.tableNumber !== 'Walk-in' ? cart.tableNumber : '',
      covers: cart.covers,
    };
    saleSnapshotRef.current = snap;

    const salePayload = {
      branch_id: branchId,
      warehouse_id: 1,
      customer_id: cart.customerId,
      table_number: cart.tableNumber !== 'Walk-in' ? cart.tableNumber : null,
      order_type: cart.orderType,
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
    cart.newTicket();
    setCashTendered('');
    setSplitPayments([]);
    setIsSplitPayment(false);

    saleMutation.mutate(salePayload);
  };

  const handleHoldOrder = () => {
    if (cart.items.length === 0) return;
    // Save current cart to local held orders and clear cart immediately
    const holdPayload = {
      branch_id: branchId,
      customer_id: cart.customerId,
      table_number: cart.tableNumber !== 'Walk-in' ? cart.tableNumber : null,
      order_type: cart.orderType,
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
    cart.newTicket();
    setCashTendered('');
    setSplitPayments([]);
    setIsSplitPayment(false);
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
    setShowHeldOrders(false);
    toast.success('Order resumed');
  };

  // cart.total() is always in the base currency (USD). Cash is tendered and
  // compared in whatever currency the cashier has selected (the note buttons,
  // "Exact", and split-payment amounts are all in that currency) — every
  // comparison against the amount due must use the converted figure, not the
  // raw USD total, or "Exact"/change/split-payment validation all break the
  // moment a non-USD currency is active.
  const total = cart.total();
  const exchangeRate = activeCurrency?.exchange_rate ?? 1;
  const totalDue = total * exchangeRate;
  const change = paymentMethod === 'cash' && parseFloat(cashTendered) > totalDue
    ? parseFloat(cashTendered) - totalDue : 0;
  const fmtActive = (n: number) => `${activeCurrency?.symbol ?? '$'}${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

  return (
    <>
      {/* Fixed height against the viewport (matching CashierPage's approach) rather than
          relying on AppLayout's <main> to propagate a bounded height through flex-1 —
          that element scrolls the whole page instead of just this page's own regions. */}
      <div className="-m-6 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>

      {/* Main content — ticket + payment always visible alongside the product grid */}
      <div className="flex-1 flex overflow-hidden gap-3 p-3 bg-gray-50 min-h-0">

        {/* Left: products + categories */}
        <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
          {/* Products card — search bar as its header, matching the theme of the
              categories card and the ticket card on the right */}
          <div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0">
              <form onSubmit={(e) => { e.preventDefault(); handleSearchEnter(); }} className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search product"
                  className="w-full pl-9 pr-9 py-2 border border-gray-200 focus:border-blue-400 rounded-lg text-sm bg-white focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowSearchModal(true)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-blue-500 hover:text-blue-700 touch-manipulation"
                  title="Open on-screen keyboard"
                >
                  <Keyboard size={14} />
                </button>
              </form>
            </div>

            <div className="flex-1 p-2 flex flex-col gap-2 min-h-0">
              {productsLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 size={28} className="animate-spin text-blue-500" />
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
                  <Search size={32} className="text-gray-200" />
                  <p className="text-sm">No products found</p>
                </div>
              ) : (
                <div className="flex-1 flex flex-wrap content-start gap-1 overflow-y-auto min-h-0">
                  {pagedProducts.map((product: any) => (
                    <button
                      type="button"
                      key={product.id}
                      title={`${product.name} — ${formatCurrency(parseFloat(product.selling_price))}`}
                      onClick={() => handleAddProduct(product)}
                      style={{ width: '1.7cm', height: '1.7cm' }}
                      className="bg-white hover:border-blue-300 hover:shadow-sm border border-gray-200 rounded p-1 flex flex-col items-center justify-center gap-0.5 transition-all touch-manipulation flex-shrink-0 overflow-hidden"
                    >
                      <span className="w-full text-[10px] font-semibold text-gray-800 text-center leading-none line-clamp-2">{product.name}</span>
                      <span className="text-[11px] font-black text-blue-700 tabular-nums leading-none">{formatCurrency(parseFloat(product.selling_price))}</span>
                    </button>
                  ))}
                </div>
              )}

              {pageCount > 1 && (
                <div className="flex items-center justify-center gap-3 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setProductPage((p) => Math.max(0, p - 1))}
                    disabled={clampedPage === 0}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors touch-manipulation"
                    title="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs font-semibold text-gray-500 tabular-nums">Page {clampedPage + 1} of {pageCount}</span>
                  <button
                    type="button"
                    onClick={() => setProductPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={clampedPage >= pageCount - 1}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors touch-manipulation"
                    title="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Categories — under the products, 1.7cm square tiles */}
          <div className="flex-shrink-0 bg-white rounded-lg border border-gray-100 shadow-sm p-2">
            <div className="flex flex-wrap gap-1">
              {categories.map((cat) => (
                <button
                  type="button"
                  key={cat}
                  title={cat === 'All' ? 'All Products' : cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{ width: '1.7cm', height: '1.7cm' }}
                  className={`flex-shrink-0 flex items-center justify-center text-center px-1 rounded text-[10px] font-semibold leading-none line-clamp-3 overflow-hidden transition-colors touch-manipulation
                    ${activeCategory === cat
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-blue-50 hover:text-blue-700'}`}
                >
                  {cat === 'All' ? 'All Products' : cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: ticket + payment (persistent, no separate screen) */}
        <div className="w-[38%] min-w-[340px] flex-shrink-0 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col overflow-y-auto min-h-0">
          {/* Header row */}
          <div className="flex items-center justify-between px-3 py-0.5 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900">Current Sale</span>
              {cart.heldOrders.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHeldOrders(true)}
                  className="relative flex items-center gap-1 px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-semibold transition-colors touch-manipulation"
                  title="View held orders"
                >
                  <PauseCircle size={12} />
                  {cart.heldOrders.length} held
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-gray-400 hover:text-blue-500 flex items-center gap-1 px-1.5 py-1 rounded-md transition-colors touch-manipulation"
                title="Refresh page if frozen"
              >
                <RefreshCw size={12} />
              </button>
              <button
                type="button"
                onClick={() => cart.clearCart()}
                aria-label="Clear sale (F5)"
                aria-keyshortcuts="F5"
                className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 px-1.5 py-1 rounded-md transition-colors touch-manipulation"
              >
                <Trash2 size={12} /> Clear
              </button>
            </div>
          </div>

          {/* Order type — table selection now lives in the top nav */}
          <div className="px-3 pt-1 flex-shrink-0">
            <div className="grid grid-cols-3 gap-1.5 mb-1.5">
              {[
                { value: 'sit_in' as const, label: 'Walk-in', icon: User },
                { value: 'takeaway' as const, label: 'Takeaway', icon: ShoppingBag },
                { value: 'delivery' as const, label: 'Delivery', icon: Truck },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => cart.setOrderType(value)}
                  className={`min-h-[50px] flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs font-semibold border transition-colors touch-manipulation ${
                    cart.orderType === value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            <div className="flex items-center text-[10px] font-semibold text-gray-400 uppercase tracking-wide pb-1 border-b border-gray-100">
              <span className="flex-1">Item</span>
              <span className="w-[92px] text-center flex-shrink-0">Qty</span>
              <span className="w-14 text-right flex-shrink-0">Price</span>
              <span className="w-16 text-right flex-shrink-0">Total</span>
              <span className="w-7 flex-shrink-0" />
            </div>
          </div>

          {/* Item list — the only flexible region; shrinks first so the payment
              controls below (Process Order in particular) never get pushed
              past the fold on shorter screens. */}
          <div className="flex-1 min-h-[36px] overflow-y-auto px-3">
            {cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
                <ShoppingCart size={32} />
                <p className="text-xs">Add items to start</p>
              </div>
            ) : (
              cart.items.map((item) => <CartRow key={item.product_id} item={item} format={formatCurrency} />)
            )}
          </div>

          {/* Totals */}
          <div className="px-3 py-0.5 border-t border-gray-100 flex-shrink-0">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Subtotal {formatCurrency(cart.subtotal())} · Tax {formatCurrency(cart.taxTotal())}</span>
              {cart.discount > 0 && <span className="text-emerald-600">-{formatCurrency(cart.discount)}</span>}
            </div>
            <div className="flex justify-between text-base font-bold text-gray-900">
              <span>Total</span><span className="text-blue-600">{formatCurrency(total)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="px-3 pb-1 border-t border-gray-100 pt-0.5 flex-shrink-0">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment</span>
              <button
                type="button"
                onClick={() => { setIsSplitPayment(!isSplitPayment); setSplitPayments([]); }}
                className={`min-h-[30px] text-xs px-3 py-1 rounded border font-medium transition-colors touch-manipulation ${isSplitPayment ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'}`}
              >
                Split
              </button>
            </div>

            {isSplitPayment ? (
              <div className="space-y-2 mb-2">
                {splitPayments.map((sp, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-2">
                    <select value={sp.method} onChange={e => setSplitPayments(ps => ps.map((p,i) => i===idx ? {...p, method: e.target.value} : p))} className="text-sm border-0 bg-transparent focus:outline-none text-gray-700 font-medium">
                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <input type="number" value={sp.amount} onChange={e => setSplitPayments(ps => ps.map((p,i) => i===idx ? {...p, amount: e.target.value} : p))} className="flex-1 text-base text-right bg-transparent border-0 focus:outline-none font-semibold text-gray-800" placeholder="0.00" />
                    <button type="button" onClick={() => setSplitPayments(ps => ps.filter((_,i) => i!==idx))} className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-600 touch-manipulation"><X size={14} /></button>
                  </div>
                ))}
                {(() => {
                  const paid = splitPayments.reduce((s,p) => s + parseFloat(p.amount||'0'), 0);
                  const remaining = totalDue - paid;
                  return (
                    <>
                      {remaining !== 0 && <div className={`text-xs text-right font-semibold ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{remaining > 0 ? `Remaining: ${fmtActive(remaining)}` : `Over by: ${fmtActive(-remaining)}`}</div>}
                      <button type="button" onClick={() => setSplitPayments(ps => [...ps, {method: PAYMENT_METHODS[0]?.value ?? 'cash', amount: remaining > 0 ? remaining.toFixed(2) : ''}])} className="w-full min-h-[40px] py-2 border-2 border-dashed border-gray-200 rounded-md text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center gap-2 touch-manipulation">
                        <Plus size={14} /> Add payment method
                      </button>
                    </>
                  );
                })()}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5 mb-1">
                  {PAYMENT_METHODS.map(({ value, label, icon: Icon }, idx) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setPaymentMethod(value)}
                      aria-label={`Pay by ${label} (${idx + 1})`}
                      aria-pressed={paymentMethod === value}
                      className={`min-h-[50px] flex flex-col items-center justify-center gap-0.5 py-1 rounded text-xs font-semibold border transition-all touch-manipulation ${
                        paymentMethod === value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'
                      }`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>

                {paymentMethod === 'cash' && (
                  <div className="mb-1">
                    <CashNotesPad
                      value={cashTendered}
                      onChange={setCashTendered}
                      onConfirm={() => {
                        if (cart.items.length > 0 && cashTendered && parseFloat(cashTendered) >= totalDue) handleProcessSale();
                      }}
                      label="Cash Tendered"
                      currencyCode={activeCurrency?.code ?? 'USD'}
                      totalDue={totalDue}
                      confirmLabel={change > 0 ? `✓  Change: ${fmtActive(change)}` : '✓ Process'}
                      confirmCls={cart.items.length > 0 && cashTendered && parseFloat(cashTendered) >= totalDue ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' : 'bg-gray-200 text-gray-400 border-gray-200'}
                      disabled={cart.items.length === 0 || saleMutation.isPending}
                    />
                  </div>
                )}
              </>
            )}

            {/* Process Order — the checkout action, always on this same screen */}
            <button
              type="button"
              onClick={handleProcessSale}
              disabled={cart.items.length === 0 || saleMutation.isPending || (!isSplitPayment && paymentMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) < totalDue))}
              aria-label="Process sale (F9)"
              aria-keyshortcuts="F9"
              className={`w-full min-h-[58px] text-white font-bold py-2.5 rounded-md text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-md mb-1.5 bg-blue-600 hover:bg-blue-700 shadow-blue-100 touch-manipulation ${!isSplitPayment && paymentMethod === 'cash' ? 'hidden' : ''}`}
            >
              {saleMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <CreditCard size={16} />
              )}
              {saleMutation.isPending ? 'Processing...' : `Process Order  ${formatCurrency(total)}`}
              {!saleMutation.isPending && <span className="ml-auto text-white/50 text-xs font-normal">F9</span>}
            </button>

            <button
              type="button"
              onClick={handleHoldOrder}
              disabled={cart.items.length === 0 || holdMutation.isPending}
              aria-label="Hold order (F8)"
              aria-keyshortcuts="F8"
              className="w-full min-h-[46px] bg-white border border-gray-200 hover:bg-blue-50 hover:border-blue-300 text-gray-600 hover:text-blue-700 font-semibold py-1.5 rounded text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 touch-manipulation"
            >
              {holdMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <PauseCircle size={13} />}
              Hold Order
              {!holdMutation.isPending && <span className="ml-auto text-gray-300 text-xs font-normal">F8</span>}
            </button>

            {/* Compact live kitchen status */}
            <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex items-center justify-between">
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
                <Link to="/kitchen" className="text-blue-500 hover:text-blue-700">KDS</Link>
                <span className="text-gray-200">·</span>
                <Link to="/queue" className="text-blue-500 hover:text-blue-700">Queue</Link>
              </div>
            </div>

            {/* Note — lowest priority, sits below the checkout actions */}
            <div className="mt-1.5 pt-1.5 border-t border-gray-100">
              <input
                value={cart.note}
                onChange={(e) => cart.setNote(e.target.value)}
                placeholder="Add note..."
                className="w-full text-xs text-gray-600 placeholder-gray-300 border-0 focus:outline-none bg-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer branding */}
      <div className="bg-white border-t border-gray-100 px-4 py-1.5 flex items-center gap-2 flex-shrink-0">
        <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
          <path d="M18 2L32.5 10.25V26.75L18 35L3.5 26.75V10.25Z" fill="#2563eb" />
          <circle cx="18" cy="18" r="8" stroke="white" strokeWidth="2" fill="none" opacity="0.5" />
          <circle cx="18" cy="18" r="4" fill="white" />
        </svg>
        <span className="font-bold text-blue-700 text-sm tracking-tight">Core</span>
        <span className="font-bold text-slate-500 text-sm tracking-tight">POS</span>
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
      <OnScreenKeyboard
        value={search}
        onChange={setSearch}
        onClose={() => { setShowSearchModal(false); searchRef.current?.focus(); }}
        placeholder="Search products by name or SKU..."
        label="Product Search"
      />
    )}

    {/* Change Covers keypad */}
    {showCoversKeypad && (
      <NumericKeypad
        modal
        value={coversInput}
        onChange={setCoversInput}
        onConfirm={() => {
          const n = parseInt(coversInput, 10);
          if (!isNaN(n) && n > 0) cart.setCovers(n);
          setShowCoversKeypad(false);
        }}
        onClose={() => setShowCoversKeypad(false)}
        label="Covers"
        allowDecimal={false}
        confirmLabel="✓ Set Covers"
        confirmCls="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
      />
    )}

    {/* Customer picker */}
    {showCustomerPicker && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><User size={18} className="text-blue-600" /> Customer</h2>
            <button type="button" onClick={() => { setShowCustomerPicker(false); setCustomerSearch(''); }} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"><X size={16} /></button>
          </div>
          <div className="p-4 space-y-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search customer by name or phone..."
                className="w-full pl-9 pr-3 py-2.5 border-2 border-gray-200 focus:border-blue-400 rounded-lg text-sm focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => { cart.setCustomer(null, ''); setShowCustomerPicker(false); setCustomerSearch(''); }}
              className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
            >
              Clear — use Walk-in
            </button>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {customerSearching && <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-gray-400" /></div>}
              {!customerSearching && customerSearch.trim() && (customerResults ?? []).length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">No customer matches "{customerSearch}"</p>
              )}
              {(customerResults ?? []).map((c: any) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => selectCustomer(c)}
                  className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.phone ?? c.email ?? ''}</p>
                  </div>
                  {c.loyalty_points != null && (
                    <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{c.loyalty_points} pts</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )}

    {/* Loyalty panel */}
    {showLoyaltyPanel && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Award size={18} className="text-amber-600" /> Loyalty — {cart.customerName}</h2>
            <button type="button" onClick={() => setShowLoyaltyPanel(false)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-4">
            {loyaltyLoading ? (
              <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
            ) : (
              <>
                <div className="text-center py-3 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-3xl font-black text-amber-700">{loyaltyData?.balance ?? 0}</p>
                  <p className="text-xs text-amber-600 font-semibold uppercase tracking-wide">Points Balance</p>
                </div>
                <button
                  type="button"
                  disabled={!loyaltyData?.balance || redeemLoyaltyMutation.isPending}
                  onClick={() => redeemLoyaltyMutation.mutate(loyaltyData.balance)}
                  className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {redeemLoyaltyMutation.isPending && <Loader2 size={15} className="animate-spin" />}
                  Redeem All Points
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
