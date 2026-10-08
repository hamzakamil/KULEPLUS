import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Astro Content Collections (ADR-0012: CMS = markdown + Content Collections, headless CMS yok).
 * - blog:    apps/site/src/content/blog/*.md
 * - yardim:  apps/site/src/content/yardim/*.md  (Yardım merkezi v0 — docs/product/help-center.md)
 * - legal:   docs/legal/*.md                    (ROADMAP Faz 2: "Yasal sayfalar — kaynak docs/legal/")
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: () =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      author: z.string().default('Kuleplus Ekibi'),
      tags: z.array(z.string()).default([]),
    }),
});

const yardim = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/yardim' }),
  schema: () =>
    z.object({
      title: z.string(),
      description: z.string(),
      order: z.number(),
      // ROADMAP'te "(Faz 3)" gibi işaretli maddeler için
      phase: z.number().default(2),
    }),
});

const legal = defineCollection({
  // Kaynak tek yer: docs/legal (hukukçu dolduracak)
  loader: glob({ pattern: '*.md', base: '../../docs/legal' }),
  // Legal dosyalarında frontmatter yok (yalnızca gövde metni) — şema boş.
  schema: () => z.object({}),
});

export const collections = { blog, yardim, legal };
