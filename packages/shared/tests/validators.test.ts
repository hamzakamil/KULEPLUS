import { describe, expect, it } from 'vitest';
import {
  isValidIBAN,
  isValidPostalCode,
  isValidTCKN,
  isValidVKN,
  normalizeIBAN,
  normalizePhoneTR,
  toE164TR,
} from '../src/validators';

describe('TCKN (SPEC §3.2 — resmi doğrulama değildir)', () => {
  it('geçerli kontrol basamaklı numaraları kabul eder', () => {
    expect(isValidTCKN('10000000146')).toBe(true);
    expect(isValidTCKN('12345678950')).toBe(true); // algoritmik örnek
  });

  it('hatalı kontrol basamağını reddeder', () => {
    expect(isValidTCKN('10000000147')).toBe(false);
    expect(isValidTCKN('12345678951')).toBe(false);
  });

  it('biçim hatalarını reddeder', () => {
    expect(isValidTCKN('')).toBe(false);
    expect(isValidTCKN('1234567895')).toBe(false); // 10 hane
    expect(isValidTCKN('00000000000')).toBe(false); // ilk hane 0
    expect(isValidTCKN('1234567895a')).toBe(false);
  });
});

describe('VKN (SPEC §3.2 — biçim)', () => {
  it('10 hane ve ilk hane ≠ 0', () => {
    expect(isValidVKN('1234567890')).toBe(true);
    expect(isValidVKN('0234567890')).toBe(false);
    expect(isValidVKN('123456789')).toBe(false);
    expect(isValidVKN('12345678901')).toBe(false);
  });
});

describe('IBAN (SPEC §3.2)', () => {
  it('geçerli TR IBAN kabul eder', () => {
    expect(isValidIBAN('TR330006100519786457841326')).toBe(true);
  });

  it('boşluklu/büyük harf girişi normalize edilir', () => {
    expect(normalizeIBAN('tr33 0006 1005 1978 6457 8413 26')).toBe('TR330006100519786457841326');
    expect(isValidIBAN('tr33 0006 1005 1978 6457 8413 26')).toBe(true);
  });

  it('hatalı check digit / uzunluk reddedilir', () => {
    expect(isValidIBAN('TR340006100519786457841326')).toBe(false);
    expect(isValidIBAN('TR33000610051978645784132')).toBe(false);
    expect(isValidIBAN('DE89370400440532013000')).toBe(false); // TR zorunlu
  });
});

describe('Telefon (SPEC §3.2)', () => {
  it('girişleri 10 haneye indirger', () => {
    expect(normalizePhoneTR('0532 123 45 67')).toBe('5321234567');
    expect(normalizePhoneTR('+90 532 123 45 67')).toBe('5321234567');
    expect(normalizePhoneTR('905321234567')).toBe('5321234567');
    expect(normalizePhoneTR('5321234567')).toBe('5321234567');
  });

  it('E.164 ayrı biçim', () => {
    expect(toE164TR('05321234567')).toBe('+905321234567');
  });

  it('geçersiz numara null', () => {
    expect(normalizePhoneTR('12345')).toBeNull();
    expect(normalizePhoneTR('')).toBeNull();
  });
});

describe('Posta kodu', () => {
  it('5 hane zorunlu', () => {
    expect(isValidPostalCode('34000')).toBe(true);
    expect(isValidPostalCode('3400')).toBe(false);
    expect(isValidPostalCode('3400a')).toBe(false);
  });
});
