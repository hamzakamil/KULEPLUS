import { describe, expect, it } from 'vitest';
import { normalizeText, trCollator, trCompare, trLower, trUpper } from '../src/tr';

describe('tr — SPEC §3.1 (Faz 0 kabul kriteri)', () => {
  it('toLocaleUpperCase(tr-TR): "i" → "İ", "ı" → "I"', () => {
    expect(trUpper('i')).toBe('İ');
    expect(trUpper('ı')).toBe('I');
    expect(trUpper('istanbul')).toBe('İSTANBUL');
    expect(trUpper('ılık')).toBe('ILIK');
  });

  it('tr-TR lowercase tersine çalışır', () => {
    expect(trLower('İ')).toBe('i');
    expect(trLower('I')).toBe('ı');
  });

  it('NFC normalizasyonu yapar', () => {
    const decomposed = 'é'; // e + combining acute
    expect(normalizeText(decomposed)).toBe('é');
    expect(normalizeText(decomposed).length).toBe(1);
  });

  it('tr-TR collator ile sıralama: ı, i', () => {
    const sorted = ['i', 'ı'].sort((a, b) => trCollator().compare(a, b));
    expect(sorted).toEqual(['ı', 'i']);
  });

  it('trCompare temel sıralama', () => {
    expect(trCompare('abc', 'abd')).toBe(-1);
    expect(trCompare('abd', 'abc')).toBe(1);
    expect(trCompare('kelime', 'kelime')).toBe(0);
  });
});
