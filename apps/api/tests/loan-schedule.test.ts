import { describe, expect, it } from 'vitest';
import {
  addMonths,
  buildLoanSchedule,
  calculateInstallmentAmount,
} from '../src/modules/cash-bank/loan-schedule';

describe('addMonths', () => {
  it('ay sonunu taşırmadan kırpar', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('calculateInstallmentAmount', () => {
  it('faizsiz kredide anaparayı taksit sayısına böler (yukarı yuvarlar)', () => {
    expect(calculateInstallmentAmount(12000, 0, 12)).toBe(1000);
    expect(calculateInstallmentAmount(1000, 0, 3)).toBe(333.34);
  });
});

describe('buildLoanSchedule', () => {
  it('faizsiz planda taksitler anaparayı tam kapatır', () => {
    const rows = buildLoanSchedule({
      principal: 12000,
      interestRate: 0,
      totalInstallments: 12,
      startDate: '2026-10-27',
    });

    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({
      installmentNo: 1,
      dueDate: '2026-11-27',
      amount: 1000,
      principalAmount: 1000,
      interestAmount: 0,
    });
    expect(rows.reduce((sum, r) => sum + r.principalAmount, 0)).toBe(12000);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(12000);
    expect(rows[11].dueDate).toBe('2027-10-27');
  });

  it('faizli planda anapara toplamı korunur, faiz ayrıştırılır', () => {
    const rows = buildLoanSchedule({
      principal: 100000,
      interestRate: 2.5,
      totalInstallments: 12,
      startDate: '2026-10-01',
    });

    const totalPrincipal = Math.round(
      rows.reduce((sum, r) => sum + r.principalAmount, 0) * 100,
    );
    const totalInterest = rows.reduce((sum, r) => sum + r.interestAmount, 0);

    expect(rows).toHaveLength(12);
    expect(totalPrincipal).toBe(10000000);
    expect(rows[0].interestAmount).toBe(2500);
    expect(totalInterest).toBeGreaterThan(0);
    expect(rows[11].amount).toBeLessThan(rows[0].amount + 1);
  });

  it('elle girilen taksit tutarını kullanır ve son taksitte denkleştirir', () => {
    const rows = buildLoanSchedule({
      principal: 10000,
      interestRate: 0,
      totalInstallments: 4,
      installmentAmount: 3000,
      startDate: '2026-10-27',
    });

    expect(rows.map((r) => r.amount)).toEqual([3000, 3000, 3000, 1000]);
    expect(rows.reduce((sum, r) => sum + r.principalAmount, 0)).toBe(10000);
  });

  it('vade günlerini başlangıç tarihinden itibaren aylık üretir', () => {
    const rows = buildLoanSchedule({
      principal: 3000,
      interestRate: 0,
      totalInstallments: 3,
      startDate: '2026-01-31',
    });

    expect(rows.map((r) => r.dueDate)).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });
});
