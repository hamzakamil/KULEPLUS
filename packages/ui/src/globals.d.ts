/** Tarayıcı globals — Plausible KVKK dostu analitik (docs/product/seo-analytics.md). */
interface PlausibleInstance {
  (event: string, options?: Record<string, unknown>): void;
}

interface Window {
  plausible?: PlausibleInstance;
}
