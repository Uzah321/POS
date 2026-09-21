import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export interface RowAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  hidden?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

const MENU_WIDTH = 192; // w-48
const GAP = 4;
const EDGE = 8;

/**
 * A per-row "..." actions menu. Replaces a strip of icon buttons in a table
 * row with a single trigger that opens a dropdown of labeled actions.
 *
 * The dropdown is portaled to <body> with fixed positioning so table/overflow
 * containers can't clip it, and it flips above the trigger when there isn't
 * room below — so it never ends up off-screen needing a scroll.
 */
export default function RowActionsMenu({ actions, align = 'right' }: { actions: RowAction[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const r = btn.getBoundingClientRect();
    const h = menu.offsetHeight;
    const spaceBelow = window.innerHeight - r.bottom - EDGE;
    const top = spaceBelow >= h + GAP || r.top < h + GAP + EDGE
      ? Math.max(EDGE, Math.min(r.bottom + GAP, window.innerHeight - h - EDGE))
      : r.top - h - GAP;
    let left = align === 'right' ? r.right - MENU_WIDTH : r.left;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - MENU_WIDTH - EDGE));
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (open) place(); else setPos(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;

  return (
    <div className="relative inline-block text-left">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        title="Options"
      >
        <MoreVertical size={16} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, width: MENU_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
          className="z-[200] bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-left"
        >
          {visible.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setOpen(false); a.onClick(); }}
              disabled={a.disabled}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed ${a.danger ? 'text-red-600' : 'text-gray-700'}`}
            >
              <span className={a.danger ? 'text-red-500' : 'text-gray-400'}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
