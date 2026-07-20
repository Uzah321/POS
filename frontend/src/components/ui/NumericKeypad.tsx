/**
 * NumericKeypad — large-button on-screen number pad for touchscreen POS.
 *
 * Two usage modes:
 *  1. Inline  (modal=false): rendered directly in the layout.
 *  2. Modal   (modal=true) : floating overlay anchored to the calling element.
 *
 * Props
 *  value       — current string value being built
 *  onChange    — called every keystroke with the new string
 *  onConfirm   — called when the user taps the confirm (✓) key
 *  onClose     — called when the user dismisses a modal keypad
 *  label       — small label shown above the display (e.g. "Cash Tendered")
 *  allowDecimal— whether the '.' key is enabled (default true)
 *  quickAmounts— list of quick-tap amounts to show above the pad (e.g. [5,10,20,50,100])
 *  confirmLabel— text on the confirm key (default "✓ Confirm")
 *  confirmCls  — extra Tailwind classes for the confirm button
 *  modal       — render as floating overlay (default false)
 */
import { useEffect, useRef } from 'react';
import { Delete, X } from 'lucide-react';

export interface NumericKeypadProps {
  value: string;
  onChange: (v: string) => void;
  onConfirm?: () => void;
  onClose?: () => void;
  label?: string;
  allowDecimal?: boolean;
  quickAmounts?: number[];
  confirmLabel?: string;
  confirmCls?: string;
  modal?: boolean;
  disabled?: boolean;
}

function applyKey(current: string, key: string, allowDecimal: boolean): string {
  if (key === 'C') return '';
  if (key === '⌫') return current.slice(0, -1);
  if (key === '.') {
    if (!allowDecimal) return current;
    if (current.includes('.')) return current;
    return (current || '0') + '.';
  }
  if (key === '00') {
    if (current === '' || current === '0') return current;
    return current + '00';
  }
  // Prevent leading zeros like "007"
  if (current === '0' && key !== '.') return key;
  return current + key;
}

const BTN_BASE =
  'flex items-center justify-center rounded-xl font-bold select-none transition-all ' +
  'active:scale-95 active:brightness-90 touch-manipulation cursor-pointer';

const BTN_DIGIT = `${BTN_BASE} bg-white border-2 border-gray-200 text-gray-900 text-2xl h-16 hover:bg-gray-50 hover:border-gray-300`;
const BTN_ACTION = `${BTN_BASE} bg-gray-100 border-2 border-gray-200 text-gray-700 text-xl h-16 hover:bg-gray-200`;
const BTN_CLEAR = `${BTN_BASE} bg-red-50 border-2 border-red-200 text-red-600 text-xl h-16 hover:bg-red-100`;

export default function NumericKeypad({
  value,
  onChange,
  onConfirm,
  onClose,
  label,
  allowDecimal = true,
  quickAmounts,
  confirmLabel = '✓ Confirm',
  confirmCls = 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600',
  modal = false,
  disabled = false,
}: NumericKeypadProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close modal on outside click
  useEffect(() => {
    if (!modal || !onClose) return;
    const handle = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, [modal, onClose]);

  // A modal keypad is the sole input surface on screen, so it should be
  // usable from a physical/external keyboard, not just by tapping — focus
  // it as soon as it opens so digit keys land here without a click first.
  useEffect(() => {
    if (modal) ref.current?.focus();
  }, [modal]);

  const press = (key: string) => {
    if (disabled) return;
    onChange(applyKey(value, key, allowDecimal));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key >= '0' && e.key <= '9') { e.preventDefault(); press(e.key); return; }
    if (e.key === '.') { e.preventDefault(); press('.'); return; }
    if (e.key === 'Backspace') { e.preventDefault(); press('⌫'); return; }
    if (e.key === 'Delete') { e.preventDefault(); press('C'); return; }
    if (e.key === 'Enter') { e.preventDefault(); onConfirm?.(); return; }
    if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
  };

  const digits = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3']];

  const pad = (
    <div ref={ref} tabIndex={0} onKeyDown={handleKeyDown} className="select-none outline-none">
      {/* Value display */}
      <div className="flex items-center justify-between mb-2">
        {label && <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>}
        {modal && onClose && (
          <button type="button" onClick={onClose} className="ml-auto p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100">
            <X size={16} />
          </button>
        )}
      </div>
      <div className={`flex items-center justify-end px-4 py-3 rounded-xl mb-3 min-h-[56px] ${
        value ? 'bg-blue-50 border-2 border-blue-300' : 'bg-gray-50 border-2 border-gray-200'
      }`}>
        <span className={`text-3xl font-black tabular-nums font-mono tracking-tight ${value ? 'text-blue-700' : 'text-gray-300'}`}>
          {value || '0.00'}
        </span>
      </div>

      {/* Quick-amount shortcuts */}
      {quickAmounts && quickAmounts.length > 0 && (
        <div className="grid grid-cols-5 gap-1.5 mb-3">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              type="button"
              onPointerDown={(e) => { e.preventDefault(); if (!disabled) onChange(String(amt)); }}
              className={`${BTN_BASE} bg-amber-50 border-2 border-amber-200 text-amber-800 text-sm font-bold h-11 hover:bg-amber-100`}
            >
              {amt}
            </button>
          ))}
        </div>
      )}

      {/* Main digit grid */}
      <div className="grid grid-cols-3 gap-2">
        {digits.flat().map((d) => (
          <button
            key={d}
            type="button"
            onPointerDown={(e) => { e.preventDefault(); press(d); }}
            className={BTN_DIGIT}
          >
            {d}
          </button>
        ))}

        {/* Bottom row: 00 | 0 | . (or empty) */}
        <button type="button" onPointerDown={(e) => { e.preventDefault(); press('00'); }} className={BTN_ACTION}>
          00
        </button>
        <button type="button" onPointerDown={(e) => { e.preventDefault(); press('0'); }} className={BTN_DIGIT}>
          0
        </button>
        {allowDecimal ? (
          <button type="button" onPointerDown={(e) => { e.preventDefault(); press('.'); }} className={BTN_ACTION}>
            .
          </button>
        ) : (
          <div />
        )}

        {/* Backspace | Clear | Confirm */}
        <button type="button" onPointerDown={(e) => { e.preventDefault(); press('⌫'); }} className={BTN_ACTION}>
          <Delete size={22} />
        </button>
        <button type="button" onPointerDown={(e) => { e.preventDefault(); press('C'); }} className={BTN_CLEAR}>
          C
        </button>
        <button
          type="button"
          onPointerDown={(e) => { e.preventDefault(); if (!disabled && onConfirm) onConfirm(); }}
          disabled={disabled}
          className={`${BTN_BASE} border-2 text-base font-black h-16 disabled:opacity-50 ${confirmCls}`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );

  if (modal) {
    return (
      <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-4 sm:items-center">
        <div className="bg-white rounded-2xl shadow-2xl p-4 w-full max-w-xs">
          {pad}
        </div>
      </div>
    );
  }

  return pad;
}
