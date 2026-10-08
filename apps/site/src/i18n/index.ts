/**
 * i18n iskeleti — docs/product/i18n.md.
 * Başlangıç dili: yalnızca TR (vue-i18n altyapısı apps/web'de; site statik olduğu için
 * JSON sözlük + `t()` yardımcısı kullanır).
 * Anahtar formatı: `<modul>.<alan>.<alt_alan>`
 */
import tr from '../locales/tr/site.json';

const dictionaries = { tr } as const;

export type Locale = keyof typeof dictionaries;
export type MessageKey = keyof (typeof dictionaries)['tr'];

export const currentLocale: Locale = 'tr';

/** Anahtarı seçili dilde çözer; bulunamazsa anahtarın kendisini döner. */
export function t(key: MessageKey, locale: Locale = currentLocale): string {
  const dict = dictionaries[locale] as Record<string, string>;
  return dict[key] ?? key;
}

/**
 * Sayı/tarih/para biçimi (i18n.md §Tarih/Sayı Formatı).
 * Örnek: 1.234,56 ₺ · 05.10.2026
 */
export function formatMoney(value: number, currency = 'TRY'): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('tr-TR').format(value);
}

export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('tr-TR').format(value);
}
