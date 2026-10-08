import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  divMoney,
  formatMoneyTR,
  isZeroMoney,
  mulMoney,
  subMoney,
} from '../src/money';

describe('money — decimal.js, number yasak (SPEC §0.3)', () => {
  it('0.1 + 0.2 = 0.3 (Faz 0 kabul kriteri)', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.30000000');
  });

  it('scale 8 (NUMERIC(20,8)) korunur', () => {
    expect(addMoney('1.5', '2.25')).toBe('3.75000000');
    expect(subMoney('10', '0.00000001')).toBe('9.99999999');
    expect(mulMoney('1.1', '3')).toBe('3.30000000');
    expect(divMoney('1', '3')).toBe('0.33333333');
    expect(divMoney('10', '4')).toBe('2.50000000');
  });

  it('JS number girişi reddedilir (float yasak)', () => {
    expect(() => addMoney(0.1 as unknown as string, '0.2')).toThrow(TypeError);
    expect(() => subMoney('1', 2 as unknown as string)).toThrow(TypeError);
  });

  it('geçersiz string reddedilir', () => {
    expect(() => addMoney('abc', '1')).toThrow(TypeError);
    expect(() => addMoney('1,5', '1')).toThrow(TypeError);
  });

  it('sıfıra bölme reddedilir', () => {
    expect(() => divMoney('1', '0')).toThrow(RangeError);
  });

  it('karşılaştırma ve sıfır kontrolü', () => {
    expect(compareMoney('1.00', '1')).toBe(0);
    expect(compareMoney('0.99', '1')).toBe(-1);
    expect(compareMoney('1.01', '1')).toBe(1);
    expect(isZeroMoney('0.00000000')).toBe(true);
  });

  it('tr-TR biçim: 1.234,56 ₺ (README §10)', () => {
    expect(formatMoneyTR('1234.56')).toBe('₺1.234,56');
    expect(formatMoneyTR('0')).toBe('₺0,00');
  });
});
