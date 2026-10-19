/**
 * Faz 9-1 — yevmiye madde numarası her mali yılda 1'den başlar; "Yeniden sırala" numaraları
 * tarih sırasına dizer, kilitli kısma dokunmaz; kilit konurken otomatik çalışır.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { accountingService } from '../../src/modules/accounting/service';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  integrationEnabled,
  periodIdByYear,
  writeEntry,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('Faz 9-1 — yıl bazlı madde numarası', () => {
  let t: TestTenant;
  const m = () => getPool('migrator');
  const lines = [
    { code: '100', debit: 10 },
    { code: '600', credit: 10 },
  ];
  const post = (entry_date: string, entry_type = 'mahsup') =>
    writeEntry(t, lines, { entry_date, entry_type: entry_type as never }) as Promise<{
      id: string;
    }>;
  const numbers = async (year: number) =>
    (
      await m().query(
        `SELECT to_char(entry_date, 'YYYY-MM-DD') AS d, entry_type, entry_no::int AS no
           FROM journal_entries WHERE tenant_id = $1 AND fiscal_year = $2 AND entry_no IS NOT NULL
          ORDER BY entry_no`,
        [t.tenantId, year],
      )
    ).rows as Array<{ d: string; entry_type: string; no: number }>;

  beforeAll(async () => {
    t = await createTestTenant();
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it("her mali yıl 1'den başlar; fiscal_year dönemden gelir", async () => {
    await post('2025-12-30');
    await post('2025-12-31');
    await post('2026-01-02');
    await post('2026-01-03');
    expect((await numbers(2025)).map((r) => r.no)).toEqual([1, 2]);
    expect((await numbers(2026)).map((r) => r.no)).toEqual([1, 2]);
    expect(await accountingService.getNextEntryNo(t.tenantId, 2026)).toBe(3);
  });

  it('geriye tarihli fiş onayda sonraki numarayı alır; "Yeniden sırala" tarih sırasına dizer', async () => {
    await post('2026-01-01', 'acilis');
    await post('2026-01-02'); // aynı gün: açılış öne, olağan arkaya
    expect((await numbers(2026)).map((r) => r.d)).toEqual([
      '2026-01-02',
      '2026-01-03',
      '2026-01-01',
      '2026-01-02',
    ]);
    const res = await accountingService.resequenceYear(2026, t.userId, t.tenantId);
    expect(res.changed).toBeGreaterThan(0);
    const after = await numbers(2026);
    expect(after.map((r) => r.no)).toEqual([1, 2, 3, 4]);
    expect(after.map((r) => r.d)).toEqual(['2026-01-01', '2026-01-02', '2026-01-02', '2026-01-03']);
    expect(after[0].entry_type).toBe('acilis');
    // ikinci kez çalıştırmak bir şey değiştirmez
    expect((await accountingService.resequenceYear(2026, t.userId, t.tenantId)).changed).toBe(0);
  });

  it('dönem kapatılırken numaralar sıralanır; kapalı yılda yeniden sıralama reddedilir', async () => {
    await post('2025-06-01'); // 2025'e geriye tarihli → 3 numara, ama tarih olarak ilk
    const p2025 = await periodIdByYear(t, 2025);
    await accountingService.updatePeriod(
      p2025,
      { status: 'closed' } as never,
      t.userId,
      t.tenantId,
    );
    expect((await numbers(2025)).map((r) => [r.no, r.d])).toEqual([
      [1, '2025-06-01'],
      [2, '2025-12-30'],
      [3, '2025-12-31'],
    ]);
    await expect(accountingService.resequenceYear(2025, t.userId, t.tenantId)).rejects.toThrow(
      /Kapatılmış mali yıl/,
    );
  });
  it('kilit konurken kilitlenen aralık sıralanır; sonra kilitli numaralar değişmez', async () => {
    await post('2026-02-10');
    await post('2026-02-05'); // geriye tarihli
    await accountingService.createLock(
      {
        period_id: await periodIdByYear(t, 2026),
        lock_date: '2026-02-28',
        reason: 'Şubat',
      } as never,
      t.userId,
      t.tenantId,
    );
    const locked = await numbers(2026);
    expect(locked.map((r) => r.d).slice(4)).toEqual(['2026-02-05', '2026-02-10']);
    expect(locked.map((r) => r.no)).toEqual([1, 2, 3, 4, 5, 6]);

    await post('2026-03-20');
    await post('2026-03-10');
    await accountingService.resequenceYear(2026, t.userId, t.tenantId);
    const after = await numbers(2026);
    // kilitli 6 fiş yerinde; kilit sonrası 7–8 tarih sırasıyla
    expect(after.slice(0, 6)).toEqual(locked);
    expect(after.slice(6).map((r) => [r.no, r.d])).toEqual([
      [7, '2026-03-10'],
      [8, '2026-03-20'],
    ]);
  });
});
