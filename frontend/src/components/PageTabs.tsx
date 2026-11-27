import { useEffect, useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface PageTab<K extends string = string> {
  key: K;
  label: string;
  icon?: LucideIcon;
  /** Shown after the label, e.g. a count. */
  extra?: ReactNode;
  /** Has changes not saved yet. */
  unsaved?: boolean;
}

/**
 * A row of tabs that splits a long page into parts, one shown at a time.
 * On a phone the row scrolls sideways rather than wrapping.
 */
export default function PageTabs<K extends string>({ tabs, active, onChange, label }: {
  tabs: PageTab<K>[];
  active: K;
  onChange: (key: K) => void;
  /** What the tabs choose between, for screen readers. */
  label: string;
}) {
  // On a phone, bring the open tab into the row's view: sideways only, and
  // only when it changes, so the page itself never jumps.
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tab = row.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row.current || !tab) return;
    const r = row.current.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < r.left) row.current.scrollLeft -= r.left - t.left + 16;
    else if (t.right > r.right) row.current.scrollLeft += t.right - r.right + 16;
  }, [active]);

  return (
    <div ref={row} role="tablist" aria-label={label} className="flex overflow-x-auto border-b border-gray-200">
      {tabs.map(({ key, label: text, icon: Icon, extra, unsaved }) => {
        const on = key === active;
        return (
          // The open tab is underlined with a shadow, not a border: index.css
          // gives any button with a border class a grey fill and hides its border.
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(key)}
            className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap bg-transparent px-4 py-2.5 text-sm font-medium transition-colors touch-manipulation ${
              on ? 'text-blue-600 shadow-[inset_0_-2px_0_#2563eb]' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {Icon && <Icon size={15} />}
            {text}
            {extra}
            {unsaved && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Changes not saved yet" />}
          </button>
        );
      })}
    </div>
  );
}
