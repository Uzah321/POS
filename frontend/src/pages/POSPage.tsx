import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, salesApi, settingsApi, customersApi, weighingScalesApi } from '../api';
import type { CartItem, HeldOrder } from '../stores/cartStore';
import { useCartStore, unsentKitchenItems } from '../stores/cartStore';
import { usePosUIStore } from '../stores/posUIStore';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useSelectedRegister } from '../hooks/useSelectedRegister';
import { buildReceiptDataFromSale, printReceipt, printKitchenTicket, resolveReceiptPrintMode } from '../lib/hardware/printer';
import { usePrinterReconnect } from '../hooks/usePrinterReconnect';
import { broadcastCart } from '../lib/hardware/customerDisplay';
import { useScaleReading, getScaleReading, toKg, ensureScalesAutoConnected, type ScaleDevice } from '../lib/hardware/scale';
import { db } from '../lib/db';
import { offlineMutate } from '../lib/offlineMutation';
import { effectiveTaxRate } from '../lib/taxSettings';
import NumericKeypad from '../components/ui/NumericKeypad';
import OnScreenKeyboard from '../components/ui/OnScreenKeyboard';
import PosProductTile from '../components/pos/PosProductTile';
import ScrollArrows, { useScrollState } from '../components/pos/ScrollArrows';
import { iconForCategory } from '../lib/categoryIcons';
import { decodeEmbeddedBarcode } from '../lib/barcode/embeddedBarcode';
import { useServerHealth } from '../hooks/useServerHealth';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, Trash2, Loader2, CreditCard, Banknote, Smartphone,
  X, ShoppingCart, PauseCircle, PlayCircle, Clock, Keyboard,
  User, Award, LayoutGrid,
  ChevronLeft, ChevronRight,
  Minus, ScanLine, ArrowLeftRight, XCircle, Delete, Settings, HelpCircle, CalendarCheck,
} from 'lucide-react';

const APP_VERSION = '1.2.0';
import toast from 'react-hot-toast';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote, activeClass: 'bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-200' },
  { value: 'card', label: 'Card', icon: CreditCard, activeClass: 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200' },
  { value: 'mobile_money', label: 'Mobile', icon: Smartphone, activeClass: 'bg-purple-600 border-purple-600 text-white shadow-md shadow-purple-200' },
];

