import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, salesApi, settingsApi, customersApi } from '../api';
import type { CartItem, HeldOrder } from '../stores/cartStore';
import { useCartStore } from '../stores/cartStore';
import { usePosUIStore } from '../stores/posUIStore';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useSelectedRegister } from '../hooks/useSelectedRegister';
import { buildReceiptDataFromSale, printReceipt, resolveReceiptPrintMode } from '../lib/hardware/printer';
import { broadcastCart } from '../lib/hardware/customerDisplay';
import { useWeighingScale, toKg } from '../lib/hardware/scale';
import { db } from '../lib/db';
import { offlineMutate } from '../lib/offlineMutation';
import { effectiveTaxRate } from '../lib/taxSettings';
import NumericKeypad from '../components/ui/NumericKeypad';
import CashNotesPad from '../components/ui/CashNotesPad';
import OnScreenKeyboard from '../components/ui/OnScreenKeyboard';
import ProductCard from '../components/pos/ProductCard';
import CategoryChip from '../components/pos/CategoryChip';
import { contrastText, TILE_THEMES, cartLineAccent } from '../lib/tileColors';
import {
  Search, Plus, Trash2, Loader2, CreditCard, Banknote, Smartphone,
  X, ShoppingCart, PauseCircle, PlayCircle, Clock, Keyboard, RefreshCw,
  User, Award,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote, activeClass: 'bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-200' },
  { value: 'card', label: 'Card', icon: CreditCard, activeClass: 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200' },
  { value: 'mobile_money', label: 'Mobile', icon: Smartphone, activeClass: 'bg-purple-600 border-purple-600 text-white shadow-md shadow-purple-200' },
];

