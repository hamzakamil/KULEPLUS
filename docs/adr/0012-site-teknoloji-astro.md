# ADR-0012: `apps/site` = Astro; `apps/web` = Vue 3 + Vite

**Tarih:** 5 Ekim 2026
**Durum:** Kabul

## Bağlam
Pazarlama sitesi için framework kararı belirsizdi. Nuxt 4 önerisi değerlendirildi ancak `apps/web` kararını bozacaktı.

## Karar
- `apps/web`: **Vue 3 + Vite** (mevcut karar korunur; PWA).
- `apps/site`: **Astro** (statik; `@astrojs/vue` ile `packages/ui` paylaşımı).
- Barındırma: api/web/worker TR VPS; site Cloudflare Pages.
- CMS: markdown + Astro Content Collections.
- Analitik: Plausible.

## Alternatifler
- Nuxt 4 (web + site): mevcut SPEC/README kararını bozardı.
- Saf Vite SSG: Astro kadar içerik dostu değil.

## Sonuç
Site ve uygulama ayrı ama ortak tasarım sistemi; SEO site için, SPA panel için ideal.

## Kapanış Kriteri
Faz 2'de site Cloudflare Pages'e otomatik deploy; `packages/ui` paylaşımı doğrulanır.