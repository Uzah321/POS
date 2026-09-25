import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, salesApi, settingsApi, weighingScalesApi } from '../api';
import { useTopbarSlot } from '../layouts/TopbarSlot';
import { useCartStore, type CartItem } from '../stores/cartStore';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { buildReceiptDataFromSale, printReceipt, resolveReceiptPrintMode } from '../lib/hardware/printer';
import { broadcastCart } from '../lib/hardware/customerDisplay';
import { useScaleReading, getScaleReading, toKg, ensureScalesAutoConnected, useConnectedScaleCount, type ScaleDevice } from '../lib/hardware/scale';
import { db } from '../lib/db';
import { offlineMutate } from '../lib/offlineMutation';
import { effectiveTaxRate } from '../lib/taxSettings';
import { useServerHealth } from '../hooks/useServerHealth';
import CashNotesPad from '../components/ui/CashNotesPad';
import OnScreenKeyboard from '../components/ui/OnScreenKeyboard';
import NumericKeypad from '../components/ui/NumericKeypad';
import { cartLineAccent } from '../lib/tileColors';
import { iconForCategory } from '../lib/categoryIcons';
import { decodeEmbeddedBarcode } from '../lib/barcode/embeddedBarcode';
import { Loader2, Trash2, RefreshCw, Keyboard, TableProperties, LayoutGrid, Ban, X, PlayCircle, Search, Scale as ScaleIcon, Banknote, CreditCard, Smartphone, ShoppingBag, ShoppingCart as CartIcon, Star, Barcode } from 'lucide-react';
import toast from 'react-hot-toast';

const PAY_METHODS = [
  { value: 'cash',         label: 'CASH',   key: 'F1', icon: Banknote,    activeClass: 'bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-200' },
  { value: 'card',         label: 'CARD',   key: 'F2', icon: CreditCard,  activeClass: 'bg-blue-600    border-blue-600    text-white shadow-md shadow-blue-200' },
  { value: 'mobile_money', label: 'MOBILE', key: 'F3', icon: Smartphone,  activeClass: 'bg-purple-600  border-purple-600  text-white shadow-md shadow-purple-200' },
] as const;

type PayMethod = typeof PAY_METHODS[number]['value'];

const TABLES = ['Walk-in', ...Array.from({ length: 20 }, (_, i) => `T-${i + 1}`)];

