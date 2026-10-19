/**
 * Faz 9-3 — yıl sonu kapanış sihirbazı: 7/A yansıtma, 690/691/692/590, kapanış + açılış,
 * raporların kapanış sonrası doğruluğu, kontrollü geri alma.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { accountingService } from '../../src/modules/accounting/service';
import {
  closeYear,
  previewYearEnd,
  undoYearEnd,
  updateTaxSettings,
} from '../../src/modules/accounting/closing';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  integrationEnabled,
  writeEntry,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('Faz 9-3 — yıl sonu kapanış', () => {
  let t: TestTenant;
  const m = () => getPool('migrator');
  const tax = { kkeg: 1000, deductions: 0 };
  const entries = async () =>
    (
      await m().query(
        `SELECT fiscal_year, entry_no::int AS no, entry_type, source_type, to_char(entry_date, 'YYYY-MM-DD') AS d
           FROM journal_entries WHERE tenant_id = $1 AND status = 'posted' ORDER BY fiscal_year, entry_no`,
        [t.tenantId],
      )
    ).rows as Array<{
      fiscal_year: number;
      no: number;
      entry_type: string;
      source_type: string | null;
      d: string;
    }>;
  /** Hesap bakiyesi; `withClosing` false ise kapanış fişi hariç (kapatılan yılın kapanış öncesi durumu). */
  const balance = async (code: string, until: string, withClosing = true) =>
    Number(
      (
        await m().query(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS b FROM journal_lines l
             JOIN journal_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
            WHERE e.tenant_id = $1 AND e.status = 'posted' AND a.code = $2 AND e.entry_date <= $3
              AND ($4 OR e.entry_type <> 'kapanis')`,
          [t.tenantId, code, until, withClosing],
        )
      ).rows[0].b,
    );

  beforeAll(async () => {
    t = await createTestTenant();
    const e = (
      lines: Array<{ code: string; debit?: number; credit?: number }>,
      d: string,
      type = 'mahsup',
    ) => writeEntry(t, lines, { entry_date: d, entry_type: type as never });
    await e(
      [
        { code: '100', debit: 50000 },
        { code: '500', credit: 50000 },
      ],
      '2025-01-01',
      'acilis',
    );
    await e(
      [
        { code: '120', debit: 120000 },
        { code: '600', credit: 100000 },
        { code: '391', credit: 20000 },
      ],
      '2025-03-10',
    );
    await e(
      [
        { code: '770', debit: 30000 },
        { code: '191', debit: 6000 },
        { code: '320', credit: 36000 },
      ],
      '2025-04-10',
    );
    await e(
      [
        { code: '760', debit: 10000 },
        { code: '100', credit: 10000 },
      ],
      '2025-05-10',
    );
    await e(
      [
        { code: '780', debit: 2000 },
        { code: '100', credit: 2000 },
      ],
      '2025-06-10',
    );
    await e(
      [
        { code: '193', debit: 5000 },
        { code: '100', credit: 5000 },
      ],
      '2025-08-17',
    );
    await e(
      [
        { code: '100', debit: 1000 },
        { code: '642', credit: 1000 },
      ],
      '2025-09-01',
    );
    // yeni yılda kapanıştan ÖNCE girilmiş fiş (kapanış genelde Nisan'da yapılır)
    await e(
      [
        { code: '100', debit: 500 },
        { code: '600', credit: 500 },
      ],
      '2026-01-15',
    );
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it('önizleme: vergi ve fişler hesaplanır, hiçbir şey yazılmaz', async () => {
    const before = await entries();
    const p = await previewYearEnd({ fiscal_year: 2025, tax }, t.userId, t.tenantId);
    expect(p.errors).toEqual([]);
    expect(p.tax).toMatchObject({
      ticari_kar: 59000,
      matrah: 60000,
      rate: 25,
      amount: 15000,
      prepaid_offset: 5000,
      payable: 10000,
    });
    expect(p.net_result).toBe(44000);
    expect(p.reflections.map((r) => [r.source_code, r.target_code, r.amount])).toEqual([
      ['760', '631', 10000],
      ['770', '632', 30000],
      ['780', '660', 2000],
    ]);
    expect(p.entries.map((e) => e.entry_type)).toEqual([
      'donem_sonu',
      'donem_sonu',
      'donem_sonu',
      'donem_sonu',
      'donem_sonu',
      'kapanis',
      'acilis',
    ]);
    expect(p.warnings.join(' ')).toMatch(/KDV hesaplarında bakiye/);
    expect(await entries()).toEqual(before);
  });

  it('taslak fiş varken kapanış yapılamaz', async () => {
    const d = await writeEntry(
      t,
      [
        { code: '100', debit: 1 },
        { code: '600', credit: 1 },
      ],
      {
        entry_date: '2025-12-01',
        status: 'draft',
      },
    );
    await expect(closeYear({ fiscal_year: 2025, tax }, t.userId, t.tenantId)).rejects.toThrow(
      /taslak fiş/,
    );
    await accountingService.deleteEntry(d.id, t.tenantId);
  });

  it('kapanış: 6/7 kapanır, 590 = net kâr, kapanış son madde, açılış yeni yılın 1. maddesi', async () => {
    const r = await closeYear({ fiscal_year: 2025, tax }, t.userId, t.tenantId);
    expect(r.closed).toBe(true);
    expect(await balance('590', '2025-12-31', false)).toBe(-44000);
    expect(await balance('370', '2025-12-31', false)).toBe(-10000);
    expect(await balance('193', '2025-12-31', false)).toBe(0);
    expect(await balance('590', '2025-12-31')).toBe(0); // kapanış fişi sıfırlar
    expect(await balance('590', '2026-01-01')).toBe(-44000); // açılışla geri gelir
    for (const code of [
      '600',
      '642',
      '632',
      '631',
      '660',
      '690',
      '691',
      '692',
      '770',
      '771',
      '760',
    ]) {
      expect(await balance(code, '2025-12-31')).toBe(0);
    }
    const list = await entries();
    const y25 = list.filter((e) => e.fiscal_year === 2025);
    expect(y25.map((e) => e.no)).toEqual(y25.map((_, i) => i + 1));
    expect(y25.at(-1)?.entry_type).toBe('kapanis');
    const y26 = list.filter((e) => e.fiscal_year === 2026);
    expect(y26[0]).toMatchObject({ no: 1, entry_type: 'acilis', d: '2026-01-01' });
    expect(y26[1]).toMatchObject({ no: 2, d: '2026-01-15' });
    const period = await m().query(
      `SELECT status FROM fiscal_periods WHERE tenant_id = $1 AND year = 2025`,
      [t.tenantId],
    );
    expect(period.rows[0].status).toBe('closed');
  });

  it('raporlar kapanıştan sonra doğru: 2025 gelir tablosu, bilanço ve mizan sıfırlanmaz; 2026 açılışla devam eder', async () => {
    const is = await accountingService.incomeStatement(
      { from: '2025-01-01', to: '2025-12-31' },
      t.tenantId,
    );
    expect(is).toMatchObject({
      brutSatislar: 100000,
      faaliyetGiderleri: 40000,
      vergiKarsiligi: 15000,
      maliyetHesaplari7xx: 0,
      donemNetKari: 44000,
    });
    const bs = await accountingService.balanceSheet({ as_of: '2025-12-31' }, t.tenantId);
    expect(bs.balanced).toBe(true);
    expect(bs.aktif.toplam).toBe(160000); // kasa 34.000 + alıcılar 120.000 + 191 KDV 6.000
    expect(bs.pasif.ozKaynaklar).toBe(94000);
    const tb = await accountingService.trialBalance(
      { from: '2025-01-01', to: '2025-12-31' },
      t.tenantId,
    );
    expect(tb.accounts.find((a) => a.code === '100')?.balance).toBe(34000);
    const bs26 = await accountingService.balanceSheet({ as_of: '2026-01-31' }, t.tenantId);
    expect(bs26.balanced).toBe(true);
    expect(bs26.aktif.toplam).toBe(160500);
    expect(bs26.pasif.donemNetKar).toBe(500);
    expect(bs26.pasif.gecmisYillarKarZarari).toBe(0);
  });

  it('kapanış fişleri elle ters çevrilemez; kapanış ikinci kez yapılamaz', async () => {
    const closing = (await entries()).find((e) => e.entry_type === 'kapanis')!;
    const id = (
      await m().query(
        `SELECT id FROM journal_entries WHERE tenant_id = $1 AND fiscal_year = 2025 AND entry_no = $2`,
        [t.tenantId, closing.no],
      )
    ).rows[0].id;
    await expect(accountingService.reverseEntry(id, t.userId, t.tenantId)).rejects.toThrow();
    await expect(closeYear({ fiscal_year: 2025, tax }, t.userId, t.tenantId)).rejects.toThrow(
      /zaten yapılmış/,
    );
  });

  it('geri al: fişler kalkar, dönem açılır, yeni yıl numaraları eski haline döner', async () => {
    const r = await undoYearEnd(2025, t.userId, t.tenantId);
    expect(r.removed_entries).toBe(7);
    const list = await entries();
    expect(list.filter((e) => e.source_type?.startsWith('year_end_'))).toEqual([]);
    expect(list.filter((e) => e.fiscal_year === 2026)).toEqual([
      expect.objectContaining({ no: 1, d: '2026-01-15' }),
    ]);
    expect(await balance('770', '2025-12-31')).toBe(30000);
  });

  it('şirket vergi ayarı + virman: oran ayardan gelir, 590→570 açılış günü virmanlanır', async () => {
    await updateTaxSettings(
      { taxpayer_type: 'kurumlar', corporate_tax_rate: 20 },
      t.userId,
      t.tenantId,
    );
    const r = await closeYear(
      { fiscal_year: 2025, tax, transfer_result: true },
      t.userId,
      t.tenantId,
    );
    expect(r.tax).toMatchObject({ rate: 20, amount: 12000 });
    expect(r.net_result).toBe(47000);
    expect(await balance('570', '2026-01-01')).toBe(-47000);
    expect(await balance('590', '2026-01-01')).toBe(0);
  });

  it('kapanıştan sonra yeni yılda fiş girildiyse geri alma engellenir', async () => {
    await writeEntry(
      t,
      [
        { code: '100', debit: 10 },
        { code: '600', credit: 10 },
      ],
      { entry_date: '2026-02-01' },
    );
    await expect(undoYearEnd(2025, t.userId, t.tenantId)).rejects.toThrow(/geri alınamaz/);
  });
});
