import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, customersApi, salesApi } from '../api';
import type { CartItem } from '../stores/cartStore';
import { useCartStore } from '../stores/cartStore';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import {
  Search, Plus, Minus, Trash2, User, Loader2, CreditCard, Banknote, Smartphone,
  X, ShoppingCart, TableProperties, UtensilsCrossed
} from 'lucide-react';
import toast from 'react-hot-toast';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'mobile_money', label: 'Mobile', icon: Smartphone },
];

const TABLES = ['Walk-in', ...Array.from({ length: 20 }, (_, i) => `T-${i + 1}`)];

const CATEGORY_EMOJI: Record<string, string> = {
  // Bottle store
  'Spirits': '🥃', 'Wine': '🍷', 'Beer & Cider': '🍺', 'Mixers & Soft Drinks': '🥤',
  'Water': '💧', 'RTD (Ready to Drink)': '🍹', 'Non-Alcoholic': '🫧',
  'Tobacco': '🚬', 'Accessories': '🔧', 'Snacks & Food': '🍫',
  // Butcher
  'Fresh Meat': '🥩', 'Poultry': '🍗', 'Seafood': '🐟', 'Deli & Cold Cuts': '🥓', 'Frozen Meat': '🧊',
  // Supermarket
  'Dairy & Eggs': '🥛', 'Bread & Bakery': '🍞', 'Fruit & Vegetables': '🥦',
  'Canned Goods': '🥫', 'Dry Goods & Cereals': '🌾', 'Condiments & Sauces': '🫙',
  'Cleaning & Household': '🧹', 'Personal Care': '🧴', 'Confectionery': '🍬',
  'Frozen Foods': '❄️', 'Baby Products': '🍼', 'Pet Food': '🐾',
};

function getCategoryEmoji(cat: string) {
  return CATEGORY_EMOJI[cat] ?? '📦';
}

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
  const [customerSearch, setCustomerSearch] = useState('');
  const [ticketNum] = useState(() => `#${Math.floor(Math.random() * 9000) + 1000}`);
  const searchRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const cart = useCartStore();
  const { user } = useAuthStore();
  const { format: formatCurrency } = useCurrencyStore();

  const branchId = user?.branch?.id ?? 1;

  useEffect(() => { searchRef.current?.focus(); }, []);

  // Keyboard shortcuts — keep latest handlers in a ref to avoid stale closures
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

  // Load all products for grid display
  const { data: allProductsData, isLoading: productsLoading } = useQuery({
    queryKey: ['pos-products'],
    queryFn: () => productsApi.list({ per_page: 200, is_active: 1 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
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

  // Filter products
  const filteredProducts = allProducts.filter((p: any) => {
    const matchCat = activeCategory === 'All' || p.category?.name === activeCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? '').toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const saleMutation = useMutation({
    mutationFn: (payload: object) => salesApi.create(payload),
    onSuccess: (res) => {
      const sale = res.data?.data;
      toast.success(`Sale ${sale?.reference} completed!`);
      cart.clearCart();
      setCashTendered('');
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
    toast.success(`Added ${product.name}`, { duration: 800, icon: '✓' });
  };

  const handleProcessSale = () => {
    if (cart.items.length === 0) return;
    if (paymentMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) <= 0)) {
      toast.error('Please enter the cash amount received before processing');
      return;
    }
    saleMutation.mutate({
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
      payments: [{ method: paymentMethod, amount: cart.total() }],
      discount_value: cart.discount,
      notes: cart.note,
    });
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
    <div className="-m-6 h-[calc(100vh-64px)] flex bg-slate-50">
      {/* Left: product area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search + Category */}
        <div className="bg-white border-b border-gray-100 px-5 pt-4 pb-3 flex-shrink-0">
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by name or SKU..."
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          {/* Category pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {categories.map((cat) => (
              <button
                type="button"
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  activeCategory === cat
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat !== 'All' && <span className="mr-1">{getCategoryEmoji(cat)}</span>}
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-4">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {filteredProducts.map((product: any) => {
                const stock = product.total_stock ?? 0;
                const outOfStock = stock <= 0;
                return (
                  <button
                    type="button"
                    key={product.id}
                    onClick={() => !outOfStock && handleAddProduct(product)}
                    disabled={outOfStock}
                    aria-label={`Add ${product.name} to cart — ${formatCurrency(parseFloat(product.selling_price))}${outOfStock ? ' (out of stock)' : ''}`}
                    className={`text-left p-4 rounded-2xl bg-white border border-gray-100 shadow-sm transition-all group
                      ${outOfStock ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5'}`}
                  >
                    <div className="text-3xl mb-2 text-center">{getCategoryEmoji(product.category?.name ?? '')}</div>
                    <p className="text-sm font-semibold text-gray-900 truncate text-center mb-1">{product.name}</p>
                    <p className="text-base font-bold text-blue-600 text-center mb-2">{formatCurrency(parseFloat(product.selling_price))}</p>
                    <div className="flex items-center justify-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        stock > 10 ? 'bg-emerald-100 text-emerald-700' :
                        stock > 0 ? 'bg-orange-100 text-orange-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {outOfStock ? 'Out of stock' : `${stock} left`}
                      </span>
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
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl z-10 mt-1 overflow-hidden">
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
          <div className="grid grid-cols-3 gap-2 mb-3">
            {PAYMENT_METHODS.map(({ value, label, icon: Icon }, idx) => (
              <button
                type="button"
                key={value}
                onClick={() => setPaymentMethod(value)}
                aria-label={`Pay by ${label} (${idx + 1})`}
                aria-pressed={paymentMethod === value}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-semibold border-2 transition-all ${
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
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {change > 0 && (
                <div className="mt-1.5 bg-emerald-50 rounded-lg px-3 py-1.5 flex justify-between text-sm">
                  <span className="text-gray-500">Change:</span>
                  <span className="font-bold text-emerald-600">{formatCurrency(change)}</span>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleProcessSale}
            disabled={cart.items.length === 0 || saleMutation.isPending || (paymentMethod === 'cash' && (!cashTendered || parseFloat(cashTendered) <= 0))}
            aria-label="Process sale (F9)"
            aria-keyshortcuts="F9"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-blue-100 mb-2"
          >
            {saleMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
            {saleMutation.isPending ? 'Processing...' : `Process Sale — ${formatCurrency(total)}`}
            {!saleMutation.isPending && <span className="ml-auto text-blue-200 text-xs font-normal">F9</span>}
          </button>

          <button
            type="button"
            onClick={handleHoldOrder}
            disabled={cart.items.length === 0 || holdMutation.isPending}
            aria-label="Hold order (F8)"
            aria-keyshortcuts="F8"
            className="w-full border border-gray-200 hover:border-blue-300 text-gray-600 hover:text-blue-600 font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {holdMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <UtensilsCrossed size={14} />}
            Hold Order
            {!holdMutation.isPending && <span className="ml-auto text-gray-300 text-xs font-normal">F8</span>}
          </button>

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
  );
}
