import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem {
  product_id: number;
  variant_id?: number;
  name: string;
  sku: string;
  price: number;
  cost: number;
  tax_rate: number;
  quantity: number;
  discount: number;
}

export interface HeldOrder {
  id: string;
  label: string;
  items: CartItem[];
  customerId: number | null;
  customerName: string;
  discount: number;
  note: string;
  heldAt: string;
  tableNumber: string;
}

export const TABLES = ['Walk-in', ...Array.from({ length: 20 }, (_, i) => `T-${i + 1}`)];

function randomTicketNum(): string {
  return `#${Math.floor(Math.random() * 9000) + 1000}`;
}

interface CartState {
  items: CartItem[];
  customerId: number | null;
  customerName: string;
  discount: number;
  note: string;
  heldOrders: HeldOrder[];
  // Current-order attributes — shared globally so both the POS page and the
  // app shell (top nav) can display/edit them without prop drilling.
  tableNumber: string;
  covers: number;
  orderType: 'sit_in' | 'takeaway' | 'delivery';
  ticketNum: string;
  // Payment-form state — also shared so "New Ticket" from the top nav can
  // reset it, even though the form itself renders inside POSPage.
  paymentMethod: string;
  cashTendered: string;
  isSplitPayment: boolean;
  splitPayments: Array<{ method: string; amount: string }>;
  addItem: (item: Omit<CartItem, 'quantity' | 'discount'>) => void;
  updateQty: (product_id: number, qty: number) => void;
  updateDiscount: (product_id: number, discount: number) => void;
  removeItem: (product_id: number) => void;
  setCustomer: (id: number | null, name: string) => void;
  setDiscount: (d: number) => void;
  setNote: (n: string) => void;
  setTableNumber: (t: string) => void;
  setCovers: (c: number) => void;
  setOrderType: (t: 'sit_in' | 'takeaway' | 'delivery') => void;
  cycleOrderType: () => void;
  setPaymentMethod: (m: string) => void;
  setCashTendered: (v: string) => void;
  setIsSplitPayment: (v: boolean) => void;
  setSplitPayments: (v: Array<{ method: string; amount: string }> | ((prev: Array<{ method: string; amount: string }>) => Array<{ method: string; amount: string }>)) => void;
  clearCart: () => void;
  newTicket: () => void;
  holdCurrentCart: (label?: string) => string;
  restoreHeldOrder: (id: string) => void;
  removeHeldOrder: (id: string) => void;
  subtotal: () => number;
  taxTotal: () => number;
  total: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      customerId: null,
      customerName: '',
      discount: 0,
      note: '',
      heldOrders: [],
      tableNumber: 'Walk-in',
      covers: 1,
      orderType: 'sit_in',
      ticketNum: randomTicketNum(),
      paymentMethod: 'cash',
      cashTendered: '',
      isSplitPayment: false,
      splitPayments: [],
      addItem: (item) => {
        const existing = get().items.find((i) => i.product_id === item.product_id);
        if (existing) {
          set({ items: get().items.map((i) => i.product_id === item.product_id ? { ...i, quantity: i.quantity + 1 } : i) });
        } else {
          set({ items: [...get().items, { ...item, quantity: 1, discount: 0 }] });
        }
      },
      updateQty: (id, qty) => set({ items: qty <= 0 ? get().items.filter((i) => i.product_id !== id) : get().items.map((i) => i.product_id === id ? { ...i, quantity: qty } : i) }),
      updateDiscount: (id, discount) => set({ items: get().items.map((i) => i.product_id === id ? { ...i, discount } : i) }),
      removeItem: (id) => set({ items: get().items.filter((i) => i.product_id !== id) }),
      setCustomer: (id, name) => set({ customerId: id, customerName: name }),
      setDiscount: (d) => set({ discount: d }),
      setNote: (n) => set({ note: n }),
      setTableNumber: (t) => set({ tableNumber: t }),
      setCovers: (c) => set({ covers: c }),
      setOrderType: (t) => set({ orderType: t }),
      cycleOrderType: () => {
        const order: Array<'sit_in' | 'takeaway' | 'delivery'> = ['sit_in', 'takeaway', 'delivery'];
        set({ orderType: order[(order.indexOf(get().orderType) + 1) % order.length] });
      },
      setPaymentMethod: (m) => set({ paymentMethod: m }),
      setCashTendered: (v) => set({ cashTendered: v }),
      setIsSplitPayment: (v) => set({ isSplitPayment: v }),
      setSplitPayments: (v) => set({ splitPayments: typeof v === 'function' ? v(get().splitPayments) : v }),
      clearCart: () => set({ items: [], customerId: null, customerName: '', discount: 0, note: '' }),
      newTicket: () => set({
        items: [], customerId: null, customerName: '', discount: 0, note: '',
        tableNumber: 'Walk-in', covers: 1, orderType: 'sit_in', ticketNum: randomTicketNum(),
        paymentMethod: 'cash', cashTendered: '', isSplitPayment: false, splitPayments: [],
      }),
      holdCurrentCart: (label?: string) => {
        const { items, customerId, customerName, discount, note, tableNumber } = get();
        const id = `hold-${Date.now()}`;
        const holdLabel = label || (customerName ? customerName : `Order ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        const held: HeldOrder = { id, label: holdLabel, items: [...items], customerId, customerName, discount, note, heldAt: new Date().toISOString(), tableNumber };
        set({ heldOrders: [...get().heldOrders, held], items: [], customerId: null, customerName: '', discount: 0, note: '', tableNumber: 'Walk-in' });
        return id;
      },
      restoreHeldOrder: (id: string) => {
        const held = get().heldOrders.find((h) => h.id === id);
        if (!held) return;
        set({
          items: held.items,
          customerId: held.customerId,
          customerName: held.customerName,
          discount: held.discount,
          note: held.note,
          tableNumber: held.tableNumber || 'Walk-in',
          heldOrders: get().heldOrders.filter((h) => h.id !== id),
        });
      },
      removeHeldOrder: (id: string) => set({ heldOrders: get().heldOrders.filter((h) => h.id !== id) }),
      // Prices are VAT-inclusive — tax_rate is already baked into i.price, so
      // taxTotal below extracts the VAT portion out of subtotal rather than
      // adding it on top (must mirror SaleController::store's calculation).
      subtotal: () => get().items.reduce((sum, i) => sum + i.price * i.quantity - i.discount * i.quantity, 0),
      taxTotal: () => get().items.reduce((sum, i) => {
        const taxable = (i.price - i.discount) * i.quantity;
        return sum + (taxable - taxable / (1 + i.tax_rate / 100));
      }, 0),
      total: () => get().subtotal() - get().discount,
    }),
    {
      name: 'cart-storage',
      partialize: (s) => ({ heldOrders: s.heldOrders }),
    }
  )
);