function CartRow({ item, format }: { item: CartItem; format: (v: number) => string }) {
  const { updateQty, removeItem } = useCartStore();
  const [editingQty, setEditingQty] = useState(false);
  const [qtyInput, setQtyInput] = useState('');
  const lineTotal = (item.price - item.discount) * item.quantity;

  const openQtyEdit = () => { setQtyInput(String(item.quantity)); setEditingQty(true); };
  const confirmQty = () => {
    if (item.sold_by_weight) {
      const n = parseFloat(qtyInput);
      if (!isNaN(n) && n > 0) updateQty(item.line_id, Math.round(n * 1000) / 1000);
      else removeItem(item.line_id);
    } else {
      const n = parseInt(qtyInput, 10);
      if (!isNaN(n) && n > 0) updateQty(item.line_id, n);
      else if (n === 0) removeItem(item.line_id);
    }
    setEditingQty(false);
  };

  return (
    <div className={`flex items-center gap-2 py-2 pl-3 border-l-4 border-b border-gray-50 last:border-b-0 ${cartLineAccent(item.product_id)}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
      </div>
      <div className="flex items-center flex-shrink-0">
        <button
          type="button"
          onClick={openQtyEdit}
          className="w-9 h-8 text-center text-sm font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-md hover:bg-blue-50 hover:border-blue-300 transition-colors touch-manipulation"
          title="Tap to set quantity"
        >
          {item.sold_by_weight ? `${item.quantity.toFixed(3)}kg` : item.quantity}
        </button>
      </div>
      <div className="w-14 text-right flex-shrink-0">
        <p className="text-xs text-gray-400 tabular-nums">{format(item.price)}</p>
      </div>
      <div className="w-16 text-right flex-shrink-0">
        <p className="text-sm font-bold text-gray-900 tabular-nums">{format(lineTotal)}</p>
      </div>
      <button type="button" onClick={() => removeItem(item.line_id)} className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-300 hover:text-white hover:bg-red-500 transition-colors touch-manipulation" title="Remove item">
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
          label={item.sold_by_weight ? `Weight (kg) — ${item.name}` : `Quantity — ${item.name}`}
          allowDecimal={!!item.sold_by_weight}
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
  // Arrow-key highlight over the search results grid — -1 means nothing
  // highlighted yet (plain Enter still falls back to the exact-code lookup
  // below). Tile refs let the highlighted tile scroll into view as the
  // cashier arrows past what's currently on screen.
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
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
  const { registerId, registers: fiscalRegisters, needsSelection: needsRegisterSelection, selectRegister } = useSelectedRegister(branchId);
  const hw = useHardwareStore();
  const { activeCurrency } = useCurrencyStore();
  const currency = activeCurrency?.symbol ?? '$';
  const scale = useWeighingScale({ mode: hw.scaleMode, baudRate: hw.scaleBaudRate, host: hw.scaleHost, port: hw.scalePort });
  const scaleActive = hw.scaleMode === 'webserial' || hw.scaleMode === 'network';
  const liveKg = scaleActive && scale.connected && scale.weight ? toKg(scale.weight) : null;
  // A weight-priced product tapped with no live scale reading — prompts for
  // a hand-entered weight before anything is added to the cart, so a
  // dismissed prompt never leaves a phantom "1 kg" line behind.
  const [pendingWeightProduct, setPendingWeightProduct] = useState<any | null>(null);
  const [weightInput, setWeightInput] = useState('');

  // Auto-fill the weight prompt the moment the scale settles on a reading —
  // only while the cashier hasn't started typing a value by hand.
  useEffect(() => {
    if (pendingWeightProduct && weightInput === '' && liveKg && liveKg > 0) {
      setWeightInput(String(Math.round(liveKg * 1000) / 1000));
    }
  }, [liveKg, pendingWeightProduct, weightInput]);

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
    // Was 5 minutes — meant a change like the tile color theme could sit
    // invisible on an already-open till until that window happened to lapse.
    // Settings are cheap to refetch and rarely change, so just always check
    // on mount (e.g. switching back to this page) instead of trusting a
    // stale cache.
    staleTime: 0,
  });
  const storeName = storeSettings?.company_name || 'Core';

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
    // Product edits (price, color, image, stock) made from the Products page,
    // or stock moved by a sale on another till, must show up here without the
    // cashier needing to reload — don't let this sit stale in the background
    // while the till stays open all shift.
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

  // Derive categories
  const categories = ['All', ...Array.from(new Set(allProducts.map((p: any) => p.category?.name).filter(Boolean))) as string[]];
  // name -> color, so the category strip and product tiles can share a
  // product's category tint when the product itself has no color/image set.
  const categoryColors = new Map<string, string>();
  const categoryIds = new Map<string, number>();
  allProducts.forEach((p: any) => {
    if (!p.category?.name) return;
    if (p.category?.color && !categoryColors.has(p.category.name)) categoryColors.set(p.category.name, p.category.color);
    if (p.category?.id !== undefined && !categoryIds.has(p.category.name)) categoryIds.set(p.category.name, p.category.id);
  });
  // Settings → "Product Tile Colour Theme" — applied to any tile that has
  // neither its own color nor a colored category to fall back on. Categories
  // with no explicit color of their own get the same theme treatment,
  // cycling deterministically per category id (same idea as product tiles).
  const tileTheme = TILE_THEMES[storeSettings?.pos_tile_theme] || TILE_THEMES.rainbow;

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

  // A fresh search/category/page starts with nothing arrow-highlighted —
  // the cashier presses ArrowDown to start navigating the new result set.
  useEffect(() => { setHighlightIndex(-1); }, [search, activeCategory, clampedPage]);

  // Keep the highlighted tile visible as the cashier arrows past the edge of the scroll area
  useEffect(() => {
    if (highlightIndex < 0) return;
    tileRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightIndex]);

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
        resolveReceiptPrintMode(hw.printerMode),
        hw.printerName
      ).catch((error: any) => {
        toast.error(error?.message ?? 'Sale completed, but receipt printing failed');
      });

      broadcastCart({ type: 'thankyou', storeName, currency });
      setTimeout(() => broadcastCart({ type: 'idle', storeName, currency }), 4000);
      saleSnapshotRef.current = null;

      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-low-count'] });
      qc.invalidateQueries({ queryKey: ['inventory-out-count'] });
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

  // Shared by both the direct-add path (live scale reading, or a plain
  // count item) and the manual-weight-entry path below — keeps the price
  // check / stock check / toast messaging identical for both.
  const addProductWithQty = (product: any, qty: number, soldByWeight: boolean): boolean => {
    const price = parseFloat(product.selling_price);
    if (!price || Number.isNaN(price) || price <= 0) {
      toast.error(`${product.name} has no price set — add a price before selling it`, { duration: 3000 });
      return false;
    }
    // Tapping/scanning a product already in the cart adds a new line rather
    // than bumping an existing one — so the stock check here must sum every
    // line already in the cart for this product, not just look up one.
    const existingQty = cart.items.filter((i) => i.product_id === product.id).reduce((s, i) => s + i.quantity, 0);
    const stock = product.total_stock ?? product.stock_quantity ?? product.quantity_in_stock ?? null;
    const blockNegStock = storeSettings?.block_negative_stock !== 'false' && storeSettings?.block_negative_stock !== false;
    if (blockNegStock && product.track_stock !== false && stock !== null && existingQty + qty > stock) {
      toast.error(stock <= 0 ? `${product.name} is out of stock` : `Only ${stock} ${product.name} in stock`, { duration: 3000 });
      return false;
    }
    cart.addItem({
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      price,
      cost: parseFloat(product.cost_price || 0),
      tax_rate: effectiveTaxRate(product, storeSettings),
      sold_by_weight: soldByWeight,
    }, qty);
    return true;
  };

  const handleAddProduct = (product: any) => {
    const soldByWeight = !!product.sold_by_weight;
    if (soldByWeight) {
      // Use the live scale reading (in kg) if one's available. Otherwise
      // prompt for a hand-entered weight rather than silently adding "1".
      const kg = liveKg && liveKg > 0 ? Math.round(liveKg * 1000) / 1000 : null;
      if (kg === null) {
        if (scaleActive && !scale.connected) toast.error(`${product.name} is sold by weight — scale isn't connected, enter the weight manually`);
        setPendingWeightProduct(product);
        setWeightInput('');
        return;
      }
      if (addProductWithQty(product, kg, true)) toast.success(`Added ${product.name} (${kg.toFixed(3)} kg)`, { duration: 800 });
      return;
    }
    if (addProductWithQty(product, 1, false)) toast.success(`Added ${product.name}`, { duration: 800 });
  };

  const confirmPendingWeight = () => {
    if (!pendingWeightProduct) return;
    const n = parseFloat(weightInput);
    if (!isNaN(n) && n > 0) {
      const qty = Math.round(n * 1000) / 1000;
      if (addProductWithQty(pendingWeightProduct, qty, true)) toast.success(`Added ${pendingWeightProduct.name} (${qty.toFixed(3)} kg)`, { duration: 800 });
    }
    setPendingWeightProduct(null);
  };

  // Search-box Enter — an arrow-highlighted tile wins first (cashier navigated
  // the results with the keyboard), otherwise fall back to an exact SKU/barcode
  // match (or a single filtered result), so a cashier can key in a code without
  // touching the grid at all.
  const handleSearchEnter = () => {
    if (highlightIndex >= 0 && pagedProducts[highlightIndex]) {
      handleAddProduct(pagedProducts[highlightIndex]);
      setSearch('');
      return;
    }
    const code = search.trim();
    if (!code) return;
    const exact = allProducts.find((p: any) => (p.sku ?? '') === code || (p.barcode ?? '') === code);
    if (exact) { handleAddProduct(exact); setSearch(''); return; }
    if (filteredProducts.length === 1) { handleAddProduct(filteredProducts[0]); setSearch(''); return; }
    toast.error(`No exact match for "${code}"`);
  };

  // ArrowUp/ArrowDown while the search box is focused move the highlight
  // through the currently visible page of results instead of doing nothing
  // (global ArrowUp/ArrowDown panel-scrolling in AppLayout already backs off
  // for focused inputs, so this is the only handler that sees them here).
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (pagedProducts.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(pagedProducts.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(0, i - 1));
    }
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
      register_id: registerId,
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

        {/* Left: products — search, colorful category row, image-led product grid */}
        <div className="flex-[1.65] min-w-0 flex flex-col gap-2 min-h-0">
          <div className="flex-1 min-h-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0">
              <form onSubmit={(e) => { e.preventDefault(); handleSearchEnter(); }} className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search product by name or SKU"
                  className="w-full pl-9 pr-9 py-2.5 border border-gray-200 focus:border-blue-400 rounded-xl text-sm bg-white focus:outline-none transition-colors"
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

            {/* Category row — big colorful icon chips, mirrors the reference layout */}
            <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0 flex items-center gap-2 overflow-x-auto">
              {categories.map((cat) => {
                const ownCatColor = cat === 'All' ? undefined : categoryColors.get(cat);
                const themeCatColor = cat === 'All' || ownCatColor ? undefined : tileTheme[Math.abs(categoryIds.get(cat) ?? 0) % tileTheme.length];
                const catColor = ownCatColor || themeCatColor;
                return (
                  <CategoryChip
                    key={cat}
                    label={cat}
                    displayLabel={cat === 'All' ? 'All Items' : cat}
                    active={activeCategory === cat}
                    color={catColor}
                    onClick={() => setActiveCategory(cat)}
                    title={cat === 'All' ? 'All Products' : cat}
                  />
                );
              })}
            </div>

            <div className="flex-1 p-2.5 flex flex-col gap-2 min-h-0">
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
                <div className="flex-1 grid content-start gap-2.5 overflow-y-auto min-h-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                  {pagedProducts.map((product: any, tileIndex: number) => {
                    // A color chosen directly on the product renders as a solid card — the
                    // shade should show exactly as picked. A colored category (no explicit
                    // product color) stays a soft tint instead, since that's a grouping cue
                    // rather than a deliberate per-product choice. With neither, the active
                    // tile-color theme fills in a solid color instead of plain white, picked
                    // deterministically per product id so it stays stable across re-renders.
                    const ownColor = product.color;
                    const categoryColor = !ownColor && product.category?.name ? categoryColors.get(product.category.name) : undefined;
                    const themeColor = !ownColor && !categoryColor ? tileTheme[Math.abs(product.id) % tileTheme.length] : undefined;
                    const solidColor = ownColor || themeColor;
                    const textColor = solidColor ? contrastText(solidColor) : undefined;
                    // Same "out of stock" rule handleAddProduct blocks on — grey the card out
                    // to match, so it reads as unavailable before the cashier even taps it.
                    const stock = product.total_stock ?? product.stock_quantity ?? product.quantity_in_stock ?? null;
                    const blockNegStock = storeSettings?.block_negative_stock !== 'false' && storeSettings?.block_negative_stock !== false;
                    const isOutOfStock = blockNegStock && product.track_stock !== false && stock !== null && stock <= 0;
                    const isHighlighted = tileIndex === highlightIndex;
                    return (
                      <ProductCard
                        key={product.id}
                        product={product}
                        onClick={() => handleAddProduct(product)}
                        solidColor={solidColor}
                        categoryColor={categoryColor}
                        textColor={textColor}
                        isOutOfStock={isOutOfStock}
                        highlighted={isHighlighted}
                        priceLabel={`${formatCurrency(parseFloat(product.selling_price))}${product.sold_by_weight ? '/kg' : ''}`}
                        innerRef={(el) => { tileRefs.current[tileIndex] = el; }}
                      />
                    );
                  })}
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
        </div>

        {/* Right: ticket + payment (persistent, no separate screen) — narrower
            now so the product grid gets the extra room. */}
        <div className="flex-1 min-w-[340px] max-w-[420px] flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-y-auto min-h-0">
          {/* Header row */}
          <div className="flex items-center justify-between px-3 py-0.5 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900">Current Sale</span>
              <button
                type="button"
                onClick={() => setShowCustomerPicker(true)}
                title="Select customer"
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold transition-colors touch-manipulation max-w-[140px] ${
                  cart.customerId
                    ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    : 'bg-white border border-gray-200 hover:bg-blue-50 hover:border-blue-300 text-gray-500 hover:text-blue-700'
                }`}
              >
                <User size={11} className="flex-shrink-0" />
                <span className="truncate">{cart.customerId ? cart.customerName : 'Customer'}</span>
              </button>
              <button
                type="button"
                onClick={handleHoldOrder}
                disabled={cart.items.length === 0 || holdMutation.isPending}
                aria-label="Hold order (F8)"
                aria-keyshortcuts="F8"
                title="Hold order (F8)"
                className="flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-200 hover:bg-blue-50 hover:border-blue-300 text-gray-500 hover:text-blue-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 touch-manipulation"
              >
                {holdMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <PauseCircle size={11} />}
                Hold
              </button>
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

          {/* Order type selector removed to give the item list more vertical
              room — orders default to 'sit_in' (Walk-in); cart.orderType is
              still read by the receipt/KDS/printer, it just no longer has a
              picker on this screen. */}
          <div className="px-3 pt-1 flex-shrink-0">
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
              cart.items.map((item) => <CartRow key={item.line_id} item={item} format={formatCurrency} />)
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
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {PAYMENT_METHODS.map(({ value, label, icon: Icon, activeClass }, idx) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setPaymentMethod(value)}
                      aria-label={`Pay by ${label} (${idx + 1})`}
                      aria-pressed={paymentMethod === value}
                      className={`min-h-[64px] flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl text-xs font-bold border-2 transition-all touch-manipulation ${
                        paymentMethod === value
                          ? activeClass
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'
                      }`}
                    >
                      <Icon size={20} />
                      {label}
                    </button>
                  ))}
                </div>

                {paymentMethod === 'cash' && (
                  <div className="mb-2">
                    <CashNotesPad
                      value={cashTendered}
                      onChange={setCashTendered}
                      onConfirm={() => {
                        if (cart.items.length > 0 && cashTendered && parseFloat(cashTendered) >= totalDue) handleProcessSale();
                      }}
                      label="Cash Tendered"
                      currencyCode={activeCurrency?.code ?? 'USD'}
                      totalDue={totalDue}
                      change={change}
                      formatAmount={fmtActive}
                      confirmLabel={change > 0 ? `✓  Change: ${fmtActive(change)}` : '✓ Process'}
                      confirmCls={cart.items.length > 0 && cashTendered && parseFloat(cashTendered) >= totalDue ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' : 'bg-gray-200 text-gray-400 border-gray-200'}
                      disabled={cart.items.length === 0 || saleMutation.isPending}
                      hideNoteButtons
                      hideConfirmButton
                    />
                  </div>
                )}
              </>
            )}

            {/* Numeric keypad + Process — always visible (both split and
                non-split payment, same as before). Digits type into Cash
                Tendered; Process triggers the sale (F9) regardless of method. */}
            <div className="grid grid-cols-3 gap-2">
              {['1','2','3','4','5','6','7','8','9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCashTendered(cashTendered + d)}
                  className="py-2.5 bg-gray-50 hover:bg-blue-50 border-2 border-gray-100 rounded-xl font-bold text-gray-800 text-xl touch-manipulation transition-colors"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCashTendered(cashTendered.slice(0, -1))}
                className="py-2.5 bg-gray-100 hover:bg-red-50 hover:text-red-600 border-2 border-gray-100 rounded-xl font-bold text-gray-600 text-lg touch-manipulation transition-colors"
              >
                ⌫
              </button>
              <button
                type="button"
                onClick={() => setCashTendered(cashTendered + '0')}
                className="py-2.5 bg-gray-50 hover:bg-blue-50 border-2 border-gray-100 rounded-xl font-bold text-gray-800 text-xl touch-manipulation transition-colors"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleProcessSale}
                disabled={cart.items.length === 0 || saleMutation.isPending || needsRegisterSelection || (!isSplitPayment && paymentMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) < totalDue))}
                aria-label="Process sale (F9)"
                aria-keyshortcuts="F9"
                className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm touch-manipulation transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {saleMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : 'Process'}
              </button>
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

    {/* Manual weight entry — a weight-priced product tapped with no live scale reading */}
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

    {/* Till selection — only ever shown when this branch has more than one
        active register configured for ZIMRA fiscalisation (Settings ›
        Fiscalisation); a single-till branch never sees this. */}
    {needsRegisterSelection && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
          <h2 className="font-bold text-gray-900 mb-1">Select this till</h2>
          <p className="text-sm text-gray-500 mb-4">This branch has more than one till registered with ZIMRA — pick which one this device is, so receipts fiscalise correctly.</p>
          <div className="space-y-2">
            {fiscalRegisters.map((r: any) => (
              <button
                key={r.id}
                type="button"
                onClick={() => selectRegister(r.id)}
                className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors font-semibold text-gray-800"
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
