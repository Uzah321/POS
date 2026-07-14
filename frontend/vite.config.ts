import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Register the service worker manually so localhost installs can opt out.
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Core',
        short_name: 'Core',
        description: 'Point of Sale System',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // jsPDF (added for the stock-sheet export) pushed the main bundle past the
        // default 2 MiB precache limit — raise it so the build doesn't fail.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Remove caches from previous SW versions so old data does not serve stale responses
        cleanupOutdatedCaches: true,
        // Take control immediately without waiting for tabs to close
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /\/api\/products(\?.*)?$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-products', networkTimeoutSeconds: 3, expiration: { maxEntries: 10, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/categories(\?.*)?$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-categories', networkTimeoutSeconds: 3, expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/settings(\?.*)?$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-settings', networkTimeoutSeconds: 3, expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/currencies(\?.*)?$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-currencies', networkTimeoutSeconds: 3, expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/warehouses(\?.*)?$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-warehouses', networkTimeoutSeconds: 3, expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/customers(\?.*)?$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-customers', networkTimeoutSeconds: 3, expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/branches(\?.*)?$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-branches', networkTimeoutSeconds: 3, expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/tax-rates(\?.*)?$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-tax-rates', networkTimeoutSeconds: 3, expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/auth\/me$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-auth', networkTimeoutSeconds: 3, expiration: { maxEntries: 2, maxAgeSeconds: 3600 } },
          },
        ],
        navigateFallback: '/index.html',
        // Exclude API routes and any server-rendered paths from the SW navigation fallback
        navigateFallbackDenylist: [/^\/api/, /^\/storage/],
      },
    }),
  ],
  build: {
    outDir: '../backend/public',
    emptyOutDir: false,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
