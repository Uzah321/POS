import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'DiaperMart Store',
        short_name: 'DiaperMart Store',
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
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\/products/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-products' },
          },
          {
            urlPattern: /^https?:\/\/.*\/api\/categories/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-categories' },
          },
          {
            urlPattern: /^https?:\/\/.*\/api\/settings/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-settings' },
          },
          {
            urlPattern: /^https?:\/\/.*\/api\/currencies/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-currencies' },
          },
          {
            urlPattern: /^https?:\/\/.*\/api\/warehouses/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-warehouses' },
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
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
