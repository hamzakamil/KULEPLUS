/**
 * Kimlik verisi doğrulayıcıları — SPEC §3.2:
 * - TCKN: 11 hane, biçim + kontrol basamağı. **Resmi doğrulama olarak sunulmaz.**
 * - VKN:  10 hane, biçim. Kontrol basamağı SMMM golden testi ile doğrulanıp eklenecek.
 * - IBAN: boşluksuz, büyük harf (saklama biçimi).
 * - Telefon: normalize edilmiş temel numara; E.164 ayrı kolonda.
 * - Posta kodu: 5 hane.
 */

/** TCKN: 11 hane, ilk hane ≠ 0, iki kontrol basamağı. */
export function isValidTCKN(value: string): boolean {
  const v = (value ?? '').replace(/\s/g, '');
  if (!/^[1-9]\d{10}$/.test(v)) return false;
  const d = v.split('').map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8]; // 1,3,5,7,9. haneler
  const evenSum = d[1] + d[3] + d[5] + d[7]; // 2,4,6,8. haneler
  const check10 = (((oddSum * 7 - evenSum) % 10) + 10) % 10;
  if (check10 !== d[9]) return false;
  const check11 = d.slice(0, 10).reduce((s, n) => s + n, 0) % 10;
  return check11 === d[10];
}

/**
 * VKN: 10 hane, ilk hane ≠ 0 — biçim kontrolü.
 * TODO(Faz 1): kontrol basamağı algoritması SMMM golden test vektörleriyle eklenecek.
 */
export function isValidVKN(value: string): boolean {
  const v = (value ?? '').replace(/\s/g, '');
  return /^[1-9]\d{9}$/.test(v);
}

/** IBAN mod-97/10 doğrulaması (ISO 13616); TR ile başlamalı. */
export function isValidIBAN(value: string): boolean {
  const v = (value ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^TR\d{24}$/.test(v)) return false;
  const rearranged = v.slice(4) + v.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** Saklama biçimi: boşluksuz, büyük harf. */
export function normalizeIBAN(value: string): string {
  return (value ?? '').replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Temel telefon numarası (10 hane, 5 ile başlar):
 * "0532…", "+90 532…", "90532…" girişlerini "5XXXXXXXXX" biçimine indirger.
 * E.164 biçimi için {@link toE164TR} kullanın.
 */
export function normalizePhoneTR(value: string): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (/^5\d{9}$/.test(digits)) return digits; // 5XXXXXXXXX
  if (/^05\d{9}$/.test(digits)) return digits.slice(1); // 05XXXXXXXXX
  if (/^905\d{9}$/.test(digits)) return digits.slice(2); // 90 5XXXXXXXXX
  return null;
}

/** E.164 biçimi: +905XXXXXXXXX (ayrı kolonda saklanır — SPEC §3.2). */
export function toE164TR(value: string): string | null {
  const national = normalizePhoneTR(value);
  return national ? `+90${national}` : null;
}

/** Posta kodu: tam 5 hane. */
export function isValidPostalCode(value: string): boolean {
  return /^\d{5}$/.test((value ?? '').trim());
}
