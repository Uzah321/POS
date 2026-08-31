import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { productsApi, salesApi, settingsApi } from '../api';
import { useCartStore, type CartItem } from '../stores/cartStore';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { buildReceiptDataFromSale, printReceipt, resolveReceiptPrintMode } from '../lib/hardware/printer';
import { broadcastCart } from '../lib/hardware/customerDisplay';
import { useWeighingScale, toKg } from '../lib/hardware/scale';
import { db } from '../lib/db';
import { offlineMutate } from '../lib/offlineMutation';
import { effectiveTaxRate } from '../lib/taxSettings';
import { useServerHealth } from '../hooks/useServerHealth';
import CashNotesPad from '../components/ui/CashNotesPad';
import OnScreenKeyboard from '../components/ui/OnScreenKeyboard';
import NumericKeypad from '../components/ui/NumericKeypad';
import { cartLineAccent } from '../lib/tileColors';
import { Loader2, Trash2, RefreshCw, Keyboard, TableProperties, LayoutGrid, Ban, X, PlayCircle, Search, Scale as ScaleIcon, Banknote, CreditCard, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';

const PAY_METHODS = [
  { value: 'cash',         label: 'CASH',   key: 'F1', icon: Banknote,    activeClass: 'bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-200' },
  { value: 'card',         label: 'CARD',   key: 'F2', icon: CreditCard,  activeClass: 'bg-blue-600    border-blue-600    text-white shadow-md shadow-blue-200' },
  { value: 'mobile_money', label: 'MOBILE', key: 'F3', icon: Smartphone,  activeClass: 'bg-purple-600  border-purple-600  text-white shadow-md shadow-purple-200' },
] as const;

type PayMethod = typeof PAY_METHODS[number]['value'];

const TABLES = ['Walk-in', ...Array.from({ length: 20 }, (_, i) => `T-${i + 1}`)];

export default function CashierPage() {
  const [codeInput, setCodeInput]             = useState('');
  const [payMethod, setPayMethod]             = useState<PayMethod>('cash');
  const [cashTendered, setCashTendered]       = useState('');
  const [currentTime, setCurrentTime]         = useState(new Date());
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showOpenTables, setShowOpenTables]   = useState(false);
  const [showVoidModal, setShowVoidModal]     = useState(false);
  const [editingQtyItem, setEditingQtyItem]   = useState<CartItem | null>(null);
  const [qtyInput, setQtyInput]               = useState('');
  // A weight-priced product tapped with no live scale reading — prompts for
  // a hand-entered weight before anything is added to the cart.
  const [pendingWeightProduct, setPendingWeightProduct] = useState<any | null>(null);
  const [weightInput, setWeightInput]         = useState('');
  const [voidSearch, setVoidSearch]           = useState('');
  // Live results dropdown under the Scan/PLU box — only while that input is
  // focused, so it doesn't linger once the cashier taps elsewhere.
  const [showBrowseDropdown, setShowBrowseDropdown] = useState(false);

  const codeRef     = useRef<HTMLInputElement>(null);
  const tenderedRef = useRef<HTMLInputElement>(null);
  const kbRef       = useRef<any>({});

  const qc           = useQueryClient();
  const cart         = useCartStore();
  const { user }     = useAuthStore();
  const { format: formatCurrency, activeCurrency } = useCurrencyStore();
  const hw           = useHardwareStore();
  const currency     = activeCurrency?.symbol ?? '$';
  const branchId     = user?.branch?.id ?? 1;
  const scale        = useWeighingScale({ mode: hw.scaleMode, baudRate: hw.scaleBaudRate, host: hw.scaleHost, port: hw.scalePort });
  const scaleActive  = hw.scaleMode === 'webserial' || hw.scaleMode === 'network';
  // A reading counts as "live" only while the scale is actually connected —
  // once disconnected, stop trusting whatever the last value happened to be.
  const liveKg       = scaleActive && scale.connected && scale.weight ? toKg(scale.weight) : null;

  const { isServerUp: isOnline } = useServerHealth();

  // Clock
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-focus code input on mount
  useEffect(() => { codeRef.current?.focus(); }, []);

  // Store settings (cached)
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
    // Was 5 minutes — a saved settings change (e.g. block_negative_stock)
    // could sit invisible on an already-open till. Cheap to refetch, so just
    // always check on mount instead of trusting a stale cache.
    staleTime: 0,
  });

  const storeName    = storeSettings?.company_name || 'Core';
  const storeAddress = user?.branch?.address || storeSettings?.company_address;
  const storePhone   = user?.branch?.phone   || storeSettings?.company_phone;
  const isRestaurant = storeSettings?.business_type === 'restaurant';

  // Live KDS orders — only when restaurant mode
  const { data: kdsData } = useQuery({
    queryKey: ['cashier-kds'],
    queryFn: () => axios.get('/api/kds/orders').then(r => r.data),
    refetchInterval: 3000,
    enabled: isRestaurant,
    refetchOnWindowFocus: true,
  });
  const kdsOrders: any[] = kdsData?.data ?? [];

  // Products (IndexedDB fallback when offline)
  const { data: allProductsData, isLoading: productsLoading } = useQuery({
    queryKey: ['pos-products', user?.branch?.id],
    queryFn: async () => {
      try {
        // Always this till's own branch — even an admin ringing up a sale here
        // should only see what's actually on the shelf at this location.
        const data = await productsApi.list({ per_page: 500, is_active: 1, branch_id: user?.branch?.id })
          .then(r => r.data?.data?.data ?? r.data?.data ?? []);
        db.products.clear().then(() => db.products.bulkPut(data)).catch(() => {});
        return data;
      } catch {
        const cached = await db.products.toArray();
        return cached.length > 0 ? cached : [];
      }
    },
    // Product edits (price, color, image, stock), or stock moved by a sale on
    // another till, must show up here without reloading.
    staleTime: 0,
    refetchInterval: 10000,
    // App-wide default (App.tsx) turns this off so slow-changing lists don't
    // re-fetch on every alt-tab — but a till is often left open in a
    // background tab for a while, where browsers throttle the interval above
    // to a crawl. Force a fresh fetch the moment the tab regains focus so
    // stock/prices catch up immediately instead of waiting out the throttle.
    refetchOnWindowFocus: true,
  });

  const allProducts: any[] = Array.isArray(allProductsData) ? allProductsData : [];

  // Live matches for the Scan/PLU box — feeds the exact-match/single-match
  // fallback in handleCodeSubmit below, the on-screen-keyboard close handler,
  // and the results dropdown shown under the input while typing.
  const browseQuery = codeInput.trim().toLowerCase();
  const browseMatches = allProducts.filter(p =>
    !browseQuery ||
    p.name.toLowerCase().includes(browseQuery) ||
    (p.sku ?? '').toLowerCase().includes(browseQuery) ||
    (p.barcode ?? '').toLowerCase().includes(browseQuery)
  );

  // Barcode scanner — instant add on exact SKU/barcode match
  const handleBarcodeScan = useCallback((code: string) => {
    const product = allProducts.find(p =>
      (p.sku ?? '').toLowerCase() === code.toLowerCase() ||
      (p.barcode ?? '').toLowerCase() === code.toLowerCase()
    );
    if (product) {
      addProduct(product);
    } else {
      setCodeInput(code);
      codeRef.current?.focus();
    }
  }, [allProducts]);

  useBarcodeScanner({ enabled: hw.barcodeScannerEnabled, onScan: handleBarcodeScan });

  // Auto-fill the weight prompt the moment the scale settles on a reading —
  // only while the cashier hasn't started typing a value by hand.
  useEffect(() => {
    if (pendingWeightProduct && weightInput === '' && liveKg && liveKg > 0) {
      setWeightInput(String(Math.round(liveKg * 1000) / 1000));
    }
  }, [liveKg, pendingWeightProduct, weightInput]);

  // Broadcast cart to customer display
  useEffect(() => {
    if (!hw.customerDisplayEnabled) return;
    broadcastCart({
      type: cart.items.length > 0 ? 'cart' : 'idle',
      storeName, currency,
      items: cart.items.map(i => ({ name: i.name, qty: i.quantity, price: i.price, total: i.price * i.quantity })),
      subtotal: cart.subtotal(), tax: cart.taxTotal(), discount: cart.discount, total: cart.total(),
    });
  }, [cart.items, hw.customerDisplayEnabled]);

  // Shared by both the direct-add path (live scale reading, or a plain
  // count item) and the manual-weight-entry path below — keeps the price
  // check / stock check / toast messaging identical for both.
  const addProductWithQty = (product: any, qty: number, soldByWeight: boolean): boolean => {
    const price = parseFloat(product.selling_price);
    if (!price || Number.isNaN(price) || price <= 0) {
      toast.error(`${product.name} has no price set — add a price before selling it`);
      return false;
    }
    // Scanning/tapping a product already in the cart adds a new line rather
    // than bumping an existing one — so the stock check here must sum every
    // line already in the cart for this product, not just look up one.
    const existingQty = cart.items.filter((i) => i.product_id === product.id).reduce((s, i) => s + i.quantity, 0);
    const stock = product.total_stock ?? product.stock_quantity ?? product.quantity_in_stock ?? null;
    const blockNeg = storeSettings?.block_negative_stock !== 'false' && storeSettings?.block_negative_stock !== false;
    if (blockNeg && product.track_stock !== false && stock !== null && existingQty + qty > stock) {
      toast.error(stock <= 0 ? `${product.name} is out of stock` : `Only ${stock} ${product.name} in stock`);
      return false;
    }
    cart.addItem({
      product_id: product.id,
      name:       product.name,
      sku:        product.sku,
      price,
      cost:       parseFloat(product.cost_price || 0),
      tax_rate:   effectiveTaxRate(product, storeSettings),
      sold_by_weight: soldByWeight,
    }, qty);
    return true;
  };

  const addProduct = (product: any) => {
    const soldByWeight = !!product.sold_by_weight;
    if (soldByWeight) {
      // Use the live scale reading (in kg) if one's available. Otherwise
      // prompt for a hand-entered weight — nothing is added to the cart
      // until a real weight is confirmed, so a dismissed prompt never
      // leaves a phantom "1 kg" line behind.
      const kg = liveKg && liveKg > 0 ? Math.round(liveKg * 1000) / 1000 : null;
      if (kg === null) {
        if (scaleActive && !scale.connected) toast.error(`${product.name} is sold by weight — scale isn't connected, enter the weight manually`);
        setPendingWeightProduct(product);
        setWeightInput('');
        return;
      }
      if (addProductWithQty(product, kg, true)) {
        setCodeInput('');
        setTimeout(() => codeRef.current?.focus(), 40);
      }
      return;
    }
    if (addProductWithQty(product, 1, false)) {
      setCodeInput('');
      setTimeout(() => codeRef.current?.focus(), 40);
    }
  };

  const confirmPendingWeight = () => {
    if (!pendingWeightProduct) return;
    const n = parseFloat(weightInput);
    if (!isNaN(n) && n > 0) addProductWithQty(pendingWeightProduct, Math.round(n * 1000) / 1000, true);
    setPendingWeightProduct(null);
    setCodeInput('');
    setTimeout(() => codeRef.current?.focus(), 40);
  };

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const q = codeInput.trim();
    if (!q) return;

    const ql = q.toLowerCase();
    const exact = allProducts.find(p =>
      (p.sku ?? '').toLowerCase() === ql ||
      (p.barcode ?? '').toLowerCase() === ql
    );
    if (exact) { addProduct(exact); return; }

    // Otherwise fall back to whatever the live name/sku/barcode filter has
    // already narrowed things down to.
    if (browseMatches.length === 0) {
      toast.error(`"${q}" not found`);
    } else if (browseMatches.length === 1) {
      addProduct(browseMatches[0]);
    } else {
      toast.error(`Multiple matches for "${q}" — scan the barcode or type more of the name`);
    }
  };

  // ── Sale mutation ────────────────────────────────────────────────────────────
  const saleMutation = useMutation({
    mutationFn: (payload: object) => offlineMutate(() => salesApi.create(payload), 'sales', 'create', payload as Record<string, unknown>),
    onSuccess: (result, variables) => {
      const sale = (result as any).data?.data;

      // Persist to IndexedDB so My Sales / Cashup / Dashboard work when API is unavailable
      const paymentsFromPayload = (variables as any).payments ?? [];
      const now = new Date().toISOString();
      db.sales.put({
        id: sale?.id ?? -(Date.now()),
        reference: sale?.reference ?? `OFFLINE-${Date.now()}`,
        status: 'completed',
        total: cart.total(),
        subtotal: cart.subtotal(),
        tax: cart.taxTotal(),
        discount: 0,
        items: cart.items.map(i => ({ name: i.name, qty: i.quantity, price: i.price, total: i.price * i.quantity })),
        items_count: cart.items.length,
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

      void printReceipt(
        buildReceiptDataFromSale(sale ?? null, {
          storeName, storeAddress, storePhone,
          cashier: user?.name ?? '', currency,
          paymentMethod: payMethod,
          amountTendered: payMethod === 'cash' ? parseFloat(cashTendered) || totalDue : undefined,
          change: payMethod === 'cash' ? Math.max(0, (parseFloat(cashTendered) || 0) - totalDue) : undefined,
          itemsFallback: cart.items.map(i => ({ name: i.name, qty: i.quantity, price: i.price, total: i.price * i.quantity })),
          vatNumber: storeSettings?.company_vat_number,
          tinNumber: storeSettings?.company_tin_number,
          currencyCode: activeCurrency?.code ?? 'USD',
          currencyRate: activeCurrency?.exchange_rate ?? 1,
          posNumber: String(user?.branch?.id ?? 1),
          branchName: user?.branch?.name,
          deviceId: storeSettings?.fiscal_device_id || undefined,
          fiscalDay: storeSettings?.fiscal_day || undefined,
          recGn: storeSettings?.fiscal_rec_gn || undefined,
          rec68: storeSettings?.fiscal_rec_68 || undefined,
        }),
        resolveReceiptPrintMode(hw.printerMode),
        hw.printerName
      ).catch((err: any) => toast.error(err?.message ?? 'Receipt printing failed'));

      broadcastCart({ type: 'thankyou', storeName, currency });
      setTimeout(() => broadcastCart({ type: 'idle', storeName, currency }), 4000);

      cart.clearCart();
      setCashTendered('');
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-low-count'] });
      qc.invalidateQueries({ queryKey: ['inventory-out-count'] });
      setTimeout(() => codeRef.current?.focus(), 80);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message ?? 'Sale failed. Please try again.');
    },
  });

  // ── Hold mutation ────────────────────────────────────────────────────────────
  const holdMutation = useMutation({
    mutationFn: (payload: object) => offlineMutate(() => salesApi.hold(payload), 'sales', 'hold', payload as Record<string, unknown>),
    onSuccess: (_result) => {
      toast.success(cart.tableNumber !== 'Walk-in' ? `Order held for ${cart.tableNumber}` : 'Order held!');
      cart.clearCart();
      cart.setTableNumber('Walk-in');
      qc.invalidateQueries({ queryKey: ['open-tables'] });
      setTimeout(() => codeRef.current?.focus(), 80);
    },
  });

  // ── Open Tables (held orders) ────────────────────────────────────────────────
  const { data: heldOrdersData } = useQuery({
    queryKey: ['open-tables', branchId],
    queryFn: () => salesApi.listHeld({ branch_id: branchId }).then(r => r.data?.data ?? []),
    refetchInterval: 15000,
  });
  const heldOrders: any[] = Array.isArray(heldOrdersData) ? heldOrdersData : [];

  const deleteHeldMutation = useMutation({
    mutationFn: (id: number) => salesApi.deleteHeld(id),
    onSuccess: () => { toast.success('Table cleared'); qc.invalidateQueries({ queryKey: ['open-tables'] }); },
  });

  const resumeHeldOrder = (held: any) => {
    if (cart.items.length > 0 && !confirm('This will replace the current order. Continue?')) return;
    cart.clearCart();
    const data = held.cart_data ?? {};
    (data.items ?? []).forEach((it: any) => {
      cart.addItem({ product_id: it.product_id, name: it.name, sku: it.sku, price: it.price, cost: it.cost ?? 0, tax_rate: it.tax_rate ?? 0, sold_by_weight: !!it.sold_by_weight }, it.quantity);
    });
    cart.setTableNumber(held.table_number || 'Walk-in');
    deleteHeldMutation.mutate(held.id);
    setShowOpenTables(false);
  };

  // ── Void sale ─────────────────────────────────────────────────────────────────
  const { data: voidResultsData, isFetching: voidSearching } = useQuery({
    queryKey: ['void-search', voidSearch, branchId],
    queryFn: () => salesApi.list({ search: voidSearch, branch_id: branchId, per_page: 8 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
    enabled: showVoidModal && voidSearch.trim().length > 0,
  });
  const voidResults: any[] = (Array.isArray(voidResultsData) ? voidResultsData : []).filter((s: any) => s.status === 'completed');

  const voidMutation = useMutation({
    mutationFn: (id: number) => salesApi.cancel(id),
    onSuccess: () => {
      toast.success('Sale voided');
      qc.invalidateQueries({ queryKey: ['void-search'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-low-count'] });
      qc.invalidateQueries({ queryKey: ['inventory-out-count'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.message ?? 'Could not void this sale'),
  });

  const buildSalePayload = () => ({
    branch_id:      branchId,
    warehouse_id:   1,
    customer_id:    null,
    table_number:   cart.tableNumber !== 'Walk-in' ? cart.tableNumber : null,
    items: cart.items.map(i => ({
      product_id:         i.product_id,
      product_variant_id: i.variant_id,
      quantity:           i.quantity,
      unit_price:         i.price,
      discount_type:      null,
      discount_value:     0,
    })),
    payments:       [{ method: payMethod, amount: cart.total() }],
    discount_value: 0,
  });

  const handleProcessSale = () => {
    if (cart.items.length === 0) return;
    if (payMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) < totalDue)) {
      toast.error('Enter cash amount — must cover the total');
      tenderedRef.current?.focus();
      return;
    }

    // Don't block the sale if the local server's health-check poll hasn't
    // answered recently — offlineMutate() queues it locally and syncs
    // automatically once the server responds, so the cashier should never
    // be stopped from completing a transaction.
    saleMutation.mutate(buildSalePayload());
  };

  const handleHoldOrder = () => {
    if (cart.items.length === 0) return;
    holdMutation.mutate({
      branch_id: branchId,
      table_number: cart.tableNumber !== 'Walk-in' ? cart.tableNumber : null,
      cart_data: { items: cart.items, subtotal: cart.subtotal(), tax: cart.taxTotal(), total: cart.total(), discount: 0 },
    });
  };

  // Keep latest handlers in ref to avoid stale closures in keydown listener
  useEffect(() => {
    kbRef.current = { handleProcessSale, handleHoldOrder, saleMutation, holdMutation, cart };
  });

  // ── Global keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { handleProcessSale, handleHoldOrder, saleMutation, holdMutation, cart } = kbRef.current;

      if (e.key === 'F9') { e.preventDefault(); if (!saleMutation.isPending) handleProcessSale(); }
      if (e.key === 'F8') { e.preventDefault(); if (!holdMutation.isPending) handleHoldOrder(); }
      if (e.key === 'F5') { e.preventDefault(); cart.clearCart(); setCashTendered(''); setTimeout(() => codeRef.current?.focus(), 40); }
      if (e.key === 'F1') { e.preventDefault(); setPayMethod('cash'); }
      if (e.key === 'F2') { e.preventDefault(); setPayMethod('card'); }
      if (e.key === 'F3') { e.preventDefault(); setPayMethod('mobile_money'); }
      if (e.key === 'Escape') { setCodeInput(''); codeRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Derived values ───────────────────────────────────────────────────────────
  // cart.total() is always in the base currency (USD). Cash is tendered and
  // compared in whatever currency the cashier has selected (the note buttons,
  // "Exact", and everything the cashier types are all in that currency) — so
  // every comparison against the amount due must use the converted figure,
  // not the raw USD total, or "Exact"/change/the process-sale gate all break
  // the moment a non-USD currency is active.
  const total      = cart.total();
  const exchangeRate = activeCurrency?.exchange_rate ?? 1;
  const totalDue   = total * exchangeRate;
  const tendered   = parseFloat(cashTendered) || 0;
  const change     = payMethod === 'cash' && tendered > totalDue ? tendered - totalDue : 0;
  const canProcess = cart.items.length > 0 && !saleMutation.isPending &&
    (payMethod !== 'cash' || tendered >= totalDue);
  const fmtActive  = (n: number) => `${activeCurrency?.symbol ?? '$'}${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

  const fmtTime = (d: Date) => d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDate = (d: Date) => d.toLocaleDateString('en-ZA');
  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  const confirmQtyEdit = () => {
    if (!editingQtyItem) return;
    if (editingQtyItem.sold_by_weight) {
      const n = parseFloat(qtyInput);
      if (!isNaN(n) && n > 0) cart.updateQty(editingQtyItem.line_id, Math.round(n * 1000) / 1000);
      else cart.removeItem(editingQtyItem.line_id);
    } else {
      const n = parseInt(qtyInput, 10);
      if (!isNaN(n) && n > 0) cart.updateQty(editingQtyItem.line_id, n);
      else if (n === 0) cart.removeItem(editingQtyItem.line_id);
    }
    setEditingQtyItem(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="-m-6 flex flex-col bg-gray-50 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>

      {/* ── Header card ────────────────────────────────────────────────────── */}
      <div className="mx-4 mt-2 mb-2 flex-shrink-0">
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-400" />
          <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <span className="font-bold text-base bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">{storeName}</span>
            <span className="text-gray-400 text-sm">Cashier: <span className="font-semibold text-gray-600">{user?.name}</span></span>
            {isRestaurant && (
              <>
                <div className="flex items-center gap-1.5">
                  <TableProperties size={14} className="text-gray-400 flex-shrink-0" />
                  <select
                    value={cart.tableNumber}
                    onChange={(e) => cart.setTableNumber(e.target.value)}
                    className="text-sm border border-gray-200 rounded-none min-h-10 px-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                  >
                    {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setShowOpenTables(true)}
                  className="relative flex items-center justify-center gap-1.5 min-h-10 px-3 rounded-none border border-amber-200 text-amber-600 hover:bg-amber-50 text-xs font-semibold transition-colors touch-manipulation"
                >
                  <LayoutGrid size={14} /> Open Tables
                  {heldOrders.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">{heldOrders.length}</span>
                  )}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowVoidModal(true)}
              className="flex items-center justify-center gap-1.5 min-h-10 px-3 rounded-none border border-red-200 text-red-500 hover:bg-red-50 text-xs font-semibold transition-colors touch-manipulation"
            >
              <Ban size={14} /> Void
            </button>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {scaleActive && (
              scale.connected ? (
                <span className="flex items-center gap-1.5 text-blue-600 font-semibold text-xs" title="Weighing scale connected">
                  <ScaleIcon size={13} />
                  {liveKg !== null ? `${liveKg.toFixed(3)} kg` : 'Scale ready'}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-gray-300 font-semibold text-xs" title="Weighing scale not connected — connect it under Settings → Hardware">
                  <ScaleIcon size={13} /> Scale off
                </span>
              )
            )}
            {!isOnline ? (
              <span className="flex items-center gap-1.5 text-amber-500 font-semibold text-xs">
                Server starting...
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-500 font-medium text-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span> Ready
              </span>
            )}
            <span className="text-gray-400">{fmtDate(currentTime)}</span>
            <span className="text-gray-900 font-bold tabular-nums">{fmtTime(currentTime)}</span>
          </div>
          </div>
        </div>
      </div>

      {/* ── Scan / PLU card ────────────────────────────────────────────────── */}
      <div className="mx-4 mb-2 flex-shrink-0">
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm px-4 py-2">
          <form onSubmit={handleCodeSubmit} className="flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">
              Scan / PLU
            </span>
            <div className="relative flex-1">
              <input
                ref={codeRef}
                value={codeInput}
                onChange={e => setCodeInput(e.target.value)}
                onFocus={() => setShowBrowseDropdown(true)}
                onBlur={() => setShowBrowseDropdown(false)}
                placeholder="Scan barcode, or type to search stock..."
                className="w-full border-2 border-blue-500 focus:border-blue-600 rounded-none min-h-11 px-4 text-sm bg-blue-50 focus:bg-white focus:outline-none transition-colors pr-10"
                autoComplete="off"
              />
              {/* Touch keyboard button */}
              <button
                type="button"
                onClick={() => setShowSearchModal(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded-none touch-manipulation"
                title="Open on-screen keyboard"
              >
                <Keyboard size={15} />
              </button>

              {/* Live results dropdown — shows matches as the cashier types,
                  so they don't have to press Enter (or narrow to an exact
                  single match) just to see what's there. onMouseDown here
                  prevents the input's blur from firing before the click. */}
              {showBrowseDropdown && browseQuery && browseMatches.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-none shadow-lg max-h-72 overflow-y-auto">
                  {browseMatches.slice(0, 8).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addProduct(p)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-blue-50 border-b border-gray-50 last:border-b-0 touch-manipulation"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                        <p className="text-xs text-gray-400">{p.sku || p.barcode || '—'}</p>
                      </div>
                      <span className="text-sm font-semibold text-gray-700 flex-shrink-0 tabular-nums">
                        {formatCurrency(parseFloat(p.selling_price))}{p.sold_by_weight ? '/kg' : ''}
                      </span>
                    </button>
                  ))}
                  {browseMatches.length > 8 && (
                    <p className="px-4 py-2 text-xs text-gray-400 text-center border-t border-gray-50">
                      +{browseMatches.length - 8} more — keep typing to narrow
                    </p>
                  )}
                </div>
              )}
              {showBrowseDropdown && browseQuery && browseMatches.length === 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-none shadow-lg">
                  <p className="px-4 py-3 text-sm text-gray-400 text-center">No products match "{codeInput.trim()}"</p>
                </div>
              )}
            </div>
            <button type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white min-h-11 px-5 rounded-none font-semibold text-sm transition-colors flex-shrink-0 shadow-sm shadow-blue-100">
              Enter ↵
            </button>
            {productsLoading && <Loader2 size={16} className="animate-spin text-gray-400 flex-shrink-0" />}
          </form>
        </div>
      </div>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden gap-4 px-4 pb-4 min-h-0">

        {/* Left: items card */}
        <div className="flex-1 min-w-0 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col overflow-hidden">
          {/* Column headers */}
          <div className="flex items-center bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex-shrink-0">
            <span className="w-36 text-center flex-shrink-0 text-xs font-semibold text-gray-400 uppercase tracking-wider">QTY</span>
            <span className="flex-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</span>
            <span className="w-28 text-right pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Total</span>
            <span className="w-8"></span>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto">
            {cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-blue-200 select-none gap-3">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-60">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
                <p className="text-xs font-semibold text-gray-300 uppercase tracking-widest">Scan a product to start</p>
              </div>
            ) : (
              cart.items.map((item, idx) => {
                const lineTotal = (item.price - item.discount) * item.quantity;
                return (
                  <div key={item.line_id}
                    className={`flex items-center pl-3 pr-4 py-3.5 border-b border-l-4 border-gray-50 text-base ${cartLineAccent(item.product_id)} ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                    <div className="w-36 flex items-center justify-center flex-shrink-0">
                      <button type="button"
                        onClick={() => { setEditingQtyItem(item); setQtyInput(String(item.quantity)); }}
                        title="Tap to set quantity"
                        className="w-14 h-10 text-center font-bold text-gray-900 tabular-nums bg-gray-50 border border-gray-200 rounded-none hover:bg-blue-50 hover:border-blue-300 transition-colors touch-manipulation">
                        {item.sold_by_weight ? `${item.quantity.toFixed(3)}kg` : item.quantity}
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 truncate block">{item.name}</span>
                    </div>
                    <span className="w-28 text-right pr-3 font-bold text-gray-900 tabular-nums font-mono">
                      {formatCurrency(lineTotal)}
                    </span>
                    <button type="button"
                      onClick={() => cart.removeItem(item.line_id)}
                      title="Remove item"
                      className="w-10 h-10 flex items-center justify-center rounded-none text-gray-300 hover:text-white hover:bg-red-500 transition-colors touch-manipulation">
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex-shrink-0 flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-400">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
            {cart.items.length > 0 && (
              <button type="button" onClick={() => cart.clearCart()}
                className="text-xs font-semibold text-red-400 hover:text-red-600 transition-colors">
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Right: payment column — 40% width, stretches to fill the full height with generous touch-sized buttons */}
        <div className="w-[40%] min-w-[380px] xl:min-w-[440px] 2xl:min-w-[560px] max-w-[640px] flex flex-col gap-3 flex-shrink-0 overflow-y-auto">

          {/* Total box */}
          <div className="bg-gradient-to-r from-blue-600 via-blue-600 to-purple-600 rounded-2xl shadow-lg shadow-blue-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
            <span className="text-white/70 font-semibold text-base tracking-wide">TOTAL</span>
            <span className="text-white font-bold text-4xl tabular-nums font-mono">{formatCurrency(total)}</span>
          </div>

          {/* Payment method card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex-shrink-0">
            <p className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Payment Method</p>
            <div className="grid grid-cols-3 gap-2.5">
              {PAY_METHODS.map(({ value, label, key, icon: Icon, activeClass }) => (
                <button key={value} type="button"
                  onClick={() => setPayMethod(value)}
                  className={`flex flex-col items-center gap-1 py-4 rounded-none border-2 font-bold text-base transition-all touch-manipulation
                    ${payMethod === value
                      ? activeClass
                      : 'border-gray-200 text-gray-500 bg-white hover:border-blue-200 hover:bg-blue-50'
                    }`}
                >
                  <Icon size={22} />
                  {label}
                  <span className="text-[10px] font-semibold opacity-50">{key}</span>
                </button>
              ))}
            </div>

            {payMethod === 'cash' && (
              <div className="mt-3">
                <CashNotesPad
                  ref={tenderedRef}
                  value={cashTendered}
                  onChange={setCashTendered}
                  onConfirm={handleProcessSale}
                  label="Cash Tendered"
                  currencyCode={activeCurrency?.code ?? 'USD'}
                  totalDue={totalDue}
                  size="large"
                  change={change}
                  formatAmount={fmtActive}
                  confirmLabel={change > 0 ? `✓  Change: ${fmtActive(change)}` : '✓ Process Sale'}
                  confirmCls={canProcess ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' : 'bg-gray-200 text-gray-400 border-gray-200'}
                  disabled={cart.items.length === 0}
                />
              </div>
            )}
          </div>

          {/* Action buttons card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2.5 flex-shrink-0">
            {/* For cash, CashNotesPad above already has its own confirm/process
                button — showing a second "Process Order" button here just
                duplicates it and pushes the column past the viewport, forcing
                a scroll. Only show it for card/mobile, which have no pad. */}
            {payMethod !== 'cash' && (
              <button type="button"
                onClick={handleProcessSale}
                disabled={!canProcess}
                className="w-full py-6 rounded-none font-bold text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200 touch-manipulation"
              >
                {saleMutation.isPending
                  ? <span className="flex items-center justify-center gap-2">
                      <Loader2 size={20} className="animate-spin" /> Processing...
                    </span>
                  : <span>F9 — Process Order {formatCurrency(total)}</span>
                }
              </button>
            )}

            <div className="grid grid-cols-3 gap-3">
              <button type="button"
                onClick={() => { cart.clearCart(); setCashTendered(''); setTimeout(() => codeRef.current?.focus(), 40); }}
                disabled={cart.items.length === 0}
                className="py-4 rounded-none border-2 border-red-200 text-red-500 hover:bg-red-50 font-semibold text-sm uppercase disabled:opacity-30 transition-colors touch-manipulation">
                F5 Clear
              </button>
              <button type="button"
                onClick={handleHoldOrder}
                disabled={cart.items.length === 0 || holdMutation.isPending}
                className="py-4 rounded-none border-2 border-orange-200 text-orange-500 hover:bg-orange-50 font-semibold text-sm uppercase disabled:opacity-30 transition-colors touch-manipulation">
                {holdMutation.isPending ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'F8 Hold'}
              </button>
              <button type="button"
                onClick={() => window.location.reload()}
                className="py-4 rounded-none border-2 border-gray-200 text-gray-400 hover:bg-gray-50 font-semibold text-sm uppercase transition-colors touch-manipulation flex items-center justify-center gap-1">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {/* Restaurant: live orders panel — grows to fill any remaining height */}
          {isRestaurant ? (
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 flex-1 flex flex-col min-h-[140px]">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  {kdsOrders.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse inline-block" />}
                  Live Orders
                </p>
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Link to="/kitchen"
                    className="text-orange-500 hover:text-orange-600 transition-colors">Kitchen</Link>
                  <span className="text-gray-200">·</span>
                  <Link to="/queue"
                    className="text-blue-500 hover:text-blue-600 transition-colors">Queue</Link>
                </div>
              </div>
              {kdsOrders.length === 0 ? (
                <p className="text-xs text-gray-300 text-center py-3">No active kitchen orders</p>
              ) : (
                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {kdsOrders.map((o: any) => {
                    const style: Record<string, string> = {
                      new:       'bg-blue-50   border-blue-200   text-blue-700',
                      preparing: 'bg-amber-50  border-amber-200  text-amber-700',
                      ready:     'bg-green-50  border-green-200  text-green-700',
                    };
                    const dot: Record<string, string> = {
                      new: 'bg-blue-400', preparing: 'bg-amber-400', ready: 'bg-green-400',
                    };
                    return (
                      <div key={o.id}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${style[o.kds_status] ?? 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot[o.kds_status] ?? 'bg-gray-400'}`} />
                        <span className="font-black text-sm tabular-nums w-10 flex-shrink-0">{o.ticket}</span>
                        <span className="flex-1 text-xs truncate">
                          {o.items?.map((i: any) => `${i.qty}×${i.name}`).join(', ')}
                        </span>
                        <span className="text-xs font-bold capitalize flex-shrink-0">{o.kds_status}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // No Live Orders panel for a supermarket till — an empty flex-1 filler
            // keeps the column stretched to the full height instead of leaving a
            // dead gap under the action buttons.
            <div className="flex-1" />
          )}

        </div>
      </div>
    </div>

    {/* Touch keyboard search modal */}
    {showSearchModal && (
      <OnScreenKeyboard
        value={codeInput}
        onChange={(v) => setCodeInput(v)}
        onClose={() => {
          setShowSearchModal(false);
          // Auto-add if the on-screen keyboard's search narrowed to exactly one
          // product; otherwise the live stock list below the input already
          // shows whatever matched, so there's nothing else to do here.
          if (codeInput.trim()) {
            if (browseMatches.length === 1) { addProduct(browseMatches[0]); }
            else if (browseMatches.length === 0) { toast.error(`"${codeInput.trim()}" not found`); }
          }
          setTimeout(() => codeRef.current?.focus(), 80);
        }}
        placeholder="Scan barcode or type product name..."
        label="Product Search"
      />
    )}

    {/* Open Tables — currently held/parked orders (restaurant mode only) */}
    {isRestaurant && showOpenTables && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
        <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
            <h2 className="text-lg font-bold flex items-center gap-2"><LayoutGrid size={18} className="text-amber-600" /> Open Tables</h2>
            <button type="button" onClick={() => setShowOpenTables(false)}><X size={20} className="text-gray-400" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-2">
            {heldOrders.length === 0 ? (
              <p className="text-center text-gray-400 py-10 text-sm">No open tables — held orders will show up here</p>
            ) : (
              heldOrders.map((held: any) => {
                const itemsCount = (held.cart_data?.items ?? []).length;
                const total = held.cart_data?.total ?? 0;
                return (
                  <div key={held.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3">
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{held.table_number || 'Walk-in'}</p>
                      <p className="text-xs text-gray-400">{itemsCount} item{itemsCount !== 1 ? 's' : ''} · {formatCurrency(total)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => resumeHeldOrder(held)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-none touch-manipulation"
                      >
                        <PlayCircle size={13} /> Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm('Clear this table? The held order will be removed.')) deleteHeldMutation.mutate(held.id); }}
                        className="p-1.5 text-gray-300 hover:text-red-500 rounded-none"
                        title="Clear table"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    )}

    {/* Void sale */}
    {showVoidModal && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
        <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
            <h2 className="text-lg font-bold flex items-center gap-2"><Ban size={18} className="text-red-500" /> Void a Sale</h2>
            <button type="button" onClick={() => { setShowVoidModal(false); setVoidSearch(''); }}><X size={20} className="text-gray-400" /></button>
          </div>
          <div className="p-5 space-y-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={voidSearch}
                onChange={(e) => setVoidSearch(e.target.value)}
                placeholder="Search by receipt reference..."
                className="w-full pl-9 pr-3 py-2.5 border-2 border-gray-200 focus:border-red-400 rounded-none text-sm focus:outline-none"
              />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {voidSearching && <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-gray-400" /></div>}
              {!voidSearching && voidSearch.trim() && voidResults.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">No completed sale matches "{voidSearch}"</p>
              )}
              {voidResults.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-2.5">
                  <div>
                    <p className="font-mono text-sm font-semibold text-gray-900">{s.reference}</p>
                    <p className="text-xs text-gray-400">{formatCurrency(parseFloat(s.total))} · {s.items_count ?? s.items?.length ?? 0} items</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { if (confirm(`Void sale ${s.reference}? Stock will be restored.`)) voidMutation.mutate(s.id); }}
                    disabled={voidMutation.isPending}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-none disabled:opacity-50 touch-manipulation"
                  >
                    Void
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )}

    {editingQtyItem && (
      <NumericKeypad
        modal
        value={qtyInput}
        onChange={setQtyInput}
        onConfirm={confirmQtyEdit}
        onClose={() => setEditingQtyItem(null)}
        label={editingQtyItem.sold_by_weight ? `Weight (kg) — ${editingQtyItem.name}` : `Quantity — ${editingQtyItem.name}`}
        allowDecimal={!!editingQtyItem.sold_by_weight}
        quickAmounts={editingQtyItem.sold_by_weight && liveKg && liveKg > 0 ? [Math.round(liveKg * 1000) / 1000] : undefined}
        confirmLabel="✓ Set Qty"
        confirmCls="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
      />
    )}

    {pendingWeightProduct && (
      <NumericKeypad
        modal
        value={weightInput}
        onChange={setWeightInput}
        onConfirm={confirmPendingWeight}
        onClose={() => setPendingWeightProduct(null)}
        label={`Weight (kg) — ${pendingWeightProduct.name}${scaleActive ? (scale.connected ? ' — place on scale or type weight' : ' — scale not connected') : ''}`}
        allowDecimal
        quickAmounts={liveKg && liveKg > 0 ? [Math.round(liveKg * 1000) / 1000] : undefined}
        confirmLabel="✓ Add to Cart"
        confirmCls="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
      />
    )}
    </>
  );
}
