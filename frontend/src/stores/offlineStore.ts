import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PendingSale {
  localId: string;
  payload: Record<string, unknown>;
  queuedAt: string;
  attempts: number;
  lastError?: string;
  receiptMeta: {
    reference: string;
    items: Array<{ name: string; qty: number; price: number; total: number }>;
    subtotal: number;
    tax: number;
    discount: number;
    total: number;
    paymentMethod: string;
    amountTendered?: number;
    change?: number;
  };
}

interface OfflineState {
  isOnline: boolean;
  queue: PendingSale[];
  isSyncing: boolean;
  setOnline: (v: boolean) => void;
  enqueue: (payload: Record<string, unknown>, receiptMeta: PendingSale['receiptMeta']) => string;
  dequeue: (localId: string) => void;
  markAttempt: (localId: string, error?: string) => void;
  setSyncing: (v: boolean) => void;
}

let _seq = 0;

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      queue: [],
      isSyncing: false,

      setOnline: (v) => set({ isOnline: v }),

      enqueue: (payload, receiptMeta) => {
        const localId = `OFF-${Date.now()}-${++_seq}`;
        set({ queue: [...get().queue, { localId, payload, queuedAt: new Date().toISOString(), attempts: 0, receiptMeta }] });
        return localId;
      },

      dequeue: (localId) => set({ queue: get().queue.filter((s) => s.localId !== localId) }),

      markAttempt: (localId, error) =>
        set({
          queue: get().queue.map((s) =>
            s.localId === localId ? { ...s, attempts: s.attempts + 1, lastError: error } : s
          ),
        }),

      setSyncing: (v) => set({ isSyncing: v }),
    }),
    { name: 'pos-offline-queue' }
  )
);
