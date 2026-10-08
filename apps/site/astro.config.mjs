// apps/site — statik pazarlama sitesi (ADR-0012)
// Barındırma: Cloudflare Pages · CMS: markdown + Content Collections · Analitik: Plausible
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // Canonical/sitemap için mutlak URL. Üretimde SITE_URL ile geçilir (Cloudflare Pages env).
  site: process.env.SITE_URL || 'http://localhost:4321',
  integrations: [vue(), sitemap()],
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
});
