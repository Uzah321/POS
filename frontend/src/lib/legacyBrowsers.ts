// Shop devices don't always get browser updates: the Posiflex tills run Edge 92
// (2021), and Android handheld tills ship a Chrome of 60–90. The build compiles
// newer syntax away and adds the missing JavaScript built-ins for them (the
// legacy plugin in vite.config.ts). Browser features it can't add are filled in
// here: two built-ins the charts call, ResizeObserver, and flexbox `gap`.

if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', {
    value: (obj: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, key),
    configurable: true,
    writable: true,
  });
}

if (typeof globalThis.structuredClone !== 'function') {
  // The charts only hand it plain data, or an Error to copy.
  globalThis.structuredClone = ((value: unknown) => (value instanceof Error
    ? Object.assign(Object.create(Object.getPrototypeOf(value)), value)
    : JSON.parse(JSON.stringify(value)))) as typeof structuredClone;
}

// AbortController only exists from Chrome 66, and the data library creates one
// for every request — without it no screen could load anything. The stand-in
// can't stop a request already sent; it only tells the code waiting on it, which
// is all a cancelled query needs.
if (typeof window.AbortController !== 'function') {
  type Listener = (this: unknown, ev: Event) => void;

  class AbortSignalFallback {
    aborted = false;
    reason: unknown = undefined;
    onabort: Listener | null = null;
    private listeners: Array<{ fn: Listener; once: boolean }> = [];
    addEventListener(type: string, fn: Listener, options?: boolean | { once?: boolean }) {
      if (type !== 'abort' || !fn || this.listeners.some((l) => l.fn === fn)) return;
      this.listeners.push({ fn, once: typeof options === 'object' && !!options?.once });
    }
    removeEventListener(_type: string, fn: Listener) {
      this.listeners = this.listeners.filter((l) => l.fn !== fn);
    }
    dispatchEvent(ev: Event) {
      this.onabort?.call(this, ev);
      for (const l of this.listeners.slice()) {
        if (l.once) this.removeEventListener('abort', l.fn);
        l.fn.call(this, ev);
      }
      return true;
    }
    throwIfAborted() {
      if (this.aborted) throw this.reason;
    }
  }

  class AbortControllerFallback {
    readonly signal = new AbortSignalFallback();
    abort(reason?: unknown) {
      if (this.signal.aborted) return;
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      this.signal.aborted = true;
      this.signal.reason = reason === undefined ? error : reason;
      this.signal.dispatchEvent(new Event('abort'));
    }
  }

  const w = window as unknown as { AbortController: unknown; AbortSignal?: unknown };
  w.AbortController = AbortControllerFallback;
  if (typeof w.AbortSignal !== 'function') w.AbortSignal = AbortSignalFallback;
}

// ResizeObserver only exists from Chrome 64; the till's product grid (its scroll
// arrows) and the charts create one, and without it the POS screen crashed on
// an Android 8 handheld's Chrome 61. This stand-in checks each watched element's
// size four times a second and on window resize, and reports changes the same
// way (target + contentRect — all the app and the charts read).
if (typeof window.ResizeObserver !== 'function') {
  interface Watched { el: Element; width: number; height: number }
  const active = new Set<ResizeObserverFallback>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const checkAll = () => active.forEach((observer) => observer.check());
  const startOrStop = () => {
    if (active.size && !timer) {
      timer = setInterval(checkAll, 250);
      window.addEventListener('resize', checkAll);
    } else if (!active.size && timer) {
      clearInterval(timer);
      timer = null;
      window.removeEventListener('resize', checkAll);
    }
  };
  const px = (value: string) => parseFloat(value) || 0;

  class ResizeObserverFallback {
    private watched: Watched[] = [];
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(el: Element) {
      if (this.watched.some((w) => w.el === el)) return;
      this.watched.push({ el, width: -1, height: -1 });
      active.add(this);
      startOrStop();
      setTimeout(() => this.check(), 0); // like the real one, report the first size right away
    }
    unobserve(el: Element) {
      this.watched = this.watched.filter((w) => w.el !== el);
      if (!this.watched.length) { active.delete(this); startOrStop(); }
    }
    disconnect() {
      this.watched = [];
      active.delete(this);
      startOrStop();
    }
    check() {
      const entries: ResizeObserverEntry[] = [];
      for (const w of this.watched) {
        const style = getComputedStyle(w.el);
        const box = w.el.getBoundingClientRect();
        const left = px(style.paddingLeft);
        const top = px(style.paddingTop);
        const width = Math.max(0, box.width - left - px(style.paddingRight) - px(style.borderLeftWidth) - px(style.borderRightWidth));
        const height = Math.max(0, box.height - top - px(style.paddingBottom) - px(style.borderTopWidth) - px(style.borderBottomWidth));
        if (width === w.width && height === w.height) continue;
        w.width = width;
        w.height = height;
        const contentRect = { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
        entries.push({ target: w.el, contentRect } as unknown as ResizeObserverEntry);
      }
      if (entries.length) this.callback(entries, this as unknown as ResizeObserver);
    }
  }

  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverFallback;
}

// Chrome before 84 ignores `gap` on a flex row, so every icon sat flush against
// its label and buttons touched; before 66 it ignores `gap` on grids too (it
// only knew `grid-gap`), so product tiles and keypad keys touched. Measure each
// once and let index.css space them another way (the `no-flex-gap` and
// `no-grid-gap` rules).
(() => {
  const gapWorks = (display: string) => {
    const probe = document.createElement('div');
    probe.style.cssText = `display:${display};flex-direction:column;row-gap:1px;position:absolute;visibility:hidden`;
    probe.appendChild(document.createElement('div'));
    probe.appendChild(document.createElement('div'));
    document.documentElement.appendChild(probe);
    const works = probe.scrollHeight === 1;
    document.documentElement.removeChild(probe);
    return works;
  };
  if (!gapWorks('flex')) document.documentElement.classList.add('no-flex-gap');
  if (!gapWorks('grid')) document.documentElement.classList.add('no-grid-gap');
})();

export {};
