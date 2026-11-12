import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Currency {
  id: number;
  code: string;
  name: string;
  symbol: string;
  exchange_rate: number;
  is_default: boolean;
  is_active: boolean;
}

/** The currency every amount is stored in; each rate is units of a currency per 1 of this. */
export const BASE_CURRENCY = 'USD';

interface CurrencyState {
  currencies: Currency[];
  activeCurrency: Currency | null;
  /** The shop's default currency when this user last took it up (see setCurrencies). */
  defaultCode: string | null;
  /**
   * The shop's currencies, from the server. Keeps the active currency's rate
   * and symbol current, and moves everyone onto the shop's default the first
   * time and whenever an admin changes the default (anyone can still pick
   * another for themselves afterwards). `applyToActive: false` (a sale in
   * progress) only refreshes the list, so the sale finishes at the rate it
   * started with; the next refresh catches up.
   */
  setCurrencies: (currencies: Currency[], opts?: { applyToActive?: boolean }) => void;
  setActiveCurrency: (currency: Currency) => void;
  /** Convert an amount from USD (base) to the active currency */
  format: (usdAmount: number) => string;
  /** Like format, but keeps up to 6 decimals — for a unit cost such as $0.0012 per gram, which format shows as $0.00 */
  formatCost: (usdAmount: number) => string;
  /** Convert from active currency back to USD */
  toUsd: (amount: number) => number;
}

const USD_DEFAULT: Currency = {
  id: 1, code: 'USD', name: 'US Dollar', symbol: '$', exchange_rate: 1, is_default: true, is_active: true,
};

/** Returns a per-user persist key based on the logged-in user id stored in auth-storage */
function getCurrencyStorageKey(): string {
  try {
    const raw = localStorage.getItem('auth-storage');
    const parsed = raw ? JSON.parse(raw) : null;
    const userId = parsed?.state?.user?.id;
    if (userId) return `currency-storage-${userId}`;
  } catch {
    // ignore
  }
  return 'currency-storage';
}

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set, get) => ({
      currencies: [USD_DEFAULT],
      activeCurrency: USD_DEFAULT,
      defaultCode: null,

      setCurrencies: (currencies, opts) => {
        if (!Array.isArray(currencies) || currencies.length === 0) return;
        set({ currencies });
        if (opts?.applyToActive === false) return;

        const usable = currencies.filter((c) => c.is_active !== false);
        const def = usable.find((c) => c.is_default)
          ?? usable.find((c) => c.code === BASE_CURRENCY)
          ?? usable[0]
          ?? USD_DEFAULT;
        const active = get().activeCurrency;
        const current = active ? usable.find((c) => c.code === active.code) : undefined;

        if (get().defaultCode !== def.code || !current) {
          // First sync, the shop's default changed, or this user's currency was
          // removed / switched off: use the shop's default.
          set({ activeCurrency: def, defaultCode: def.code });
        } else {
          // Same currency, with whatever rate / symbol the server has now.
          set({ activeCurrency: current });
        }
      },

      setActiveCurrency: (currency) => set({ activeCurrency: currency }),

      format: (usdAmount: number) => {
        const cur = get().activeCurrency ?? USD_DEFAULT;
        const numeric = typeof usdAmount === 'string' ? parseFloat(usdAmount) : usdAmount;
        const safe = (typeof numeric === 'number' && isFinite(numeric)) ? numeric : 0;
        const converted = safe * cur.exchange_rate;
        // Sign before the symbol: -$3,056.37, not $-3,056.37.
        const sign = Math.round(converted * 100) < 0 ? '-' : '';
        return `${sign}${cur.symbol}${Math.abs(converted).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      },

      formatCost: (usdAmount: number) => {
        const cur = get().activeCurrency ?? USD_DEFAULT;
        const numeric = typeof usdAmount === 'string' ? parseFloat(usdAmount) : usdAmount;
        const converted = (typeof numeric === 'number' && isFinite(numeric) ? numeric : 0) * cur.exchange_rate;
        const sign = converted < 0 ? '-' : '';
        return `${sign}${cur.symbol}${Math.abs(converted).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
      },

      toUsd: (amount: number) => {
        const cur = get().activeCurrency ?? USD_DEFAULT;
        return cur.exchange_rate === 0 ? amount : amount / cur.exchange_rate;
      },
    }),
    {
      name: 'currency-storage',
      partialize: (s) => ({ activeCurrency: s.activeCurrency, defaultCode: s.defaultCode }),
      // Dynamically pick storage key per logged-in user so currencies don't bleed between accounts
      storage: {
        getItem: (name) => {
          const key = getCurrencyStorageKey();
          const raw = localStorage.getItem(key !== 'currency-storage' ? key : name);
          return raw ? JSON.parse(raw) : null;
        },
        setItem: (name, value) => {
          const key = getCurrencyStorageKey();
          localStorage.setItem(key !== 'currency-storage' ? key : name, JSON.stringify(value));
        },
        removeItem: (name) => {
          const key = getCurrencyStorageKey();
          localStorage.removeItem(key !== 'currency-storage' ? key : name);
        },
      },
    }
  )
);
