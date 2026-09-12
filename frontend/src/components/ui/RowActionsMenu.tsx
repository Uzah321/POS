import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export interface RowAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  hidden?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * A per-row "..." actions menu. Replaces a strip of icon buttons in a table
 * row with a single trigger that opens a dropdown of labeled actions.
 */
export default function RowActionsMenu({ actions, align = 'right' }: { actions: RowAction[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        title="Options"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          className={`absolute z-20 ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-left`}
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
        </div>
      )}
    </div>
  );
}
