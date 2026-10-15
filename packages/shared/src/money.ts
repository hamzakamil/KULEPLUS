// DİKKAT: named import. `import Decimal from 'decimal.js'` biçimi node16/nodenext
// çözümleyicisinde (Vercel build) CJS sınıflandırılan `decimal.d.ts` içindeki
// `export default` yüzünden namespace'e düşer ve TS2709/TS2351/TS2339 üretir.
// Named import her modda (bundler/node10/node16/nodenext) class+namespace birleşimini
// verir; runtime'da da geçerlidir (ESM: `decimal.mjs` → `export var Decimal`,
// CJS: `Decimal.Decimal = Decimal`).
import { Decimal } from 'decimal.js';

/**
 * Para standardı — SPEC §0.3 / README §14:
 * - Para için number/float YASAKTIR; decimal.js + PostgreSQL NUMERIC(20,8).
 * - Bu modül yalnızca string/Decimal kabul eder; JS `number` girişi hata fırlatır.
 */

/** NUMERIC(20,8) — saklama ölçeği. */
export const MONEY_SCALE = 8;
/** TRY görünüm ölçeği (kuruş). */
export const MONEY_DISPLAY_SCALE = 2;

function toDecimal(value: string | Decimal, label: string): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value !== 'string') {
    throw new TypeError(
      `Para değeri string/Decimal olmalıdır (alan: ${label}); number kullanımı SPEC ile yasaktır.`,
    );
  }
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new TypeError(`Geçersiz para değeri (alan: ${label}): "${value}"`);
  }
  return new Decimal(trimmed);
}

/** İki para değerini toplar; sonucu scale (8) ile döndürür (DB'ye hazır string). */
export function addMoney(a: string | Decimal, b: string | Decimal): string {
  return toDecimal(a, 'a').plus(toDecimal(b, 'b')).toFixed(MONEY_SCALE);
}

/** Çıkarma: a - b. */
export function subMoney(a: string | Decimal, b: string | Decimal): string {
  return toDecimal(a, 'a').minus(toDecimal(b, 'b')).toFixed(MONEY_SCALE);
}

/** Çarpma (miktar × fiyat). */
export function mulMoney(a: string | Decimal, b: string | Decimal): string {
  return toDecimal(a, 'a').times(toDecimal(b, 'b')).toFixed(MONEY_SCALE);
}

/** Bölme; yuvarlama modu HALF_UP (varsayılan muhasebe kuralı). */
export function divMoney(a: string | Decimal, b: string | Decimal): string {
  const divisor = toDecimal(b, 'b');
  if (divisor.isZero()) throw new RangeError('Sıfıra bölme (divMoney)');
  return toDecimal(a, 'a').dividedBy(divisor).toFixed(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Sıfır kontrolü. */
export function isZeroMoney(a: string | Decimal): boolean {
  return toDecimal(a, 'a').isZero();
}

/** Karşılaştırma: -1 | 0 | 1. */
export function compareMoney(a: string | Decimal, b: string | Decimal): -1 | 0 | 1 {
  const result = toDecimal(a, 'a').comparedTo(toDecimal(b, 'b'));
  return result === 1 ? 1 : result === -1 ? -1 : 0;
}

/**
 * Görünüm biçimi: 1.234,56 ₺ (tr-TR).
 * Kaynak değer string/Decimal kalır; number'a düşülmez.
 */
export function formatMoneyTR(value: string | Decimal, currency = 'TRY'): string {
  const n = toDecimal(value, 'value');
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: MONEY_DISPLAY_SCALE,
    maximumFractionDigits: MONEY_DISPLAY_SCALE,
  }).format(n.toNumber());
}
