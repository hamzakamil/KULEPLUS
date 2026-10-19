/**
 * Faz 9-2 — aylık KDV mahsup fişi: 391 B / 191 A / 190 A / 360.02 A; 191 fazlası 190'a devreder.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { postVatOffset, previewVatOffset } from '../../src/modules/accounting/vat';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  integrationEnabled,
  writeEntry,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('Faz 9-2 — KDV mahsup fişi', () => {
  let t: TestTenant;
  const m = () => getPool('migrator');
  const sale = (date: string, vat: number) =>
    writeEntry(
      t,
      [
        { code: '120', debit: vat * 6 },
        { code: '600', credit: vat * 5 },
        { code: '391', credit: vat },
      ],
      { entry_date: date },
    );
  const purchase = (date: string, vat: number) =>
    writeEntry(
      t,
      [
        { code: '153', debit: vat * 5 },
        { code: '191', debit: vat },
        { code: '320', credit: vat * 6 },
      ],
      { entry_date: date },
    );
  const balance = async (code: string, until: string) =>
    Number(
      (
        await m().query(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS b FROM journal_lines l
             JOIN journal_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
            WHERE e.tenant_id = $1 AND e.status = 'posted' AND a.code = $2 AND e.entry_date <= $3`,
          [t.tenantId, code, until],
        )
      ).rows[0].b,
    );
  const lineMap = (lines: Array<{ account_code: string; debit: number; credit: number }>) =>
    Object.fromEntries(lines.map((l) => [l.account_code, l.debit - l.credit]));

  beforeAll(async () => {
    t = await createTestTenant();
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it('391 > 191: fark 360.02 Ödenecek KDV; hesaplar sıfırlanır; aynı ay ikinci fiş engellenir', async () => {
    await sale('2026-01-10', 2000);
    await purchase('2026-01-15', 500);
    const p = await previewVatOffset(2026, 1, t.tenantId);
    expect(p).toMatchObject({
      entry_date: '2026-01-31',
      hesaplanan_kdv: 2000,
      indirilecek_kdv: 500,
      odenecek_kdv: 1500,
      devreden_sonraki: 0,
    });
    expect(lineMap(p.lines)).toEqual({ '391': 2000, '191': -500, '360.02': -1500 });
    const posted = await postVatOffset(2026, 1, t.userId, t.tenantId);
    expect(posted.entry_no).toBeGreaterThan(0);
    expect(await balance('391', '2026-01-31')).toBe(0);
    expect(await balance('191', '2026-01-31')).toBe(0);
    expect(await balance('360.02', '2026-01-31')).toBe(-1500);
    await expect(postVatOffset(2026, 1, t.userId, t.tenantId)).rejects.toThrow(/zaten var/);
    expect((await previewVatOffset(2026, 1, t.tenantId)).existing_entry?.id).toBe(posted.entry_id);
  });

  it('191 > 391: fark 190 Devreden KDV borcuna; sonraki ay önce devreden kullanılır', async () => {
    await sale('2026-02-10', 400);
    await purchase('2026-02-12', 1000);
    const feb = await postVatOffset(2026, 2, t.userId, t.tenantId);
    expect(lineMap(feb.lines)).toEqual({ '391': 400, '191': -1000, '190': 600 });
    expect(feb.devreden_sonraki).toBe(600);

    await sale('2026-03-05', 1000);
    await purchase('2026-03-06', 100);
    const mar = await previewVatOffset(2026, 3, t.tenantId);
    expect(mar).toMatchObject({ devreden_onceki: 600, odenecek_kdv: 300, devreden_sonraki: 0 });
    expect(lineMap(mar.lines)).toEqual({ '391': 1000, '191': -100, '190': -600, '360.02': -300 });
    await postVatOffset(2026, 3, t.userId, t.tenantId);
    expect(await balance('190', '2026-03-31')).toBe(0);
  });

  it('mahsup edilmemiş önceki ay uyarılır ve bakiyesi fişe girer', async () => {
    await sale('2026-04-10', 100);
    await sale('2026-05-10', 200);
    const may = await previewVatOffset(2026, 5, t.tenantId);
    expect(may.hesaplanan_kdv).toBe(300);
    expect(may.warnings.join(' ')).toMatch(/2026-04/);
  });

  it('bakiye yoksa fiş kesilmez', async () => {
    await postVatOffset(2026, 5, t.userId, t.tenantId); // Nisan + Mayıs birlikte kapanır
    await expect(postVatOffset(2026, 6, t.userId, t.tenantId)).rejects.toThrow(/bakiyesi yok/);
  });
});
