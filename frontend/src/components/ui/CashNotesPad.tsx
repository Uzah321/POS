/**
 * CashNotesPad — quick-tap currency note buttons for cash tendering.
 * Replaces free-form digit entry: cashier taps real note denominations
 * (e.g. $1/$5/$10/$20/$50/$100 or R10/R20/R50/R100/R200) and the amounts
 * accumulate into the tendered total.
 */
import { useState } from 'react';
import NumericKeypad from './NumericKeypad';

export interface CashNotesPadProps {
  value: string;
  onChange: (v: string) => void;
  onConfirm?: () => void;
  label?: string;
  confirmLabel?: string;
  confirmCls?: string;
  disabled?: boolean;
  currencyCode?: string;
  totalDue?: number;
  /** 'compact' (default) fits a tight panel (Advanced POS, next to the orders list).
   *  'large' is for touchscreens with more room to spare (Cashier Register). */
  size?: 'compact' | 'large';
}

const NOTE_DENOMINATIONS: Record<string, number[]> = {
  USD: [1, 5, 10, 20, 50, 100],
  ZAR: [10, 20, 50, 100, 200],
};

const BTN_BASE_LARGE =
  'flex items-center justify-center rounded-xl font-bold select-none transition-all ' +
  'active:scale-95 active:brightness-90 touch-manipulation cursor-pointer disabled:opacity-50';
// Compact mode (Advanced POS) matches the flat, single-border tile style used
// for products/categories/payment-method buttons elsewhere on that screen.
const BTN_BASE_COMPACT =
  'flex items-center justify-center rounded font-bold select-none transition-colors ' +
  'touch-manipulation cursor-pointer disabled:opacity-50';

export default function CashNotesPad({
  value,
  onChange,
  onConfirm,
  label,
  confirmLabel = '✓ Confirm',
  confirmCls = 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600',
  disabled = false,
  currencyCode = 'USD',
  totalDue,
  size = 'compact',
}: CashNotesPadProps) {
  const [history, setHistory] = useState<number[]>([]);
  const [showKeypad, setShowKeypad] = useState(false);
  const notes = NOTE_DENOMINATIONS[currencyCode] ?? NOTE_DENOMINATIONS.USD;
  const large = size === 'large';
  const BTN_BASE = large ? BTN_BASE_LARGE : BTN_BASE_COMPACT;

  const addNote = (n: number) => {
    if (disabled) return;
    const current = parseFloat(value) || 0;
    onChange(String(+(current + n).toFixed(2)));
    setHistory((h) => [...h, n]);
  };
  const undo = () => {
    if (disabled || history.length === 0) return;
    const last = history[history.length - 1];
    const current = parseFloat(value) || 0;
    onChange(String(Math.max(0, +(current - last).toFixed(2))));
    setHistory((h) => h.slice(0, -1));
  };
  const clear = () => {
    if (disabled) return;
    onChange('');
    setHistory([]);
  };
  const setExact = () => {
    if (disabled || totalDue === undefined) return;
    onChange(String(+totalDue.toFixed(2)));
    setHistory([]);
  };

  return (
    <div className="select-none">
      {/* Label + value share one row to save vertical space. Tapping it opens a
          numeric keypad so the cashier can type any exact amount (e.g. 13, 17)
          instead of being limited to the fixed note denominations below. */}
      <button
        type="button"
        onClick={() => { if (!disabled) setShowKeypad(true); }}
        disabled={disabled}
        title="Tap to type an exact amount"
        className={`w-full flex items-center justify-between px-3 touch-manipulation transition-colors ${large ? 'mb-2 min-h-[44px] rounded-lg' : 'mb-1 min-h-[34px] rounded'} ${
          large
            ? (value ? 'bg-blue-50 border-2 border-blue-300' : 'bg-gray-50 border-2 border-gray-200')
            : (value ? 'bg-blue-50 border border-blue-300' : 'bg-white border border-gray-200')
        } ${disabled ? '' : 'active:brightness-95'}`}
      >
        {label && <span className={`font-semibold text-gray-500 uppercase tracking-wide ${large ? 'text-xs' : 'text-[10px]'}`}>{label}</span>}
        <span className={`font-black tabular-nums font-mono tracking-tight ml-auto ${large ? 'text-3xl' : 'text-xl'} ${value ? 'text-blue-700' : 'text-gray-300'}`}>
          {value || '0.00'}
        </span>
      </button>

      {showKeypad && (
        <NumericKeypad
          modal
          value={value}
          onChange={onChange}
          onClose={() => setShowKeypad(false)}
          onConfirm={() => setShowKeypad(false)}
          label={label}
          confirmLabel="✓ Done"
        />
      )}

      {/* Note buttons — single row (not a 3-col grid) so the pad takes half the vertical space */}
      <div className={`grid gap-1 ${large ? 'mb-2' : 'mb-0.5'} ${notes.length >= 6 ? 'grid-cols-6' : 'grid-cols-5'}`}>
        {notes.map((n) => (
          <button
            key={n}
            type="button"
            onPointerDown={(e) => { e.preventDefault(); addNote(n); }}
            disabled={disabled}
            className={`${BTN_BASE} ${large ? 'bg-emerald-50 border-2 border-emerald-200 text-emerald-800 hover:bg-emerald-100' : 'bg-white border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'} ${large ? 'text-lg h-16' : 'text-sm h-9'}`}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Exact / Undo / Clear */}
      <div className={`grid grid-cols-3 gap-1 ${large ? 'mb-2' : 'mb-0.5'}`}>
        <button
          type="button"
          onPointerDown={(e) => { e.preventDefault(); setExact(); }}
          disabled={disabled || totalDue === undefined}
          className={`${BTN_BASE} ${large ? 'bg-blue-50 border-2 border-blue-200 text-blue-700 hover:bg-blue-100' : 'bg-white border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'} ${large ? 'text-sm h-12' : 'text-xs h-7'}`}
        >
          Exact
        </button>
        <button
          type="button"
          onPointerDown={(e) => { e.preventDefault(); undo(); }}
          disabled={disabled || history.length === 0}
          className={`${BTN_BASE} ${large ? 'bg-gray-100 border-2 border-gray-200 text-gray-700 hover:bg-gray-200' : 'bg-white border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'} ${large ? 'text-sm h-12' : 'text-xs h-7'}`}
        >
          Undo
        </button>
        <button
          type="button"
          onPointerDown={(e) => { e.preventDefault(); clear(); }}
          disabled={disabled}
          className={`${BTN_BASE} ${large ? 'bg-red-50 border-2 border-red-200 text-red-600 hover:bg-red-100' : 'bg-white border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'} ${large ? 'text-sm h-12' : 'text-xs h-7'}`}
        >
          Clear
        </button>
      </div>

      {/* Confirm */}
      <button
        type="button"
        onPointerDown={(e) => { e.preventDefault(); if (!disabled && onConfirm) onConfirm(); }}
        disabled={disabled}
        className={`w-full ${BTN_BASE} ${large ? 'border-2' : 'border'} font-black ${large ? 'text-lg h-16' : 'text-sm h-12'} ${confirmCls}`}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
