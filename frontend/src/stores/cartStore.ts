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
}

interface CartState {
  items: CartItem[];
  customerId: number | null;
  customerName: string;
  discount: number;
  note: string;
  heldOrders: HeldOrder[];
  addItem: (item: Omit<CartItem, 'quantity' | 'discount'>) => void;
  updateQty: (product_id: number, qty: number) => void;
  updateDiscount: (product_id: number, discount: number) => void;
  removeItem: (product_id: number) => void;
  setCustomer: (id: number | null, name: string) => void;
  setDiscount: (d: number) => void;
  setNote: (n: string) => void;
  clearCart: () => void;
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
      clearCart: () => set({ items: [], customerId: null, customerName: '', discount: 0, note: '' }),
      holdCurrentCart: (label?: string) => {
        const { items, customerId, customerName, discount, note } = get();
        const id = `hold-${Date.now()}`;
        const holdLabel = label || (customerName ? customerName : `Order ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        const held: HeldOrder = { id, label: holdLabel, items: [...items], customerId, customerName, discount, note, heldAt: new Date().toISOString() };
        set({ heldOrders: [...get().heldOrders, held], items: [], customerId: null, customerName: '', discount: 0, note: '' });
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
          heldOrders: get().heldOrders.filter((h) => h.id !== id),
        });
      },
      removeHeldOrder: (id: string) => set({ heldOrders: get().heldOrders.filter((h) => h.id !== id) }),
      subtotal: () => get().items.reduce((sum, i) => sum + i.price * i.quantity - i.discount * i.quantity, 0),
      taxTotal: () => get().items.reduce((sum, i) => sum + ((i.price - i.discount) * i.quantity * i.tax_rate) / 100, 0),
      total: () => {
        const sub = get().subtotal();
        const tax = get().taxTotal();
        return sub + tax - get().discount;
      },
    }),
    {
      name: 'cart-storage',
      partialize: (s) => ({ heldOrders: s.heldOrders }),
    }
  )
);