function CartRow({ item, format, image }: { item: CartItem; format: (v: number) => string; image?: string }) {
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

  const stepBtn = 'w-8 h-8 flex items-center justify-center border border-slate-200 bg-white text-slate-700 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-white touch-manipulation';

  return (
    <div className="flex items-center gap-2 py-1 px-4 border-b border-slate-100 last:border-b-0">
      <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-slate-100 flex items-center justify-center">
        {image
          ? <img src={image} alt="" className="w-full h-full object-cover" />
          : <span className="text-sm font-bold text-slate-400">{item.name?.[0]?.toUpperCase() ?? '?'}</span>}
      </div>
      <p className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 leading-tight line-clamp-2">{item.name}</p>

      <div className="w-[112px] flex items-center justify-center flex-shrink-0">
        {item.sold_by_weight ? (
          <button type="button" onClick={openQtyEdit} title="Tap to set weight"
            className="h-9 px-2 min-w-[72px] text-center text-sm font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg hover:bg-blue-50 touch-manipulation">
            {item.quantity.toFixed(3)}kg
          </button>
        ) : (
          <>
            <button type="button" onClick={() => updateQty(item.line_id, item.quantity - 1)} disabled={item.quantity <= 1} aria-label="Decrease quantity" className={`${stepBtn} rounded-l-lg`}>
              <Minus size={14} />
            </button>
            <button type="button" onClick={openQtyEdit} title="Tap to set quantity"
              className="w-10 h-8 text-center text-sm font-bold text-slate-900 border-y border-slate-200 bg-white hover:bg-blue-50 touch-manipulation">
              {item.quantity}
            </button>
            <button type="button" onClick={() => updateQty(item.line_id, item.quantity + 1)} aria-label="Increase quantity" className={`${stepBtn} rounded-r-lg`}>
              <Plus size={14} />
            </button>
          </>
        )}
      </div>

      <p className="w-[62px] text-right text-[13px] text-slate-600 tabular-nums flex-shrink-0">{format(item.price)}</p>
      <p className="w-[66px] text-right text-[13px] font-bold text-slate-900 tabular-nums flex-shrink-0">{format(lineTotal)}</p>
      <button type="button" onClick={() => removeItem(item.line_id)} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-red-500 transition-colors touch-manipulation" title="Remove item">
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
  // Below lg, the product grid and the always-visible payment/ticket panel
  // can't both fit — showing both squeezed the product grid down to a
  // sliver. Below that breakpoint only one panel renders at a time, picked
  // by this tab; at lg+ both render side by side as before, unaffected.
  const [mobileTab, setMobileTab] = useState<'products' | 'ticket'>('products');
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
  const { user, hasPermission, hasRole } = useAuthStore();
  const navigate = useNavigate();
  const { isServerUp } = useServerHealth();
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
  usePrinterReconnect();
  const { activeCurrency } = useCurrencyStore();
  const currency = activeCurrency?.symbol ?? '$';
  // Registered weighing scales — a store can run several (one per
  // department), each owning its own list of products (product.scale_id).
  // Connections are managed centrally in lib/hardware/scale.ts; this just
  // makes sure every active scale gets (re)dialled once the list loads.
  const { data: scales = [] } = useQuery<ScaleDevice[]>({
    queryKey: ['weighing-scales'],
    queryFn: () => weighingScalesApi.list().then(r => r.data?.data || []),
  });
  useEffect(() => { if (scales.length) ensureScalesAutoConnected(scales); }, [scales]);

  // A weight-priced product tapped with no live scale reading — prompts for
  // a hand-entered weight before anything is added to the cart, so a
  // dismissed prompt never leaves a phantom "1 kg" line behind.
  const [pendingWeightProduct, setPendingWeightProduct] = useState<any | null>(null);
  const [weightInput, setWeightInput] = useState('');

  // Live reading for whichever scale the product waiting on the weight
  // keypad is assigned to (null product/scale just reads back "disconnected").
  const pendingScaleReading = useScaleReading(pendingWeightProduct?.scale_id ?? null);
  const liveKg = pendingWeightProduct?.scale_id != null && pendingScaleReading.connected && pendingScaleReading.weight
    ? toKg(pendingScaleReading.weight) : null;

  // Auto-fill the weight prompt the moment its scale settles on a reading —
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
  // Not useCallback — it needs a fresh closure over allProducts/storeSettings
  // (both declared further down) on every render for tryAddEmbeddedBarcode to
  // see current data; useBarcodeScanner re-subscribing its listener on every
  // render is cheap (a capture-phase keydown listener), unlike the risk of a
  // stale product list silently missing newly-added PLU codes.
  const handleBarcodeScan = (code: string) => {
    if (tryAddEmbeddedBarcode(code)) return;
    setSearch(code);
    searchRef.current?.focus();
    if (hw.barcodeAutoAdd) {
      // Auto-add handled after product list re-renders (see filteredProducts effect below)
      barcodeRef.current = code;
    }
  };

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
  const categoryImages = new Map<string, string>();
  const categoryIds = new Map<string, number>();
  allProducts.forEach((p: any) => {
    if (!p.category?.name) return;
    if (p.category?.color && !categoryColors.has(p.category.name)) categoryColors.set(p.category.name, p.category.color);
    if (p.category?.image && !categoryImages.has(p.category.name)) categoryImages.set(p.category.name, p.category.image);
    if (p.category?.id !== undefined && !categoryIds.has(p.category.name)) categoryIds.set(p.category.name, p.category.id);
  });
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
    ticketNum: string;
    note: string;
  };
  const saleSnapshotRef = useRef<CartSnapshot | null>(null);

  // Prints a kitchen ticket for the lines on `items` the kitchen hasn't had yet
  // (optionally only the categories this device's kitchen printer handles).
  // Returns true when kitchen printing is on, i.e. the caller should record
  // these lines as sent — even if the category filter left nothing to print.
  const sendKitchenTicket = (
    items: CartItem[],
    meta: { ticket: string; table: string; orderType: 'sit_in' | 'takeaway' | 'delivery'; covers: number; customerName: string; note: string },
  ): boolean => {
    if (!hw.kitchenPrinterEnabled) return false;
    const categoryOf = (productId: number) => {
      const product = allProducts.find((p: any) => p.id === productId);
      return product?.category_id ?? product?.category?.id;
    };
    const lines = unsentKitchenItems(items).filter((i) =>
      hw.kitchenCategoryIds.length === 0 || hw.kitchenCategoryIds.includes(categoryOf(i.product_id)));
    if (lines.length === 0) return true;
    void printKitchenTicket({
      title: items.some((i) => (i.kitchen_sent_qty ?? 0) > 0) ? 'ADD TO ORDER' : 'NEW ORDER',
      ticket: meta.ticket,
      table: meta.table || undefined,
      orderType: meta.orderType,
      covers: meta.table ? meta.covers : undefined,
      waiter: user?.name,
      customerName: meta.customerName || undefined,
      items: lines.map((i) => ({ name: i.name, qty: i.unsent, soldByWeight: i.sold_by_weight })),
      note: meta.note || undefined,
    }, resolveReceiptPrintMode(hw.kitchenPrinterMode), hw.kitchenPrinterName).catch((error: any) => {
      toast.error(error?.message ?? 'Kitchen ticket failed to print');
    });
    return true;
  };

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

      if (snap) {
        sendKitchenTicket(snap.items, {
          ticket: sale?.reference ?? snap.ticketNum,
          table: snap.tableNumber,
          orderType: snap.orderType,
          covers: snap.covers,
          customerName: snap.customerName,
          note: snap.note,
        });
      }

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
  const addProductWithQty = (product: any, qty: number, soldByWeight: boolean, priceOverride?: number): boolean => {
    const price = priceOverride ?? parseFloat(product.selling_price);
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
      scale_id: soldByWeight ? (product.scale_id ?? null) : undefined,
    }, qty);
    return true;
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
      toast.success(decoded.kind === 'weight'
        ? `Added ${product.name} (${decoded.value.toFixed(3)} kg)`
        : `Added ${product.name}`, { duration: 800 });
    }
    return true;
  };

  const handleAddProduct = (product: any) => {
    const soldByWeight = !!product.sold_by_weight;
    if (soldByWeight) {
      // Read straight off this product's own assigned scale (not whichever
      // scale a previous weigh-in left "pending") — every product only ever
      // weighs on the one scale it's assigned to.
      const reading = product.scale_id != null ? getScaleReading(product.scale_id) : null;
      const productLiveKg = reading?.connected && reading.weight ? toKg(reading.weight) : null;
      const kg = productLiveKg && productLiveKg > 0 ? Math.round(productLiveKg * 1000) / 1000 : null;
      if (kg === null) {
        if (product.scale_id != null && !reading?.connected) toast.error(`${product.name} is sold by weight — its scale isn't connected, enter the weight manually`);
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
    if (tryAddEmbeddedBarcode(code)) { setSearch(''); return; }
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
      ticketNum: cart.ticketNum,
      note: cart.note,
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
    // Holding an order is when it goes to the kitchen — ticket whatever the
    // kitchen hasn't had yet, then record it as sent so resuming and adding
    // to this table later only tickets the additions.
    const sent = sendKitchenTicket(cart.items, {
      ticket: cart.ticketNum,
      table: cart.tableNumber !== 'Walk-in' ? cart.tableNumber : '',
      orderType: cart.orderType,
      covers: cart.covers,
      customerName: cart.customerName,
      note: cart.note,
    });
    const heldItems = sent ? cart.items.map((i) => ({ ...i, kitchen_sent_qty: i.quantity })) : cart.items;
    if (sent) cart.markSentToKitchen();
    // Save current cart to local held orders and clear cart immediately
    const holdPayload = {
      branch_id: branchId,
      customer_id: cart.customerId,
      table_number: cart.tableNumber !== 'Walk-in' ? cart.tableNumber : null,
      order_type: cart.orderType,
      cart_data: {
        items: heldItems,
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

  // Keypad for Cash Tendered. Every change first pushes the previous value so "Undo" can step back.
  const tenderHistory = useRef<string[]>([]);
  const tender = (key: string) => {
    const cur = cashTendered ?? '';
    const push = () => { tenderHistory.current.push(cur); if (tenderHistory.current.length > 30) tenderHistory.current.shift(); };
    if (key === 'undo') {
      const prev = tenderHistory.current.pop();
      if (prev !== undefined) setCashTendered(prev);
      return;
    }
    push();
    if (key === 'clear') setCashTendered('');
    else if (key === 'back') setCashTendered(cur.slice(0, -1));
    else if (key === 'exact') setCashTendered(totalDue > 0 ? totalDue.toFixed(2) : '');
    else if (key === '.') { if (!cur.includes('.')) setCashTendered((cur || '0') + '.'); }
    else if (!/\.\d{2}$/.test(cur)) setCashTendered(cur + key);
  };

  const productImages = new Map<number, string>();
  allProducts.forEach((p: any) => { if (p.image) productImages.set(p.id, p.image); });
  const subtotalNow = cart.subtotal();
  const taxPct = subtotalNow > 0 ? Math.round((cart.taxTotal() / subtotalNow) * 1000) / 10 : 0;

  // External keyboard: land the cursor in Cash tendered whenever cash becomes the
  // active method, so the cashier can type the amount and press Enter to process.
  const cashInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (paymentMethod === 'cash' && !isSplitPayment) cashInputRef.current?.focus();
  }, [paymentMethod, isSplitPayment]);

  const railRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const railScroll = useScrollState(railRef, [categories.length]);
  const gridScroll = useScrollState(gridRef, [pagedProducts.length, productsLoading, mobileTab]);
  const NAVY = '#0d2350';
  const NAVY_TILE = '#173463';
  const BLUE = '#2f6df6';
  const KEY_CLS = 'rounded-xl font-semibold text-[21px] touch-manipulation transition-colors active:scale-[0.97] flex items-center justify-center';
  const KEY_H = 'clamp(34px, 4.5vh, 58px)';
  const canProcess = !(cart.items.length === 0 || saleMutation.isPending || needsRegisterSelection || (!isSplitPayment && paymentMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) < totalDue)));

  return (
    <>
      {/* Fixed height against the viewport (matching CashierPage's approach) rather than
          relying on AppLayout's <main> to propagate a bounded height through flex-1 —
          that element scrolls the whole page instead of just this page's own regions. */}
      <div className="pos-screen -m-3 sm:-m-5 lg:-m-6 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 64px)', background: '#eef2f8' }}>

      {/* Below lg only one of products / ticket fits at a time — this tab picks which. */}
      <div className="flex lg:hidden items-stretch gap-2 px-2 sm:px-3 pt-2 flex-shrink-0">
        {(['products', 'ticket'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-colors touch-manipulation ${
              mobileTab === tab ? 'text-white' : 'bg-white text-slate-500 border border-slate-200'
            }`}
            style={mobileTab === tab ? { background: BLUE } : undefined}
          >
            {tab === 'products' ? <><LayoutGrid size={15} /> Products</> : (
              <>
                <ShoppingCart size={15} /> Ticket
                {cart.items.length > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${mobileTab === 'ticket' ? 'bg-white text-blue-700' : 'bg-blue-600 text-white'}`}>
                    {cart.items.length} &middot; {formatCurrency(total)}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Category rail — big icon tiles on navy (lg+) */}
        <div className="hidden lg:flex flex-col w-[156px] flex-shrink-0 min-h-0" style={{ background: NAVY }}>
        <aside ref={railRef} className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-y-auto p-2.5">
          {categories.map((cat) => {
            const Icon = iconForCategory(cat);
            const catImage = cat === 'All' ? undefined : categoryImages.get(cat);
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                title={cat === 'All' ? 'All Products' : cat}
                className="flex-shrink-0 flex flex-col items-center justify-center gap-2 rounded-2xl min-h-[92px] px-2 py-3 text-white text-[15px] font-semibold leading-tight text-center transition-colors touch-manipulation hover:brightness-125"
                style={{ background: active ? BLUE : NAVY_TILE, boxShadow: active ? '0 6px 16px rgba(47,109,246,.35)' : undefined }}
              >
                {catImage
                  ? <img src={catImage} alt="" draggable={false} className="w-14 h-14 rounded-xl object-cover bg-white/10" />
                  : <Icon size={30} strokeWidth={1.6} />}
                <span className="line-clamp-2">{cat === 'All' ? 'All Items' : cat}</span>
              </button>
            );
          })}
        </aside>
        <ScrollArrows targetRef={railRef} state={railScroll} variant="rail" />
        </div>

        {/* Products: search + scan, then the grid */}
        <div className={`${mobileTab === 'products' ? 'flex' : 'hidden'} lg:flex flex-col flex-1 min-w-0 min-h-0 gap-3 p-3`}>
          <div className="flex items-stretch gap-3 flex-shrink-0">
            <form onSubmit={(e) => { e.preventDefault(); handleSearchEnter(); }} className="relative flex-1">
              <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search product by name or SKU..."
                className="w-full h-[52px] pl-12 pr-14 bg-white border border-slate-200 focus:border-blue-400 rounded-xl text-[15px] focus:outline-none transition-colors shadow-sm"
              />
              <button
                type="button"
                onClick={() => setShowSearchModal(true)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-500 hover:text-blue-600 touch-manipulation"
                title="Open on-screen keyboard"
              >
                <Keyboard size={20} />
              </button>
            </form>
            <button
              type="button"
              onClick={() => { searchRef.current?.focus(); searchRef.current?.select(); }}
              title="Scan a barcode — the scanner types into the search box"
              className="flex items-center gap-2 px-5 h-[52px] rounded-xl bg-white border border-slate-200 text-[15px] font-semibold hover:bg-blue-50 transition-colors shadow-sm touch-manipulation flex-shrink-0"
              style={{ color: '#173463' }}
            >
              <ScanLine size={20} /> Scan
            </button>
          </div>

          {/* Category pills — small screens only; the rail above takes over at lg+ */}
          <div className="flex lg:hidden items-center gap-2 overflow-x-auto flex-shrink-0">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold touch-manipulation ${activeCategory === cat ? 'text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
                style={activeCategory === cat ? { background: BLUE } : undefined}
              >
                {cat === 'All' ? 'All Items' : cat}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 flex flex-col gap-2">
            {productsLoading ? (
              <div className="flex-1 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-blue-500" /></div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                <Search size={32} className="text-slate-300" />
                <p className="text-sm">No products found</p>
              </div>
            ) : (
              <div ref={gridRef} className="flex-1 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 auto-rows-max content-start gap-2.5 overflow-y-auto min-h-0 pr-1">
                {pagedProducts.map((product: any, tileIndex: number) => {
                  // A product's own colour wins, then its category's colour — used only as
                  // the backdrop when there's no photo to show.
                  const tint = product.color
                    || (product.category?.name ? categoryColors.get(product.category.name) : undefined)
                    || undefined;
                  // Same "out of stock" rule handleAddProduct blocks on — grey the card out
                  // to match, so it reads as unavailable before the cashier even taps it.
                  const stock = product.total_stock ?? product.stock_quantity ?? product.quantity_in_stock ?? null;
                  const blockNegStock = storeSettings?.block_negative_stock !== 'false' && storeSettings?.block_negative_stock !== false;
                  const isOutOfStock = blockNegStock && product.track_stock !== false && stock !== null && stock <= 0;
                  return (
                    <PosProductTile
                      key={product.id}
                      product={product}
                      onClick={() => handleAddProduct(product)}
                      tint={tint ? `${tint}33` : undefined}
                      isOutOfStock={isOutOfStock}
                      highlighted={tileIndex === highlightIndex}
                      priceLabel={`${formatCurrency(parseFloat(product.selling_price))}${product.sold_by_weight ? '/kg' : ''}`}
                      innerRef={(el) => { tileRefs.current[tileIndex] = el; }}
                    />
                  );
                })}
              </div>
            )}

            <ScrollArrows targetRef={gridRef} state={gridScroll} variant="grid" />

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 flex-shrink-0">
                <button type="button" onClick={() => setProductPage((p) => Math.max(0, p - 1))} disabled={clampedPage === 0}
                  className="w-11 h-11 flex items-center justify-center rounded-xl text-white disabled:opacity-30 disabled:cursor-not-allowed touch-manipulation" style={{ background: BLUE }} title="Previous page">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">Page {clampedPage + 1} of {pageCount}</span>
                <button type="button" onClick={() => setProductPage((p) => Math.min(pageCount - 1, p + 1))} disabled={clampedPage >= pageCount - 1}
                  className="w-11 h-11 flex items-center justify-center rounded-xl text-white disabled:opacity-30 disabled:cursor-not-allowed touch-manipulation" style={{ background: BLUE }} title="Next page">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Current Sale card + Payment Method card. Below lg it is shown full-screen instead. */}
        <div className={`${mobileTab === 'ticket' ? 'flex' : 'hidden'} lg:flex flex-col gap-2 w-full lg:w-[470px] xl:w-[500px] lg:flex-shrink-0 min-h-0 p-2 lg:pl-0 overflow-y-auto`}>

          {/* Current Sale */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col flex-1 min-h-[370px] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-1.5 flex-shrink-0">
              <ShoppingCart size={22} style={{ color: BLUE }} />
              <span className="text-[19px] font-bold text-slate-900 mr-auto">Current Sale</span>
              <button
                type="button"
                onClick={() => setShowCustomerPicker(true)}
                title="Select customer"
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-sm font-semibold border border-slate-200 hover:bg-blue-50 touch-manipulation max-w-[130px]"
                style={{ color: cart.customerId ? BLUE : '#334155', background: cart.customerId ? '#e8f0ff' : undefined }}
              >
                <User size={16} className="flex-shrink-0" />
                <span className="truncate">{cart.customerId ? cart.customerName : 'Customer'}</span>
              </button>
              <button
                type="button"
                onClick={handleHoldOrder}
                disabled={cart.items.length === 0 || holdMutation.isPending}
                aria-label="Hold order (F8)"
                aria-keyshortcuts="F8"
                title="Hold order (F8)"
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-blue-50 disabled:opacity-40 touch-manipulation"
              >
                {holdMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <PauseCircle size={16} />} Hold
              </button>
              <button
                type="button"
                onClick={() => cart.clearCart()}
                aria-label="Clear sale (F5)"
                aria-keyshortcuts="F5"
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-100 touch-manipulation"
                style={{ background: '#fdecec' }}
              >
                <Trash2 size={16} /> Clear
              </button>
            </div>

            {(cart.heldOrders.length > 0) && (
              <div className="px-4 pb-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowHeldOrders(true)}
                  className="flex items-center gap-1.5 h-8 px-3 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-semibold touch-manipulation"
                  title="View held orders"
                >
                  <PauseCircle size={13} /> {cart.heldOrders.length} held
                </button>
              </div>
            )}

            <div className="flex items-center px-4 pb-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide flex-shrink-0">
              <span className="flex-1">Item</span>
              <span className="w-[112px] text-center">Qty</span>
              <span className="w-[62px] text-right">Price</span>
              <span className="w-[66px] text-right">Total</span>
              <span className="w-9" />
            </div>

            <div className="flex-1 min-h-[36px] overflow-y-auto border-t border-slate-100">
              {cart.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-2 py-6">
                  <ShoppingCart size={32} />
                  <p className="text-xs">Add items to start</p>
                </div>
              ) : (
                cart.items.map((item) => <CartRow key={item.line_id} item={item} format={formatCurrency} image={productImages.get(item.product_id)} />)
              )}
            </div>

            <div className="px-5 pt-1.5 pb-2 border-t border-slate-200 flex-shrink-0">
              <div className="flex justify-between gap-4 text-[13px] text-slate-500">
                <span>Subtotal <span className="tabular-nums text-slate-700 font-medium">{formatCurrency(cart.subtotal())}</span></span>
                {cart.discount > 0 && <span className="text-emerald-600">Discount <span className="tabular-nums">-{formatCurrency(cart.discount)}</span></span>}
                <span>Tax ({taxPct}%) <span className="tabular-nums text-slate-700 font-medium">{formatCurrency(cart.taxTotal())}</span></span>
              </div>
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-[22px] font-bold text-slate-900">Total</span>
                <span className="text-[34px] font-bold tabular-nums leading-none" style={{ color: '#1f5fe0' }}>{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Payment Method */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-2.5 flex-shrink-0">
            <div className="grid grid-cols-4 gap-2 mb-2">
              {PAYMENT_METHODS.map(({ value, label, icon: Icon }, idx) => {
                const active = !isSplitPayment && paymentMethod === value;
                return (
                  <button
                    type="button"
                    key={value}
                    onClick={() => { if (isSplitPayment) { setIsSplitPayment(false); setSplitPayments([]); } setPaymentMethod(value); }}
                    aria-label={`Pay by ${label} (${idx + 1})`}
                    aria-pressed={active}
                    className={`h-[clamp(44px,5.4vh,72px)] flex flex-col items-center justify-center gap-1 rounded-xl text-[15px] font-semibold transition-colors touch-manipulation ${active ? 'text-white shadow-md' : 'text-slate-700 hover:brightness-95'}`}
                    style={{ background: active ? '#1f63e6' : '#eef3fb' }}
                  >
                    <Icon size={22} strokeWidth={1.7} />
                    {label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => { setIsSplitPayment(!isSplitPayment); setSplitPayments([]); }}
                aria-pressed={isSplitPayment}
                className={`h-[clamp(44px,5.4vh,72px)] flex flex-col items-center justify-center gap-1 rounded-xl text-[15px] font-semibold transition-colors touch-manipulation ${isSplitPayment ? 'text-white shadow-md' : 'text-slate-700 hover:brightness-95'}`}
                style={{ background: isSplitPayment ? '#1f63e6' : '#eef3fb' }}
              >
                <ArrowLeftRight size={22} strokeWidth={1.7} />
                Split
              </button>
            </div>

            {isSplitPayment ? (
              <div className="space-y-2 mb-3">
                {splitPayments.map((sp, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                    <select value={sp.method} onChange={e => setSplitPayments(ps => ps.map((p,i) => i===idx ? {...p, method: e.target.value} : p))} className="text-sm border-0 bg-transparent focus:outline-none text-slate-700 font-medium">
                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <input type="number" value={sp.amount} onChange={e => setSplitPayments(ps => ps.map((p,i) => i===idx ? {...p, amount: e.target.value} : p))} className="flex-1 text-base text-right bg-transparent border-0 focus:outline-none font-semibold text-slate-800" placeholder="0.00" />
                    <button type="button" onClick={() => setSplitPayments(ps => ps.filter((_,i) => i!==idx))} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg text-red-400 hover:text-white hover:bg-red-500 transition-colors touch-manipulation"><X size={14} /></button>
                  </div>
                ))}
                {(() => {
                  const paid = splitPayments.reduce((s,p) => s + parseFloat(p.amount||'0'), 0);
                  const remaining = totalDue - paid;
                  return (
                    <>
                      {remaining !== 0 && <div className={`text-xs text-right font-semibold ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{remaining > 0 ? `Remaining: ${fmtActive(remaining)}` : `Over by: ${fmtActive(-remaining)}`}</div>}
                      <button type="button" onClick={() => setSplitPayments(ps => [...ps, {method: PAYMENT_METHODS[0]?.value ?? 'cash', amount: remaining > 0 ? remaining.toFixed(2) : ''}])} className="w-full min-h-11 border-2 border-dashed border-slate-200 rounded-xl text-xs text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center gap-2 touch-manipulation">
                        <Plus size={14} /> Add payment method
                      </button>
                    </>
                  );
                })()}
              </div>
            ) : paymentMethod === 'cash' ? (
              <div className="mb-2">
                <div className="flex items-center h-[clamp(40px,5.2vh,54px)] rounded-xl border border-slate-200 bg-white pl-4 pr-2">
                  <span className="flex flex-col leading-tight">
                    <span className="text-[12px] font-medium text-slate-500 uppercase tracking-wide">Cash tendered</span>
                    {cashTendered && (
                      <span className={`text-[11px] font-semibold ${change > 0 ? 'text-emerald-600' : parseFloat(cashTendered) < totalDue ? 'text-amber-600' : 'text-slate-500'}`}>
                        {parseFloat(cashTendered) < totalDue ? `Short by ${fmtActive(totalDue - parseFloat(cashTendered))}` : `Change: ${fmtActive(change)}`}
                      </span>
                    )}
                  </span>
                  <input
                    ref={cashInputRef}
                    type="text"
                    inputMode="decimal"
                    value={cashTendered}
                    placeholder="0.00"
                    aria-label="Cash tendered"
                    onChange={(e) => {
                      let v = e.target.value.replace(/[^0-9.]/g, '');
                      const parts = v.split('.');
                      if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
                      if (/\.\d{3,}$/.test(v)) v = v.slice(0, v.indexOf('.') + 3);
                      setCashTendered(v);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleProcessSale(); } }}
                    className="ml-auto min-w-0 w-40 text-right bg-transparent text-[24px] font-medium tabular-nums text-slate-700 placeholder:text-slate-300 pr-3 focus:outline-none"
                  />
                  <button type="button" onClick={() => tender('clear')} aria-label="Clear cash tendered" className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-red-500 touch-manipulation">
                    <XCircle size={22} strokeWidth={1.6} />
                  </button>
                </div>
              </div>
            ) : null}

            {/* Keypad — digits type into Cash Tendered; Process runs the sale (F9) for any method */}
            <div className="grid grid-cols-4 gap-2">
              {[['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3']].map((row, r) => (
                <div key={r} className="contents">
                  {row.map((d) => (
                    <button key={d} type="button" onClick={() => tender(d)} className={KEY_CLS} style={{ height: KEY_H, background: '#e6eefb', color: '#0f2a5c' }}>{d}</button>
                  ))}
                  {(() => {
                    const side = [
                      { label: 'Exact', act: () => tender('exact') },
                      { label: 'Undo', act: () => tender('undo') },
                      { label: 'Clear', act: () => tender('clear') },
                    ][r];
                    return (
                      <button type="button" onClick={side.act} className={`${KEY_CLS} !text-[17px]`} style={{ height: KEY_H, background: '#cfe0fb', color: '#1b4fbf' }}>{side.label}</button>
                    );
                  })()}
                </div>
              ))}
              <button type="button" onClick={() => tender('back')} aria-label="Backspace" className={KEY_CLS} style={{ height: KEY_H, background: '#d9e2ef', color: '#334155' }}><Delete size={24} strokeWidth={1.7} /></button>
              <button type="button" onClick={() => tender('0')} className={KEY_CLS} style={{ height: KEY_H, background: '#e6eefb', color: '#0f2a5c' }}>0</button>
              <button type="button" onClick={() => tender('.')} className={KEY_CLS} style={{ height: KEY_H, background: '#e6eefb', color: '#0f2a5c' }}>.</button>
              <button
                type="button"
                onClick={handleProcessSale}
                disabled={!canProcess}
                aria-label="Process sale (F9)"
                aria-keyshortcuts="F9"
                className={`${KEY_CLS} !text-[20px] gap-1.5 text-white disabled:opacity-40 disabled:cursor-not-allowed`}
                style={{ height: KEY_H, background: '#10a37f' }}
              >
                {saleMutation.isPending ? <Loader2 size={22} className="animate-spin" /> : <><ChevronRight size={24} strokeWidth={2.4} /> Process</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-white border-t border-slate-200 px-3 sm:px-5 h-9 flex items-center flex-shrink-0 text-sm whitespace-nowrap">
        <span className="flex items-center gap-2 font-semibold flex-1 sm:flex-none sm:w-1/3" style={{ color: isServerUp ? '#0f9d6b' : '#d97706' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: isServerUp ? '#10b981' : '#f59e0b' }} />
          {isServerUp ? 'Online' : 'Offline'}
        </span>
        <span className="hidden sm:inline w-1/3 text-center text-slate-600"><span className="font-semibold text-slate-800">Core POS</span> &nbsp;v{APP_VERSION}</span>
        {/* Phones: icon-only actions, no version, so the bar fits a narrow screen */}
        <span className="sm:w-1/3 flex items-center justify-end gap-5 sm:gap-6 text-slate-600">
          {(hasPermission('manage_day_end') || hasRole('admin')) && (
            <button type="button" onClick={() => navigate('/day-end')} className="flex items-center gap-2 hover:text-blue-700 touch-manipulation">
              <CalendarCheck size={18} /> <span className="hidden sm:inline">End Day</span>
            </button>
          )}
          {(hasPermission('manage_settings') || hasRole('admin')) && (
            <button type="button" onClick={() => navigate('/settings')} className="flex items-center gap-2 hover:text-blue-700 touch-manipulation">
              <Settings size={18} /> <span className="hidden sm:inline">Settings</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => toast('F2 Search · F5 Clear · F8 Hold · F9 Process · 1/2/3 Cash/Card/Mobile', { icon: '⌨️', duration: 6000 })}
            className="flex items-center gap-2 hover:text-blue-700 touch-manipulation"
          >
            <HelpCircle size={18} /> <span className="hidden sm:inline">Help</span>
          </button>
        </span>
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
            <button type="button" onClick={() => setShowHeldOrders(false)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-none hover:bg-gray-100">
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
                      className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-none text-xs font-semibold transition-colors touch-manipulation"
                    >
                      <PlayCircle size={13} /> Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => cart.removeHeldOrder(held.id)}
                      className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-none transition-colors touch-manipulation"
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
        label={`Weight (kg) — ${pendingWeightProduct.name}${pendingWeightProduct.scale_id != null ? (pendingScaleReading.connected ? ' — place on scale or type weight' : ' — scale not connected') : ''}`}
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
            <button type="button" onClick={() => { setShowCustomerPicker(false); setCustomerSearch(''); }} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-none hover:bg-gray-100"><X size={16} /></button>
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
              className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-none text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
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
                  className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-none hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
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
            <button type="button" onClick={() => setShowLoyaltyPanel(false)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-none hover:bg-gray-100"><X size={16} /></button>
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
                  className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-none text-sm disabled:opacity-50 flex items-center justify-center gap-2"
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
                className="w-full text-left px-4 py-3 rounded-none border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors font-semibold text-gray-800"
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
