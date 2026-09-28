import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Keyboard, X } from 'lucide-react';

export interface ShortcutDestination {
  /** Digit pressed with Alt, "1".."9". */
  key: string;
  to: string;
  label: string;
}

// What each till screen's own keydown handlers do (POSPage / CashierPage) —
// listed here so the help panel can show them; keep in step with those pages.
const PAGE_SHORTCUTS: Record<string, Array<[string, string]>> = {
  '/pos': [
    ['F2 or /', 'Search products'],
    ['F9', 'Pay / complete sale'],
    ['F8', 'Hold order'],
    ['F5', 'Clear cart'],
    ['1 · 2 · 3', 'Pay by cash / card / mobile money'],
    ['Esc', 'Clear search'],
  ],
  '/cashier': [
    ['F9', 'Complete sale'],
    ['F1 · F2 · F3', 'Pay by cash / card / mobile money'],
    ['F10', 'Type the cash tendered'],
    ['F6', 'Change quantity of the last item'],
    ['Delete', 'Remove the last item (scan box empty)'],
    ['F8', 'Save (hold) order'],
    ['F4', 'Held orders'],
    ['F7', 'Void a sale'],
    ['F5', 'Clear cart'],
    ['Esc', 'Clear the scan box'],
  ],
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

function Keys({ combo }: { combo: string }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {combo.split(' ').map((part, i) =>
        // "or", "+" and "·" (one key per option listed) are words, everything else a key.
        part === 'or' || part === '+' || part === '·'
          ? <span key={i} className="text-xs text-gray-400">{part}</span>
          : <kbd key={i} className="min-w-[1.75rem] text-center px-1.5 py-0.5 text-xs font-semibold text-gray-700 bg-gray-100 border border-gray-300 border-b-2 rounded">{part}</kbd>
      )}
    </span>
  );
}

/**
 * App-wide keyboard shortcuts: Alt+1..9 jumps to the main pages the user may
 * open, and "?" opens a panel listing every shortcut (including the current
 * till screen's own F-keys).
 */
export default function KeyboardShortcuts({ open, onOpenChange, destinations }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: ShortcutDestination[];
}) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') { onOpenChange(false); return; }
      if (e.ctrlKey || e.metaKey) return;

      // Alt+digit — e.code so it works whatever the keyboard layout makes Alt+digit type.
      if (e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        const dest = destinations.find((d) => d.key === e.code.slice(5));
        if (dest) {
          e.preventDefault();
          onOpenChange(false);
          if (location.pathname !== dest.to) navigate(dest.to);
        }
        return;
      }

      if (e.key === '?' && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange, destinations, navigate, location.pathname]);

  if (!open) return null;

  const pageShortcuts = PAGE_SHORTCUTS[location.pathname];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => onOpenChange(false)}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Keyboard size={18} /> Keyboard shortcuts</h2>
          <button type="button" onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-5 text-sm">
          {pageShortcuts && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">On this screen</h3>
              <ul className="space-y-1.5">
                {pageShortcuts.map(([combo, label]) => (
                  <li key={combo} className="flex items-center justify-between gap-4"><span className="text-gray-700">{label}</span><Keys combo={combo} /></li>
                ))}
              </ul>
            </section>
          )}
          {destinations.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Go to</h3>
              <ul className="space-y-1.5">
                {destinations.map((d) => (
                  <li key={d.key} className="flex items-center justify-between gap-4"><span className="text-gray-700">{d.label}</span><Keys combo={`Alt + ${d.key}`} /></li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Anywhere</h3>
            <ul className="space-y-1.5">
              <li className="flex items-center justify-between gap-4"><span className="text-gray-700">Show / hide this list</span><Keys combo="?" /></li>
              <li className="flex items-center justify-between gap-4"><span className="text-gray-700">Scroll the page</span><Keys combo="↑ · ↓" /></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
