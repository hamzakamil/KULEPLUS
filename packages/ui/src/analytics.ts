/**
 * Analitik yardımcısı — Plausible (KVKK dostu; docs/product/seo-analytics.md).
 *
 * NEDEN modül olarak: global `Window` genişletmeleri yalnızca programa
 * **import edildiğinde** uygulanır. Bu dosya `ContactForm.vue` tarafından
 * import edildiği için hem `packages/ui` hem de onu tüketen `apps/web`
 * programında geçerli olur (önceden `globals.d.ts` hiç import edilmiyordu →
 * `window.plausible` tipsiz kalıp typecheck kırılıyordu).
 */
declare global {
  interface Window {
    plausible?: (event: string, options?: Record<string, unknown>) => void;
  }
}

/**
 * Plausible olayı tetikler. Analitik script'i yüklenmemişse (engellenmiş,
 * gizli mod, test ortamı) sessizce geçer — iş akışı asla kesilmez.
 */
export function trackEvent(event: string, options?: Record<string, unknown>): void {
  window.plausible?.(event, options);
}
