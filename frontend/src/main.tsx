import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import toast from 'react-hot-toast'
import './index.css'
import App from './App.tsx'
import { useCartStore } from './stores/cartStore'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.DEV) {
      // In dev mode, clear any stale service workers so Vite HMR works cleanly
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((r) => r.unregister()))
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((k) => caches.delete(k)))
        }
        if (!sessionStorage.getItem('core-sw-dev-reset')) {
          sessionStorage.setItem('core-sw-dev-reset', '1')
          window.location.reload()
        }
      })()
      return
    }
    // Production (installed app): register SW for full offline support
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((registration) => {
      // A till is often left open for a whole shift, and a browser tab
      // doesn't reliably re-check its service worker for updates on its
      // own — without this, a deployed fix (e.g. a product color change)
      // never reaches an already-open register until someone happens to
      // close and reopen the tab.
      const CHECK_INTERVAL_MS = 5 * 60 * 1000
      setInterval(() => { registration.update().catch(() => {}) }, CHECK_INTERVAL_MS)

      // skipWaiting + clientsClaim (see vite.config.ts) mean a newly-found
      // service worker takes over immediately — but the page still needs an
      // actual reload to run the new JS. Reload right away if the cart is
      // empty (nothing to lose); otherwise ask, and keep checking until the
      // cart clears so it happens automatically as soon as it's safe.
      let reloaded = false
      const reloadWhenSafe = () => {
        if (reloaded) return
        if (useCartStore.getState().items.length === 0) {
          reloaded = true
          window.location.reload()
          return
        }
        toast((t) => (
          <span className="flex items-center gap-3">
            An update is ready — refresh when convenient.
            <button
              type="button"
              onClick={() => { reloaded = true; toast.dismiss(t.id); window.location.reload() }}
              className="text-blue-600 font-semibold hover:underline flex-shrink-0"
            >
              Refresh now
            </button>
          </span>
        ), { duration: 15000, id: 'sw-update' })
        const recheck = setInterval(() => {
          if (reloaded) { clearInterval(recheck); return }
          if (useCartStore.getState().items.length === 0) {
            clearInterval(recheck)
            reloaded = true
            window.location.reload()
          }
        }, 10000)
      }

      navigator.serviceWorker.addEventListener('controllerchange', reloadWhenSafe)
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
