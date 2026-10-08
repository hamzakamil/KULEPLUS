import { uuidv7 } from 'uuidv7';

/**
 * Kimlik üretimi — SPEC §0.1:
 * - Standart: UUID v7 (zaman sıralı, uygulama tarafında üretim).
 * - `gen_random_uuid()` (v4) DB'de KULLANILMAZ.
 * - Paket: uuidv7 (T-0.8 önerisi); tüm üretim bu fonksiyon üzerinden yapılır.
 */
export function newId(): string {
  return uuidv7();
}

/**
 * UUID v7'nin ilk 48 biti milisaniye timestamp'idir.
 * Geri uyumluluk/audit sorguları için yardımcı.
 */
export function idTimestamp(id: string): Date | null {
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  if (!valid) return null;
  const msHex = id.slice(0, 8) + id.slice(9, 13); // tireler atlanır → 12 hex = 48 bit
  return new Date(Number(BigInt(`0x${msHex}`)));
}
