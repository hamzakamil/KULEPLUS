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
      manifest: {
        name: 'Kuleplus',
        short_name: 'Kuleplus',
        description: 'Patron için sade, muhasebeci için derin.',
        theme_color: '#1d4ed8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        lang: 'tr',
        icons: [],
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
