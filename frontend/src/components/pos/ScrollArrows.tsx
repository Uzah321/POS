import { useCallback, useEffect, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/** Tracks whether a scroll container has more content above and/or below the visible area. */
export function useScrollState(ref: RefObject<HTMLElement | null>, deps: unknown[]) {
  const [state, setState] = useState({ up: false, down: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) {
      setState((p) => (p.up || p.down ? { up: false, down: false } : p));
      return;
    }
    const up = el.scrollTop > 4;
    const down = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
    setState((p) => (p.up === up && p.down === down ? p : { up, down }));
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    update();
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    // Content can change size after render (images loading, lists filtering), so re-check once it settles.
    const t = setTimeout(update, 250);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      window.removeEventListener('resize', update);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, ...deps]);

  return state;
}

/**
 * Touch-friendly up/down buttons for a scroll container. Renders nothing unless the
 * content actually overflows, so a short list stays uncluttered.
 */
export default function ScrollArrows({
  targetRef, state, variant,
}: {
  targetRef: RefObject<HTMLElement | null>;
  state: { up: boolean; down: boolean };
  variant: 'rail' | 'grid';
}) {
  if (!state.up && !state.down) return null;

  const scroll = (dir: 1 | -1) => {
    const el = targetRef.current;
    if (el) el.scrollBy({ top: dir * el.clientHeight * 0.8, behavior: 'smooth' });
  };

  const btn = (dir: 1 | -1, enabled: boolean) => (
    <button
      type="button"
      onClick={() => scroll(dir)}
      disabled={!enabled}
      aria-label={dir === 1 ? 'Scroll down' : 'Scroll up'}
      className={`flex-1 h-9 flex items-center justify-center rounded-lg text-white touch-manipulation transition-opacity disabled:opacity-30 disabled:cursor-default ${variant === 'rail' ? '' : 'max-w-[120px]'}`}
      style={{ background: variant === 'rail' ? '#173463' : '#2f6df6' }}
    >
      {dir === 1 ? <ChevronDown size={22} strokeWidth={2.4} /> : <ChevronUp size={22} strokeWidth={2.4} />}
    </button>
  );

  return (
    <div className={`flex gap-2 flex-shrink-0 ${variant === 'rail' ? 'p-2.5 pt-1.5' : 'justify-center'}`}>
      {btn(-1, state.up)}
      {btn(1, state.down)}
    </div>
  );
}
