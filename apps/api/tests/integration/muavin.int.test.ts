/**
 * Hesap muavini: devir, alt hesaplar, yürüyen bakiye, karşı hesaplar, ön ek modu, kapanış
 * fişinin dışlanması; fiş detayında kaynak belge özeti.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountingService } from '../../src/modules/accounting/service';
import { accountLedger } from '../../src/modules/accounting/muavin';
import { closeYear } from '../../src/modules/accounting/closing';
import { postVatOffset } from '../../src/modules/accounting/vat';
import { ensureAccountByCode } from '../../src/modules/accounting/subledger';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  integrationEnabled,
  withTenantScope,
  writeEntry,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('Hesap muavini', () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTestTenant();
    await accountingService.withTenantClient(t.tenantId, (c) =>
      ensureAccountByCode(c, '770.01', 'Kira', '770'),
    );
    const e = (lines: Array<{ code: string; debit?: number; credit?: number }>, d: string) =>
      writeEntry(t, lines, { entry_date: d });
    await e([{ code: '100', debit: 5000 }, { code: '500', credit: 5000 }], '2025-01-01');
    await e([{ code: '770', debit: 100 }, { code: '100', credit: 100 }], '2025-01-20');
    await e([{ code: '770.01', debit: 300 }, { code: '100', credit: 300 }], '2025-02-10');
    await e([{ code: '770.01', debit: 200 }, { code: '191', debit: 40 }, { code: '320', credit: 240 }], '2025-03-05');
    await e([{ code: '120', debit: 1200 }, { code: '600', credit: 1000 }, { code: '391', credit: 200 }], '2025-03-06');
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it('alt hesaplarıyla devir + dönem hareketleri + yürüyen bakiye + karşı hesap', async () => {
    const l = await accountLedger({ code: '770', from: '2025-02-01', to: '2025-12-31' }, t.tenantId);
    expect(l.opening.balance).toBe(100);
    expect(l.rows.map((r) => [r.entry_date, r.account_code, r.debit, r.balance])).toEqual([
      ['2025-02-10', '770.01', 300, 400],
      ['2025-03-05', '770.01', 200, 600],
    ]);
    expect(l.rows[1].counter_accounts).toBe('320');
    expect(l.closing).toEqual({ balance: 600, side: 'B' });
    expect(l.total_rows).toBe(2);
  });

  it('ön ek modu (gelir tablosu kalemi) ve kaynak özeti', async () => {
    const l = await accountLedger({ prefix: '77', from: '2025-01-01', to: '2025-12-31' }, t.tenantId);
    expect(l.account.mode).toBe('prefix');
    expect(l.period.debit).toBe(600);
    await postVatOffset(2025, 3, t.userId, t.tenantId);
    const v = await accountLedger({ code: '391', from: '2025-03-01', to: '2025-03-31' }, t.tenantId);
    const offsetRow = v.rows.find((r) => r.source_type === 'vat_offset')!;
    const detail = await withTenantScope(t, () =>
      accountingService.getEntryById(offsetRow.entry_id, t.tenantId),
    );
    expect(detail?.source).toMatchObject({ type: 'vat_offset', label: 'KDV mahsubu' });
    const manual = await accountingService.getEntryById(l.rows[0].entry_id, t.tenantId);
    expect(manual?.source).toBeNull();
  });

  it('kapatılan yılda kapanış fişi dışlanır; istenirse dahil edilir', async () => {
    await closeYear({ fiscal_year: 2025 }, t.userId, t.tenantId);
    const l = await accountLedger({ code: '100', from: '2025-01-01', to: '2025-12-31' }, t.tenantId);
    expect(l.closing.balance).toBe(4600);
    const withClosing = await accountLedger(
      { code: '100', from: '2025-01-01', to: '2025-12-31', include_closing: true },
      t.tenantId,
    );
    expect(withClosing.closing.balance).toBe(0);
    const y26 = await accountLedger({ code: '100', from: '2026-01-01', to: '2026-12-31' }, t.tenantId);
    expect(y26.opening.balance).toBe(0);
    expect(y26.rows[0]).toMatchObject({ entry_type: 'acilis', debit: 4600, entry_no: 1 });
  });

  it('geçersiz kod reddedilir', async () => {
    await expect(accountLedger({ code: "770' OR 1=1" }, t.tenantId)).rejects.toThrow(/rakam/);
    await expect(accountLedger({ code: '999' }, t.tenantId)).rejects.toThrow(/bulunamadı/);
  });
});
