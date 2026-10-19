/**
 * Resmî defterler: yevmiye defteri (kapanış/açılış dahil, mali yıl + madde sırası) ve defter-i kebir
 * (devir, yürüyen bakiye, ana hesap toplulaştırma), CSV çıktıları.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountingService } from '../../src/modules/accounting/service';
import {
  generalLedger,
  generalLedgerCsv,
  journalBook,
  journalBookCsv,
} from '../../src/modules/accounting/books';
import { closeYear } from '../../src/modules/accounting/closing';
import { ensureAccountByCode } from '../../src/modules/accounting/subledger';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  integrationEnabled,
  writeEntry,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('Yevmiye defteri ve defter-i kebir', () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTestTenant();
    await accountingService.withTenantClient(t.tenantId, (c) =>
      ensureAccountByCode(c, '320.01', 'Tedarikçi A', '320'),
    );
    const e = (lines: Array<{ code: string; debit?: number; credit?: number }>, d: string) =>
      writeEntry(t, lines, { entry_date: d });
    await e(
      [
        { code: '100', debit: 5000 },
        { code: '500', credit: 5000 },
      ],
      '2025-01-01',
    );
    await e(
      [
        { code: '770', debit: 200 },
        { code: '191', debit: 40 },
        { code: '320.01', credit: 240 },
      ],
      '2025-03-05',
    );
    await e(
      [
        { code: '320.01', debit: 100 },
        { code: '100', credit: 100 },
      ],
      '2025-04-05',
    );
    await e(
      [
        { code: '120', debit: 600 },
        { code: '600', credit: 500 },
        { code: '391', credit: 100 },
      ],
      '2025-05-05',
    );
    await e(
      [
        { code: '100', debit: 10 },
        { code: '600', credit: 10 },
      ],
      '2026-01-10',
    );
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it('yevmiye defteri: madde sırası, satırlar, toplam borç = alacak', async () => {
    const b = await journalBook({ from: '2025-01-01', to: '2025-12-31' }, t.tenantId);
    expect(b.entries.map((e) => e.entry_no)).toEqual([1, 2, 3, 4]);
    expect(b.entries[1].lines.map((l) => l.account_code)).toEqual(['770', '191', '320.01']);
    expect(b.total_debit).toBe(b.total_credit);
    expect(b.truncated).toBe(false);
  });

  it("kapanıştan sonra defter kapanış ve açılış fişlerini de içerir; yıl başına 1'den", async () => {
    await closeYear({ fiscal_year: 2025, tax: { kkeg: 0, deductions: 0 } }, t.userId, t.tenantId);
    const y25 = await journalBook({ from: '2025-01-01', to: '2025-12-31' }, t.tenantId);
    expect(y25.entries.at(-1)?.entry_type).toBe('kapanis');
    expect(y25.total_debit).toBe(y25.total_credit);
    const y26 = await journalBook({ from: '2026-01-01', to: '2026-12-31' }, t.tenantId);
    expect(y26.entries[0]).toMatchObject({ entry_no: 1, entry_type: 'acilis' });
    const both = await journalBook({ from: '2025-01-01', to: '2026-12-31' }, t.tenantId);
    expect(both.entries.map((e) => `${e.fiscal_year}/${e.entry_no}`).slice(-2)).toEqual([
      '2026/1',
      '2026/2',
    ]);
  });

  it('defter-i kebir: devir + hareket + yürüyen bakiye; kapanış sonrası 2026 devri açılış fişinden', async () => {
    const g = await generalLedger(
      { from: '2025-04-01', to: '2025-04-30', code_prefix: '320' },
      t.tenantId,
    );
    expect(g.accounts.map((a) => a.code)).toEqual(['320.01']);
    const a = g.accounts[0];
    expect(a.opening).toMatchObject({ credit: 240, balance: -240 });
    expect(a.rows.map((r) => [r.debit, r.balance])).toEqual([[100, -140]]);
    expect(a.closing).toEqual({ balance: -140, side: 'A' });

    const k = await generalLedger(
      { from: '2026-01-01', to: '2026-12-31', code_prefix: '100' },
      t.tenantId,
    );
    expect(k.accounts[0].opening.balance).toBe(0);
    expect(k.accounts[0].rows[0]).toMatchObject({ entry_no: 1, debit: 4900 });
  });

  it('ana hesap düzeyi alt hesapları toplar; adı ana hesaptan gelir', async () => {
    const g = await generalLedger(
      { from: '2025-01-01', to: '2025-12-31', level: 'main', code_prefix: '320' },
      t.tenantId,
    );
    expect(g.accounts).toHaveLength(1);
    expect(g.accounts[0].code).toBe('320');
    expect(g.accounts[0].name).not.toMatch(/Tedarikçi A/);
    expect(g.accounts[0].period).toMatchObject({ debit: 240, credit: 240 }); // 100 ödeme + 140 kapanış;
  });

  it('CSV: BOM, noktalı virgül, virgüllü ondalık, toplam satırı', async () => {
    const c = await journalBookCsv({ from: '2025-01-01', to: '2025-03-31' }, t.tenantId);
    expect(c.startsWith('﻿Mali Yıl;Madde No;')).toBe(true);
    expect(c).toContain('5000,00');
    expect(c).toContain('TOPLAM');
    const k = await generalLedgerCsv(
      { from: '2025-01-01', to: '2025-03-31', code_prefix: '100' },
      t.tenantId,
    );
    expect(k).toContain('DEVİR');
    expect(k).toContain('DÖNEM TOPLAMI');
  });

  it('geçersiz giriş reddedilir', async () => {
    await expect(journalBook({ from: '2026-02-01', to: '2026-01-01' }, t.tenantId)).rejects.toThrow(
      /sonra olamaz/,
    );
    await expect(generalLedger({ code_prefix: "1' OR 1" }, t.tenantId)).rejects.toThrow(/rakam/);
  });
});
