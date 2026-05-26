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

interface CurrencyState {
  currencies: Currency[];
  activeCurrency: Currency | null;
  setCurrencies: (currencies: Currency[]) => void;
  setActiveCurrency: (currency: Currency) => void;
  /** Convert an amount from USD (base) to the active currency */
  format: (usdAmount: number) => string;
  /** Convert from active currency back to USD */
  toUsd: (amount: number) => number;
}

const USD_DEFAULT: Currency = {
  id: 1, code: 'USD', name: 'US Dollar', symbol: '$', exchange_rate: 1, is_default: true, is_active: true,
};

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set, get) => ({
      currencies: [USD_DEFAULT],
      activeCurrency: USD_DEFAULT,

      setCurrencies: (currencies) => {
        set({ currencies });
        // If stored active currency is no longer in list, reset to default
        const active = get().activeCurrency;
        if (active && !currencies.find((c) => c.code === active.code)) {
          const def = currencies.find((c) => c.is_default) ?? currencies[0] ?? USD_DEFAULT;
          set({ activeCurrency: def });
        }
      },

      setActiveCurrency: (currency) => set({ activeCurrency: currency }),

      format: (usdAmount: number) => {
        const cur = get().activeCurrency ?? USD_DEFAULT;
        const converted = usdAmount * cur.exchange_rate;
        return `${cur.symbol}${converted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      },

      toUsd: (amount: number) => {
        const cur = get().activeCurrency ?? USD_DEFAULT;
        return cur.exchange_rate === 0 ? amount : amount / cur.exchange_rate;
      },
    }),
    { name: 'currency-storage', partialize: (s) => ({ activeCurrency: s.activeCurrency }) }
  )
);
