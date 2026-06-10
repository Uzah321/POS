import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Ensure the service worker is included in the build output
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'NexaPOS',
        short_name: 'NexaPOS',
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
        // Remove caches from previous SW versions so old data does not serve stale responses
        cleanupOutdatedCaches: true,
        // Take control immediately without waiting for tabs to close
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /\/api\/products(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-products', expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/categories(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-categories', expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/settings(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-settings', expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/currencies(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-currencies', expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /\/api\/warehouses(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-warehouses', expiration: { maxEntries: 5, maxAgeSeconds: 86400 } },
          },
        ],
        navigateFallback: '/index.html',
        // Exclude API routes and any server-rendered paths from the SW navigation fallback
        navigateFallbackDenylist: [/^\/api/, /^\/storage/],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
