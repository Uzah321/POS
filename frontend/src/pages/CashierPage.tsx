import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { productsApi, salesApi, settingsApi } from '../api';
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
import { useServerHealth } from '../hooks/useServerHealth';
import NumericKeypad from '../components/ui/NumericKeypad';
import SearchModal from '../components/ui/SearchModal';
import { Loader2, Plus, Minus, Trash2, RefreshCw, Keyboard } from 'lucide-react';
import toast from 'react-hot-toast';

const PAY_METHODS = [
  { value: 'cash',         label: 'CASH',   key: 'F1', activeClass: 'bg-blue-600   border-blue-700   text-white' },
  { value: 'card',         label: 'CARD',   key: 'F2', activeClass: 'bg-blue-700   border-blue-800   text-white' },
  { value: 'mobile_money', label: 'MOBILE', key: 'F3', activeClass: 'bg-purple-700 border-purple-800 text-white' },
] as const;

type PayMethod = typeof PAY_METHODS[number]['value'];

export default function CashierPage() {
  const [codeInput, setCodeInput]             = useState('');
  const [matchedProducts, setMatchedProducts] = useState<any[]>([]);
  const [payMethod, setPayMethod]             = useState<PayMethod>('cash');
  const [cashTendered, setCashTendered]       = useState('');
  const [currentTime, setCurrentTime]         = useState(new Date());
  const [showSearchModal, setShowSearchModal] = useState(false);

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

  useDBSync();
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
    staleTime: 5 * 60 * 1000,
  });

  const storeName    = storeSettings?.company_name || 'Core';
  const storeAddress = user?.branch?.address || storeSettings?.company_address;
  const storePhone   = user?.branch?.phone   || storeSettings?.company_phone;
  const isRestaurant = storeSettings?.business_type === 'restaurant';

  // Live KDS orders — only when restaurant mode
  const { data: kdsData } = useQuery({
    queryKey: ['cashier-kds'],
    queryFn: () => axios.get('/api/kds/orders').then(r => r.data),
    refetchInterval: 4000,
    enabled: isRestaurant,
  });
  const kdsOrders: any[] = kdsData?.data ?? [];

  // Products (IndexedDB fallback when offline)
  const { data: allProductsData, isLoading: productsLoading } = useQuery({
    queryKey: ['pos-products'],
    queryFn: async () => {
      try {
        const data = await productsApi.list({ per_page: 500, is_active: 1 })
          .then(r => r.data?.data?.data ?? r.data?.data ?? []);
        db.products.clear().then(() => db.products.bulkPut(data)).catch(() => {});
        return data;
      } catch {
        const cached = await db.products.toArray();
        return cached.length > 0 ? cached : [];
      }
    },
    staleTime: 60000,
  });

  const allProducts: any[] = Array.isArray(allProductsData) ? allProductsData : [];

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

  const addProduct = (product: any) => {
    // Block sale if stock is zero/negative and setting is enabled
    const stock = product.total_stock ?? product.stock_quantity ?? product.quantity_in_stock ?? null;
    const blockNeg = storeSettings?.block_negative_stock !== 'false' && storeSettings?.block_negative_stock !== false;
    if (blockNeg && stock !== null && stock <= 0) {
      toast.error(`${product.name} is out of stock`);
      return;
    }
    cart.addItem({
      product_id: product.id,
      name:       product.name,
      sku:        product.sku,
      price:      parseFloat(product.selling_price),
      cost:       parseFloat(product.cost_price || 0),
      tax_rate:   product.tax_rate?.rate || 0,
    });
    setCodeInput('');
    setMatchedProducts([]);
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

    const matches = allProducts.filter(p => p.name.toLowerCase().includes(ql));
    if (matches.length === 0) {
      toast.error(`"${q}" not found`);
    } else if (matches.length === 1) {
      addProduct(matches[0]);
    } else {
      setMatchedProducts(matches.slice(0, 8));
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
        reference: sale?.reference ?? `ONLINE-${Date.now()}`,
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

      toast.success(`Sale ${sale?.reference ?? ''} complete!`);

      void printReceipt(
        buildReceiptDataFromSale(sale ?? null, {
          storeName, storeAddress, storePhone,
          cashier: user?.name ?? '', currency,
          paymentMethod: payMethod,
          amountTendered: payMethod === 'cash' ? parseFloat(cashTendered) || cart.total() : undefined,
          change: payMethod === 'cash' ? Math.max(0, (parseFloat(cashTendered) || 0) - cart.total()) : undefined,
          itemsFallback: cart.items.map(i => ({ name: i.name, qty: i.quantity, price: i.price, total: i.price * i.quantity })),
          vatNumber: storeSettings?.company_vat_number,
          currencyCode: activeCurrency?.code ?? 'USD',
          currencyRate: activeCurrency?.exchange_rate ?? 1,
          posNumber: String(user?.branch?.id ?? 1),
        }),
        resolveReceiptPrintMode(hw.printerMode)
      ).catch((err: any) => toast.error(err?.message ?? 'Receipt printing failed'));

      broadcastCart({ type: 'thankyou', storeName, currency });
      setTimeout(() => broadcastCart({ type: 'idle', storeName, currency }), 4000);

      cart.clearCart();
      setCashTendered('');
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setTimeout(() => codeRef.current?.focus(), 80);
    },
  });

  // ── Hold mutation ────────────────────────────────────────────────────────────
  const holdMutation = useMutation({
    mutationFn: (payload: object) => offlineMutate(() => salesApi.hold(payload), 'sales', 'hold', payload as Record<string, unknown>),
    onSuccess: (_result) => {
      toast.success('Order held!');
      cart.clearCart();
      setTimeout(() => codeRef.current?.focus(), 80);
    },
  });

  const buildSalePayload = () => ({
    branch_id:      branchId,
    warehouse_id:   1,
    customer_id:    null,
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
    if (payMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) < cart.total())) {
      toast.error('Enter cash amount — must cover the total');
      tenderedRef.current?.focus();
      return;
    }

    if (!isOnline) {
      toast.error('Local server is starting up — wait a moment and try again');
      return;
    }

    saleMutation.mutate(buildSalePayload());
  };

  const handleHoldOrder = () => {
    if (cart.items.length === 0) return;
    holdMutation.mutate({
      branch_id: branchId,
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
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA';
      const { handleProcessSale, handleHoldOrder, saleMutation, holdMutation, cart } = kbRef.current;

      if (e.key === 'F9') { e.preventDefault(); if (!saleMutation.isPending) handleProcessSale(); }
      if (e.key === 'F8') { e.preventDefault(); if (!holdMutation.isPending) handleHoldOrder(); }
      if (e.key === 'F5') { e.preventDefault(); cart.clearCart(); setCashTendered(''); setTimeout(() => codeRef.current?.focus(), 40); }
      if (e.key === 'F1') { e.preventDefault(); setPayMethod('cash'); }
      if (e.key === 'F2') { e.preventDefault(); setPayMethod('card'); }
      if (e.key === 'F3') { e.preventDefault(); setPayMethod('mobile_money'); }
      if (e.key === 'Escape' && !inInput) { setMatchedProducts([]); codeRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Derived values ───────────────────────────────────────────────────────────
  const total      = cart.total();
  const tendered   = parseFloat(cashTendered) || 0;
  const change     = payMethod === 'cash' && tendered > total ? tendered - total : 0;
  const canProcess = cart.items.length > 0 && !saleMutation.isPending &&
    (payMethod !== 'cash' || tendered >= total);

  const fmtTime = (d: Date) => d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDate = (d: Date) => d.toLocaleDateString('en-ZA');
  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="-m-6 flex flex-col bg-gray-50 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>

      {/* ── Header card ────────────────────────────────────────────────────── */}
      <div className="mx-4 mt-4 mb-3 flex-shrink-0">
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <span className="text-blue-600 font-bold text-base">{storeName}</span>
            <span className="text-gray-400 text-sm">Cashier: <span className="font-semibold text-gray-600">{user?.name}</span></span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {!isOnline ? (
              <span className="flex items-center gap-1.5 text-amber-500 font-semibold text-xs">
                Server starting...
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-blue-500 font-medium text-sm">
                <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span> Ready
              </span>
            )}
            <span className="text-gray-400">{fmtDate(currentTime)}</span>
            <span className="text-gray-900 font-bold tabular-nums">{fmtTime(currentTime)}</span>
          </div>
        </div>
      </div>

      {/* ── Scan / PLU card ────────────────────────────────────────────────── */}
      <div className="mx-4 mb-3 flex-shrink-0">
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm px-5 py-3">
          <form onSubmit={handleCodeSubmit} className="flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">
              Scan / PLU
            </span>
            <div className="relative flex-1">
              <input
                ref={codeRef}
                value={codeInput}
                onChange={e => { setCodeInput(e.target.value); setMatchedProducts([]); }}
                placeholder="Scan barcode or type product code / name..."
                className="w-full border-2 border-blue-500 focus:border-blue-600 rounded-md px-4 py-2.5 text-sm bg-blue-50 focus:bg-white focus:outline-none transition-colors pr-10"
                autoComplete="off"
              />
              {/* Touch keyboard button */}
              <button
                type="button"
                onClick={() => setShowSearchModal(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded-lg touch-manipulation"
                title="Open on-screen keyboard"
              >
                <Keyboard size={15} />
              </button>
              {matchedProducts.length > 1 && (
                <div className="absolute top-full left-0 right-0 z-50 bg-white rounded-md border border-gray-200 shadow-xl max-h-72 overflow-y-auto mt-1">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-400 font-semibold uppercase tracking-wider">
                    {matchedProducts.length} products found
                  </div>
                  {matchedProducts.map(p => (
                    <button key={p.id} type="button" onClick={() => addProduct(p)}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-gray-50 flex items-center justify-between text-sm">
                      <span>
                        <span className="text-gray-400 mr-3 text-xs">{p.sku}</span>
                        <span className="font-semibold text-gray-900">{p.name}</span>
                      </span>
                      <span className="text-blue-700 font-bold">{formatCurrency(parseFloat(p.selling_price))}</span>
                    </button>
                  ))}
                  <button type="button" onClick={() => { setMatchedProducts([]); codeRef.current?.focus(); }}
                    className="w-full text-center py-2 text-xs text-gray-400 hover:text-gray-600">
                    ESC — cancel
                  </button>
                </div>
              )}
            </div>
            <button type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-md font-semibold text-sm transition-colors flex-shrink-0 shadow-sm shadow-blue-100">
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
              <div className="flex flex-col items-center justify-center h-full text-gray-300 select-none gap-3">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-30">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
                <p className="text-xs font-semibold text-gray-300 uppercase tracking-widest">Scan a product to start</p>
              </div>
            ) : (
              cart.items.map((item, idx) => {
                const lineTotal = (item.price - item.discount) * item.quantity;
                return (
                  <div key={item.product_id}
                    className={`flex items-center px-4 py-3.5 border-b border-gray-50 text-base ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                    <div className="w-36 flex items-center justify-center gap-2 flex-shrink-0">
                      <button type="button"
                        onClick={() => cart.updateQty(item.product_id, item.quantity - 1)}
                        className="w-10 h-10 rounded bg-gray-100 hover:bg-red-100 hover:text-red-600 text-gray-500 flex items-center justify-center transition-colors touch-manipulation">
                        <Minus size={16} />
                      </button>
                      <span className="w-10 text-center font-bold text-gray-900 tabular-nums">{item.quantity}</span>
                      <button type="button"
                        onClick={() => cart.updateQty(item.product_id, item.quantity + 1)}
                        className="w-10 h-10 rounded bg-gray-100 hover:bg-blue-100 hover:text-blue-600 text-gray-500 flex items-center justify-center transition-colors touch-manipulation">
                        <Plus size={16} />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 truncate block">{item.name}</span>
                    </div>
                    <span className="w-28 text-right pr-3 font-bold text-gray-900 tabular-nums font-mono">
                      {formatCurrency(lineTotal)}
                    </span>
                    <button type="button"
                      onClick={() => cart.removeItem(item.product_id)}
                      title="Remove item"
                      className="w-10 h-10 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors touch-manipulation">
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

        {/* Right: payment column */}
        <div className="w-[33.333%] min-w-[380px] xl:min-w-[440px] 2xl:min-w-[500px] max-w-[580px] flex flex-col gap-3 flex-shrink-0 overflow-y-auto">

          {/* Total box */}
          <div className="bg-blue-600 rounded-lg shadow-lg shadow-blue-200 px-6 py-5 flex items-center justify-between flex-shrink-0">
            <span className="text-white/70 font-semibold text-base tracking-wide">TOTAL</span>
            <span className="text-white font-bold text-3xl tabular-nums font-mono">{formatCurrency(total)}</span>
          </div>

          {/* Payment method card */}
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 flex-shrink-0">
            <p className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Payment Method</p>
            <div className="grid grid-cols-3 gap-3">
              {PAY_METHODS.map(({ value, label, key, activeClass }) => (
                <button key={value} type="button"
                  onClick={() => setPayMethod(value)}
                  className={`flex flex-col items-center py-5 rounded-md border-2 font-bold text-sm transition-all touch-manipulation
                    ${payMethod === value
                      ? activeClass
                      : 'border-gray-200 text-gray-500 bg-white hover:border-blue-200 hover:bg-blue-50'
                    }`}
                >
                  <span className="text-sm opacity-50 mb-1">{key}</span>
                  {label}
                </button>
              ))}
            </div>

            {payMethod === 'cash' && (
              <div className="mt-5 space-y-3">
                <NumericKeypad
                  value={cashTendered}
                  onChange={setCashTendered}
                  onConfirm={handleProcessSale}
                  label="Cash Tendered"
                  confirmLabel={change > 0 ? `✓  Change: ${formatCurrency(change)}` : '✓ Process Sale'}
                  confirmCls={canProcess ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' : 'bg-gray-200 text-gray-400 border-gray-200'}
                  disabled={!canProcess && cart.items.length === 0}
                />
              </div>
            )}
          </div>

          {/* Action buttons card */}
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-3 flex-shrink-0">
            <button type="button"
              onClick={handleProcessSale}
              disabled={!canProcess}
              className="w-full py-5 rounded-md font-bold text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm bg-blue-600 hover:bg-blue-700 text-white shadow-blue-100 touch-manipulation"
            >
              {saleMutation.isPending
                ? <span className="flex items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin" /> Processing...
                  </span>
                : <span>F9 — Process Order {formatCurrency(total)}</span>
              }
            </button>

            <div className="grid grid-cols-3 gap-2">
              <button type="button"
                onClick={() => { cart.clearCart(); setCashTendered(''); setTimeout(() => codeRef.current?.focus(), 40); }}
                disabled={cart.items.length === 0}
                className="py-4 rounded-md border-2 border-red-200 text-red-500 hover:bg-red-50 font-semibold text-sm uppercase disabled:opacity-30 transition-colors touch-manipulation">
                F5 Clear
              </button>
              <button type="button"
                onClick={handleHoldOrder}
                disabled={cart.items.length === 0 || holdMutation.isPending}
                className="py-4 rounded-md border-2 border-orange-200 text-orange-500 hover:bg-orange-50 font-semibold text-sm uppercase disabled:opacity-30 transition-colors touch-manipulation">
                {holdMutation.isPending ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'F8 Hold'}
              </button>
              <button type="button"
                onClick={() => window.location.reload()}
                className="py-4 rounded-md border-2 border-gray-200 text-gray-400 hover:bg-gray-50 font-semibold text-sm uppercase transition-colors touch-manipulation flex items-center justify-center gap-1"
                title="Refresh if frozen">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {/* Restaurant: live orders panel */}
          {isRestaurant && (
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
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
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
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
          )}

        </div>
      </div>
    </div>

    {/* Touch keyboard search modal */}
    {showSearchModal && (
      <SearchModal
        value={codeInput}
        onChange={(v) => { setCodeInput(v); setMatchedProducts([]); }}
        onClose={() => {
          setShowSearchModal(false);
          // Auto-submit if search has content
          if (codeInput.trim()) {
            const ql = codeInput.trim().toLowerCase();
            const matches = allProducts.filter(p => p.name.toLowerCase().includes(ql) || (p.sku ?? '').toLowerCase().includes(ql));
            if (matches.length === 1) { addProduct(matches[0]); }
            else if (matches.length > 1) { setMatchedProducts(matches.slice(0, 8)); }
            else if (matches.length === 0 && codeInput.trim()) { toast.error(`"${codeInput.trim()}" not found`); }
          }
          setTimeout(() => codeRef.current?.focus(), 80);
        }}
        placeholder="Scan barcode or type product name..."
        label="Product Search"
      />
    )}
    </>
  );
}
