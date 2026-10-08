/**
 * Türkçe dil yardımcıları — SPEC §3.1:
 * - Metinler NFC ile işlenir.
 * - Büyük harf: yalnızca insan dilinde toLocaleUpperCase('tr-TR').
 * - Sıralama: Intl.Collator('tr-TR').
 * - İstisna: e-posta, token, UUID, URL üzerinde Türkçe dönüşüm YAPILMAZ.
 */

/** NFC normalizasyonu. */
export function normalizeText(value: string): string {
  return value.normalize('NFC');
}

/** tr-TR büyük harf: "i" → "İ", "ı" → "I". */
export function trUpper(value: string): string {
  return value.toLocaleUpperCase('tr-TR');
}

/** tr-TR küçük harf. */
export function trLower(value: string): string {
  return value.toLocaleLowerCase('tr-TR');
}

/** tr-TR sıralama karşılaştırıcısı (varsayılan: duyarlı, dil-bağımlı). */
export function trCollator(options?: Intl.CollatorOptions): Intl.Collator {
  return new Intl.Collator('tr-TR', { sensitivity: 'variant', ...options });
}

/** İki metni tr-TR kurallarına göre karşılaştırır (-1 | 0 | 1). */
export function trCompare(a: string, b: string): number {
  return trCollator().compare(a, b);
}
