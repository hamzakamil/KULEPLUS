import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// apps/web — Faz 0 iskeleti: kabuk + router iskeleti + PWA manifest.
// Ekran içerikleri Faz 1 (platform) + Faz 2 (müşteri) fazlarında doldurulur.
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png', 'offline.html'],
      manifest: {
        name: 'Kuleplus',
        short_name: 'Kuleplus',
        description: 'Şirketinizin tüm süreçleri tek bir merkezde.',
        theme_color: '#1d4ed8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'tr',
        dir: 'ltr',
        icons: [
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // SPEC §25: çevrimdışı yalnızca OKUMA içindir — finansal belge yazma yoktur.
      // Uygulama kabuğu önbelleğe alınır, API GET yanıtları kısa süreli NetworkFirst tutulur.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA: önbelleğe alınmamış her sayfa yenilemesi (F5, doğrudan URL) uygulama kabuğunu
        // açmalı. offline.html burada olsaydı her yenileme çevrimdışı ekranına düşerdi.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Web Push olay işleyicileri (push/notificationclick) üretilen SW'ye enjekte edilir.
        importScripts: ['/push-sw.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/v1/') && url.protocol === 'https:',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-read-only',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