export default function CashierPage() {
  const topbarSlot = useTopbarSlot();
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
  // Category tab selected in the browse bar — UI-only filter, defaults to
  // the "Popular" tab (all products; there's no per-product popularity data
  // to rank by yet, so it's just the default landing view).
  const [activeCategory, setActiveCategory] = useState('Popular');
  // Which row of that dropdown the keyboard (arrow keys) has highlighted —
  // reset to the top whenever the search text changes so it doesn't keep
  // pointing at a row that no longer matches.
  const [browseHighlight, setBrowseHighlight] = useState(0);

  const codeRef      = useRef<HTMLInputElement>(null);
  const tenderedRef  = useRef<HTMLInputElement>(null);
  const kbRef        = useRef<any>({});
  const browseItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const qc           = useQueryClient();
  const cart         = useCartStore();
  const { user }     = useAuthStore();
  const { format: formatCurrency, activeCurrency } = useCurrencyStore();
  const hw           = useHardwareStore();
  const currency     = activeCurrency?.symbol ?? '$';
  const branchId     = user?.branch?.id ?? 1;
  // Registered weighing scales — a store can run several (one per
  // department), each owning its own list of products (product.scale_id).
  // Connections are managed centrally in lib/hardware/scale.ts; this just
  // makes sure every active scale gets (re)dialled once the list loads.
  const { data: scales = [] } = useQuery<ScaleDevice[]>({
    queryKey: ['weighing-scales'],
    queryFn: () => weighingScalesApi.list().then(r => r.data?.data || []),
  });
  useEffect(() => { if (scales.length) ensureScalesAutoConnected(scales); }, [scales]);
  const connectedScaleCount = useConnectedScaleCount(scales.map((s) => s.id));

  // Live reading for whichever scale the product waiting on the weight
  // keypad is assigned to — a reading counts as "live" only while that
  // specific scale is actually connected.
  const pendingScaleReading = useScaleReading(pendingWeightProduct?.scale_id ?? null);
  const liveKg = pendingWeightProduct?.scale_id != null && pendingScaleReading.connected && pendingScaleReading.weight
    ? toKg(pendingScaleReading.weight) : null;

  // Same idea, but for re-weighing a line already in the cart (tapping an
  // existing weighed item to correct its quantity) — its own scale, not
  // whichever one a fresh weigh-in happens to have pending.
  const editingScaleReading = useScaleReading(editingQtyItem?.scale_id ?? null);
  const editingLiveKg = editingQtyItem?.scale_id != null && editingScaleReading.connected && editingScaleReading.weight
    ? toKg(editingScaleReading.weight) : null;

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
  const isRestaurant = (user?.business_type ?? storeSettings?.business_type) === 'restaurant';

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
  // Capped so a one-letter query doesn't render the whole catalog, but high
  // enough that arrow-down keyboard navigation can actually reach most real
  // search results instead of stalling after a handful of rows. Arrow-key
  // navigation below is scoped to this same slice.
  const visibleBrowseMatches = browseMatches.slice(0, 25);

  // Keep the highlighted row in range (and reset to the top) whenever the
  // list of matches changes underneath it.
  useEffect(() => {
    setBrowseHighlight(0);
  }, [browseQuery]);

  // Scroll the highlighted row into view as arrow keys move past the edge
  // of the dropdown's visible area.
  useEffect(() => {
    browseItemRefs.current[browseHighlight]?.scrollIntoView({ block: 'nearest' });
  }, [browseHighlight]);

  // Store-defined categories, same source POSPage uses so both tills stay
  // visually and behaviorally consistent.
  const categoryTabs = ['Popular', ...Array.from(new Set(allProducts.map((p: any) => p.category?.name).filter(Boolean))) as string[]];
  const categoryImages = new Map<string, string>();
  allProducts.forEach((p: any) => {
    if (p.category?.image && !categoryImages.has(p.category.name)) categoryImages.set(p.category.name, p.category.image);
  });

  // Barcode scanner — embedded weight/price barcode first, then exact SKU/barcode match
  const handleBarcodeScan = useCallback((code: string) => {
    if (tryAddEmbeddedBarcode(code)) return;
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
  }, [allProducts, storeSettings]);

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
  const addProductWithQty = (product: any, qty: number, soldByWeight: boolean, priceOverride?: number): boolean => {
    const price = priceOverride ?? parseFloat(product.selling_price);
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
      scale_id:   soldByWeight ? (product.scale_id ?? null) : undefined,
    }, qty);
    return true;
  };

  const addProduct = (product: any) => {
    const soldByWeight = !!product.sold_by_weight;
    if (soldByWeight) {
      // Read straight off this product's own assigned scale (not whichever
      // scale a previous weigh-in left "pending") — every product only ever
      // weighs on the one scale it's assigned to. Otherwise prompt for a
      // hand-entered weight — nothing is added to the cart until a real
      // weight is confirmed, so a dismissed prompt never leaves a phantom
      // "1 kg" line behind.
      const reading = product.scale_id != null ? getScaleReading(product.scale_id) : null;
      const productLiveKg = reading?.connected && reading.weight ? toKg(reading.weight) : null;
      const kg = productLiveKg && productLiveKg > 0 ? Math.round(productLiveKg * 1000) / 1000 : null;
      if (kg === null) {
        if (product.scale_id != null && !reading?.connected) toast.error(`${product.name} is sold by weight — its scale isn't connected, enter the weight manually`);
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

  // Scale-printed barcode whose digits encode a PLU code plus a weight or
  // price (Settings → Barcodes), rather than being a literal product
  // barcode. Tried before the normal exact-match lookup; returns false (and
  // does nothing) for any code that doesn't match the configured format, so
  // a store that hasn't set this up sees no change in behavior.
  const tryAddEmbeddedBarcode = (code: string): boolean => {
    const decoded = decodeEmbeddedBarcode(code, storeSettings ?? {});
    if (!decoded) return false;
    const product = allProducts.find((p: any) => p.sold_by_weight && (p.plu_code ?? '') === decoded.pluCode);
    if (!product) {
      toast.error(`No product with PLU code ${decoded.pluCode}`);
      return true; // matched the barcode format — don't also fall through to a literal-barcode lookup
    }
    const added = decoded.kind === 'weight'
      ? addProductWithQty(product, decoded.value, true)
      : addProductWithQty(product, 1, false, decoded.value);
    if (added) {
      setCodeInput('');
      setTimeout(() => codeRef.current?.focus(), 40);
    }
    return true;
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

    if (tryAddEmbeddedBarcode(q)) return;

    const ql = q.toLowerCase();
    const exact = allProducts.find(p =>
      (p.sku ?? '').toLowerCase() === ql ||
      (p.barcode ?? '').toLowerCase() === ql
    );
    if (exact) { addProduct(exact); return; }

    // Arrow keys may have highlighted a row in the live dropdown — Enter
    // adds that one rather than requiring the search to narrow to exactly
    // one match.
    if (showBrowseDropdown && visibleBrowseMatches.length > 0) {
      addProduct(visibleBrowseMatches[Math.min(browseHighlight, visibleBrowseMatches.length - 1)]);
      return;
    }

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
      cart.addItem({ product_id: it.product_id, name: it.name, sku: it.sku, price: it.price, cost: it.cost ?? 0, tax_rate: it.tax_rate ?? 0, sold_by_weight: !!it.sold_by_weight, scale_id: it.scale_id ?? null }, it.quantity);
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
    mutationFn: ({ id, reason }: { id: number; reason?: string }) => salesApi.cancel(id, reason),
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
    <div className="pos-screen -m-3 sm:-m-5 lg:-m-6 flex flex-col overflow-hidden pt-3" style={{ height: 'calc(100vh - 64px)', background: '#eef2f8' }}>

      {/* Header controls — portaled into AppLayout's topbar (via TopbarSlotContext)
          so this page's row and the app's global topbar render as one single
          line instead of two stacked bars. Falls back to its own row here if
          the slot isn't mounted yet (e.g. very first render). */}
      {(() => {
        const content = (
          <>
            <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <svg viewBox="0 0 36 36" fill="none" width="34" height="34" className="flex-shrink-0">
                <path d="M18 2L32.5 10.25V26.75L18 35L3.5 26.75V10.25Z" fill="#2f6df6" />
                <circle cx="18" cy="18" r="8" stroke="white" strokeWidth="2" fill="none" opacity="0.5" />
                <circle cx="18" cy="18" r="4" fill="white" />
              </svg>
              <div className="min-w-0 hidden md:block pr-3 border-r border-white/10">
                <p className="font-bold text-white text-sm leading-tight truncate max-w-[18ch]">
                  {storeName}{user?.branch?.name ? ` · ${user.branch.name}` : ''}
                </p>
                <p className="text-[11px] text-blue-200/80 truncate max-w-[18ch]">Cashier: <span className="font-semibold text-white">{user?.name}</span></p>
              </div>
            </div>

            {isRestaurant && (
              <div className="flex items-center gap-1.5 rounded-xl pl-3 pr-1.5 h-11 flex-shrink-0 text-white" style={{ background: '#16305e' }}>
                <TableProperties size={15} className="text-blue-200 flex-shrink-0" />
                <select
                  value={cart.tableNumber}
                  onChange={(e) => cart.setTableNumber(e.target.value)}
                  className="text-xs font-semibold bg-transparent border-0 focus:outline-none pr-1 text-white [&>option]:text-slate-900"
                >
                  {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowOpenTables(true)}
              className="relative flex items-center gap-2 rounded-xl h-11 text-white hover:brightness-125 text-xs font-semibold px-3.5 transition touch-manipulation flex-shrink-0"
              style={{ background: '#16305e' }}
            >
              <LayoutGrid size={16} className="text-amber-300" /> <span className="hidden sm:inline">{isRestaurant ? 'Open Tables' : 'Held Orders'}</span>
              {heldOrders.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">{heldOrders.length}</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowVoidModal(true)}
              className="flex items-center gap-2 rounded-xl h-11 text-red-200 hover:text-white hover:bg-red-500/80 text-xs font-semibold px-3.5 transition-colors touch-manipulation flex-shrink-0"
              style={{ background: '#16305e' }}
            >
              <Ban size={16} /> <span className="hidden sm:inline">Void</span>
            </button>

            {scales.length > 0 && (
              connectedScaleCount > 0 ? (
                <span className="flex items-center gap-1.5 text-white font-semibold text-xs rounded-xl px-3 h-11 flex-shrink-0" style={{ background: '#16305e' }} title={`${connectedScaleCount} of ${scales.length} weighing scale${scales.length === 1 ? '' : 's'} connected`}>
                  <ScaleIcon size={13} />
                  {liveKg !== null ? `${liveKg.toFixed(3)} kg` : `${connectedScaleCount}/${scales.length} scale${scales.length === 1 ? '' : 's'}`}
                </span>
              ) : (
                <span className="hidden lg:flex items-center gap-1.5 text-blue-200/50 font-semibold text-xs flex-shrink-0" title="No weighing scales connected -- connect them under Settings -> Hardware">
                  <ScaleIcon size={13} /> Scales off
                </span>
              )
            )}

            <span className={`flex items-center gap-2 rounded-xl px-3 h-11 text-xs font-semibold flex-shrink-0 ${isOnline ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></span>
              <span className="hidden sm:inline">{isOnline ? 'Online & synced' : 'Server starting...'}</span>
            </span>

            <div className="text-right leading-tight pl-1 flex-shrink-0 hidden sm:block">
              <p className="text-[11px] text-blue-200/80">{fmtDate(currentTime)}</p>
              <p className="text-sm font-bold text-white tabular-nums">{fmtTime(currentTime)}</p>
            </div>
          </>
        );
        return topbarSlot
          ? createPortal(content, topbarSlot)
          : (
            <div className="flex-shrink-0 text-white px-3 sm:px-5 py-2.5 flex items-center gap-2 sm:gap-3 overflow-x-auto">
              {content}
            </div>
          );
      })()}

      {/* Search bar */}
      <div className="mx-2 sm:mx-4 mb-2 flex-shrink-0">
        <form onSubmit={handleCodeSubmit} className="relative">
          <div className="flex items-center gap-2 bg-white border-2 border-gray-200 focus-within:border-blue-500 rounded-2xl shadow-sm pl-4 pr-2 py-1.5 transition-colors">
            <Barcode size={22} className="text-blue-500 flex-shrink-0" />
            <div className="w-px h-6 bg-gray-100 flex-shrink-0" />
            <input
              ref={codeRef}
              value={codeInput}
              onChange={e => setCodeInput(e.target.value)}
              onFocus={() => setShowBrowseDropdown(true)}
              onBlur={() => setShowBrowseDropdown(false)}
              onKeyDown={(e) => {
                if (!showBrowseDropdown || visibleBrowseMatches.length === 0) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setBrowseHighlight((i) => Math.min(i + 1, visibleBrowseMatches.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setBrowseHighlight((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Escape') {
                  setShowBrowseDropdown(false);
                }
              }}
              placeholder="Scan barcode or search products..."
              className="flex-1 min-w-0 bg-transparent px-2 py-3 text-base font-medium focus:outline-none"
              autoComplete="off"
            />
            {productsLoading && <Loader2 size={16} className="animate-spin text-gray-300 flex-shrink-0" />}
            <button
              type="button"
              onClick={() => setShowSearchModal(true)}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full touch-manipulation"
              title="Open on-screen keyboard"
            >
              <Keyboard size={16} />
            </button>
            <button
              type="submit"
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center text-white rounded-xl hover:brightness-110 touch-manipulation transition-colors"
              style={{ background: '#2f6df6' }}
              title="Search / Enter"
            >
              <Search size={16} />
            </button>
          </div>

          {/* Live results dropdown -- shows matches as the cashier types, so they
              don't have to press Enter (or narrow to an exact single match) just
              to see what's there. onMouseDown here prevents the input's blur from
              firing before the click. */}
          {showBrowseDropdown && browseQuery && browseMatches.length > 0 && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1.5 bg-white border border-gray-100 rounded-2xl shadow-lg max-h-72 overflow-y-auto">
              {visibleBrowseMatches.map((p, i) => (
                <button
                  key={p.id}
                  ref={(el) => { browseItemRefs.current[i] = el; }}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setBrowseHighlight(i)}
                  onClick={() => addProduct(p)}
                  className={`w-full flex items-center justify-between gap-3 pr-4 py-2.5 text-left border-b border-l-4 last:border-b-0 touch-manipulation first:rounded-t-2xl last:rounded-b-2xl transition-colors ${i === browseHighlight ? 'bg-blue-50 border-l-blue-500 border-b-blue-100 pl-3' : 'border-l-transparent border-b-gray-50 hover:bg-gray-50 pl-4'}`}
                >
                  <div className="min-w-0">
                    <p className={`text-sm truncate ${i === browseHighlight ? 'font-semibold text-blue-700' : 'font-medium text-gray-900'}`}>{p.name}</p>
                    <p className="text-xs text-gray-400">{p.sku || p.barcode || '—'}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-700 flex-shrink-0 tabular-nums">
                    {formatCurrency(parseFloat(p.selling_price))}{p.sold_by_weight ? '/kg' : ''}
                  </span>
                </button>
              ))}
              {browseMatches.length > visibleBrowseMatches.length && (
                <p className="px-4 py-2 text-xs text-gray-400 text-center border-t border-gray-50">
                  +{browseMatches.length - visibleBrowseMatches.length} more -- keep typing to narrow
                </p>
              )}
            </div>
          )}
          {showBrowseDropdown && browseQuery && browseMatches.length === 0 && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1.5 bg-white border border-gray-100 rounded-2xl shadow-lg">
              <p className="px-4 py-3 text-sm text-gray-400 text-center">No products match "{codeInput.trim()}"</p>
            </div>
          )}
        </form>
      </div>

      {/* Category tabs */}
      <div className="mx-2 sm:mx-4 mb-2 flex-shrink-0 flex items-center gap-2 overflow-x-auto pb-0.5">
        {categoryTabs.map((cat) => {
          const TabIcon = cat === 'Popular' ? Star : iconForCategory(cat);
          const catImage = categoryImages.get(cat);
          const active = activeCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              style={active ? { background: '#2f6df6' } : undefined}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors touch-manipulation ${
                active ? 'text-white shadow-sm shadow-blue-200' : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {catImage
                ? <img src={catImage} alt="" draggable={false} className="w-8 h-8 rounded-md object-cover" />
                : <TabIcon size={15} />} {cat}
            </button>
          );
        })}
      </div>

      {/* Main area */}
      {/* Below lg the column scrolls as a whole: order list gets a fixed share
          of the screen and the payment panel follows at full height, so a phone
          never squeezes the order list to nothing. */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-y-auto lg:overflow-hidden gap-3 lg:gap-4 px-2 sm:px-4 pb-2 sm:pb-4 min-h-0">

        {/* Left: current order */}
        <div className="flex-shrink-0 h-[50vh] min-h-[260px] lg:h-auto lg:min-h-0 lg:flex-1 lg:flex-shrink min-w-0 flex flex-col gap-3 overflow-hidden">

          {/* Current order */}
          <div className="flex-1 min-h-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0 flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <CartIcon size={17} className="text-gray-700 flex-shrink-0" />
                <span className="font-bold text-gray-900">Current order</span>
                <span className="text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => cart.clearCart()}
                  disabled={cart.items.length === 0}
                  className="flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors touch-manipulation"
                >
                  <Trash2 size={13} /> Clear all
                </button>
                <button
                  type="button"
                  onClick={handleHoldOrder}
                  disabled={cart.items.length === 0 || holdMutation.isPending}
                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors touch-manipulation"
                >
                  {holdMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />} Save order
                </button>
              </div>
            </div>

            {/* Column headers */}
            <div className="flex items-center px-4 py-2.5 flex-shrink-0 text-[11px] font-bold text-blue-100 uppercase tracking-wider" style={{ background: '#173463' }}>
              <span className="w-7 flex-shrink-0">#</span>
              <span className="flex-1">Product</span>
              <span className="w-20 text-right flex-shrink-0">Price</span>
              <span className="w-16 text-center flex-shrink-0">Qty</span>
              <span className="w-24 text-right flex-shrink-0">Total</span>
              <span className="w-8 flex-shrink-0"></span>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto">
              {cart.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-blue-200 select-none gap-3">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-60">
                    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
                    <path d="M16 10a4 4 0 0 1-8 0"/>
                  </svg>
                  <p className="text-xs font-semibold text-gray-300 uppercase tracking-widest">Scan or tap a product to start</p>
                </div>
              ) : (
                cart.items.map((item, idx) => {
                  const lineTotal = (item.price - item.discount) * item.quantity;
                  return (
                    <div key={item.line_id}
                      className={`flex items-center px-4 py-3.5 border-b border-l-4 border-slate-100 ${cartLineAccent(item.product_id)} ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}`}>
                      <span className="w-7 flex-shrink-0 text-xs text-gray-400">{idx + 1}</span>
                      <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate pr-2">{item.name}</span>
                      <span className="w-20 text-right flex-shrink-0 text-sm text-gray-500 tabular-nums">{formatCurrency(item.price)}</span>
                      <span className="w-16 flex justify-center flex-shrink-0">
                        <button type="button"
                          onClick={() => { setEditingQtyItem(item); setQtyInput(String(item.quantity)); }}
                          title="Tap to set quantity"
                          className="min-w-[44px] h-8 px-2 text-center text-sm font-bold text-blue-700 tabular-nums bg-blue-50 border border-blue-100 rounded-xl hover:bg-blue-100 hover:border-blue-300 transition-colors touch-manipulation">
                          {item.sold_by_weight ? `${item.quantity.toFixed(3)}kg` : item.quantity}
                        </button>
                      </span>
                      <span className="w-24 text-right flex-shrink-0 font-bold text-gray-900 tabular-nums text-sm">
                        {formatCurrency(lineTotal)}
                      </span>
                      <span className="w-8 flex justify-center flex-shrink-0">
                        <button type="button"
                          onClick={() => cart.removeItem(item.line_id)}
                          title="Remove item"
                          className="w-7 h-7 flex items-center justify-center rounded-full text-gray-300 hover:text-white hover:bg-red-500 transition-colors touch-manipulation">
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right: payment column -- 38% width on desktop (lg+), stretches to fill the
            full height with generous touch-sized buttons. Below lg it stacks under
            the item list full-width, and the page scrolls down to it. */}
        <div className="w-full lg:w-[38%] lg:min-w-[360px] xl:min-w-[420px] 2xl:min-w-[520px] max-w-full lg:max-w-[600px] flex flex-col gap-3 flex-shrink-0 lg:overflow-y-auto">

          {/* Amount due */}
          <div className="rounded-2xl shadow-lg shadow-blue-200 px-6 py-5 flex items-center justify-between flex-shrink-0" style={{ background: 'linear-gradient(135deg, #0b1f44 0%, #173463 55%, #2f6df6 130%)' }}>
            <div>
              <span className="text-white/70 font-semibold text-sm tracking-wide uppercase">Amount due</span>
              <p className="text-white font-bold text-4xl tabular-nums font-mono mt-1">{formatCurrency(total)}</p>
            </div>
            <ShoppingBag size={40} className="text-white/25 flex-shrink-0" />
          </div>

          {/* Payment method card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex-shrink-0">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Payment Method</p>
            <div className="grid grid-cols-3 gap-2">
              {PAY_METHODS.map(({ value, label, key, icon: Icon, activeClass }) => (
                <button key={value} type="button"
                  onClick={() => setPayMethod(value)}
                  className={`flex flex-col items-center gap-0.5 py-2 rounded-xl border-2 font-bold text-sm transition-all touch-manipulation
                    ${payMethod === value
                      ? activeClass
                      : 'border-gray-200 text-gray-500 bg-white hover:border-blue-200 hover:bg-blue-50'
                    }`}
                >
                  <Icon size={16} />
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
                  confirmCls={canProcess ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600' : 'bg-gray-200 text-gray-400 border-gray-200'}
                  disabled={cart.items.length === 0}
                />
              </div>
            )}
          </div>

          {/* Action buttons card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2.5 flex-shrink-0">
            {/* For cash, CashNotesPad above already has its own confirm/process
                button -- showing a second "Process Order" button here just
                duplicates it and pushes the column past the viewport, forcing
                a scroll. Only show it for card/mobile, which have no pad. */}
            {payMethod !== 'cash' && (
              <button type="button"
                onClick={handleProcessSale}
                disabled={!canProcess}
                className="w-full py-6 rounded-xl font-bold text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200 touch-manipulation"
              >
                {saleMutation.isPending
                  ? <span className="flex items-center justify-center gap-2">
                      <Loader2 size={20} className="animate-spin" /> Processing...
                    </span>
                  : <span>F9 -- Complete Sale {formatCurrency(total)}</span>
                }
              </button>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button type="button"
                onClick={() => { cart.clearCart(); setCashTendered(''); setTimeout(() => codeRef.current?.focus(), 40); }}
                disabled={cart.items.length === 0}
                className="py-4 rounded-xl border-2 border-red-200 text-red-500 hover:bg-red-50 font-semibold text-sm uppercase disabled:opacity-30 transition-colors touch-manipulation">
                F5 Clear
              </button>
              <button type="button"
                onClick={() => window.location.reload()}
                className="py-4 rounded-xl border-2 border-gray-200 text-gray-400 hover:bg-gray-50 font-semibold text-sm uppercase transition-colors touch-manipulation flex items-center justify-center gap-1">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {/* Cashier register has no Live Orders panel -- Kitchen/Queue live
              on their own dedicated pages. Empty flex-1 filler keeps the
              column stretched to full height instead of a dead gap under
              the action buttons. */}
          <div className="flex-1" />

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

    {/* Open Tables / Held Orders — currently held/parked orders */}
    {showOpenTables && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
        <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
            <h2 className="text-lg font-bold flex items-center gap-2"><LayoutGrid size={18} className="text-amber-600" /> {isRestaurant ? 'Open Tables' : 'Held Orders'}</h2>
            <button type="button" onClick={() => setShowOpenTables(false)}><X size={20} className="text-gray-400" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-2">
            {heldOrders.length === 0 ? (
              <p className="text-center text-gray-400 py-10 text-sm">{isRestaurant ? 'No open tables — held orders will show up here' : 'No held orders yet'}</p>
            ) : (
              heldOrders.map((held: any) => {
                const itemsCount = (held.cart_data?.items ?? []).length;
                const total = held.cart_data?.total ?? 0;
                return (
                  <div key={held.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3">
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{isRestaurant ? (held.table_number || 'Walk-in') : (held.customer_id ? (held.customer?.name ?? 'Customer') : (held.table_number || 'Walk-in'))}</p>
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
                    onClick={() => {
                      // Cancel aborts; OK voids — with the reason, if one was typed, for the voids report.
                      const reason = prompt(`Void sale ${s.reference}? Stock will be restored.

Reason (optional):`);
                      if (reason !== null) voidMutation.mutate({ id: s.id, reason: reason.trim() || undefined });
                    }}
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
        quickAmounts={editingQtyItem.sold_by_weight && editingLiveKg && editingLiveKg > 0 ? [Math.round(editingLiveKg * 1000) / 1000] : undefined}
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
        label={`Weight (kg) — ${pendingWeightProduct.name}${pendingWeightProduct.scale_id != null ? (pendingScaleReading.connected ? ' — place on scale or type weight' : ' — scale not connected') : ''}`}
        allowDecimal
        quickAmounts={liveKg && liveKg > 0 ? [Math.round(liveKg * 1000) / 1000] : undefined}
        confirmLabel="✓ Add to Cart"
        confirmCls="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
      />
    )}
    </>
  );
}
