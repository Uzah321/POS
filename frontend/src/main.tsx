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

// Opened in a plain Android browser tab (not the installed app, which is
// already fullscreen via the manifest): take over the whole screen on the
// first tap. Browsers only allow requestFullscreen from a user gesture.
const isInstalledApp = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches
if (/Android/i.test(navigator.userAgent) && !isInstalledApp && document.documentElement.requestFullscreen) {
  const enterFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
    }
  }
  // Re-arm on every tap so it recovers if the user swipes out of fullscreen.
  document.addEventListener('pointerdown', enterFullscreen)
}

// Tablet tills run landscape, phones portrait (device class set in index.html).
// Orientation lock only works in the installed app or fullscreen, so retry
// whenever fullscreen is entered; failures elsewhere are expected and ignored.
const lockOrientation = () => {
  const device = document.documentElement.dataset.device
  if (!device) return
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
  orientation.lock?.(device === 'tablet' ? 'landscape' : 'portrait').catch(() => {})
}
lockOrientation()
document.addEventListener('fullscreenchange', lockOrientation)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
