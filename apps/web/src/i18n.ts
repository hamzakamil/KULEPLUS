import tr from '@/locales/tr.json';

/**
 * i18n iskeleti — docs/product/i18n.md:
 * `<modül>.<alan>.<alt_alan>` · modül başına JSON · başlangıç dili yalnızca TR.
 * Faz 2'de vue-i18n'e taşınır.
 */
export type MessageKey = keyof typeof tr;

export function t(key: MessageKey): string {
  return tr[key] ?? key;
}
