/**
 * Muhasebe çekirdeği — GERÇEK PostgreSQL'e karşı "kırmızı" testler.
 *
 * Bu testler doğru davranışı tanımlar; düzeltmeler gelene kadar BAŞARISIZ olması
 * beklenir (A-numaraları: muhasebe çekirdeği denetim raporu). İlgili faz bitince yeşile döner.
 * `INTEGRATION_DB=1` yoksa atlanır (bkz. db-harness.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import { InvoiceService } from '../../src/modules/trade/invoice/service';
import { accountingService } from '../../src/modules/accounting/service';
import { openPeriodFor } from '../../src/modules/accounting/ledger';
import {
  accountId,
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  integrationEnabled,
  grantAccounting,
  withTenantScope,
  periodRow,
  periodIdByYear,
  writeEntry,
  type TestTenant,
} from './db-harness';

afterAll(async () => {
  if (integrationEnabled) await closeAllPools();
});

type EntryDetail = {
  status: string;
  entry_no: number | null;
  entry_type: string;
  reversal_of_id: string | null;
  posted_by: string | null;
  lines: Array<{ account_code?: string; debit: number; credit: number }>;
};

describe.skipIf(!integrationEnabled)('Faz 1 — fiş yaşam döngüsü (A1–A3)', () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTestTenant();
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
  });

  it('A1: ters kayıt çalışır; borç/alacak yer değiştirir, tipi "ters", reversal_of_id bağlı', async () => {
    const e = await writeEntry(t, [
      { code: '100', debit: 100 },
      { code: '600', credit: 100 },
    ]);
    const rev = await accountingService.reverseEntry(e.id, t.userId, t.tenantId);
    const detail = (await accountingService.getEntryById(rev.id, t.tenantId)) as EntryDetail | null;
    expect(detail?.entry_type).toBe('ters');
    expect(detail?.reversal_of_id).toBe(e.id);
    const kasa = detail?.lines.find((l) => l.account_code === '100');
    expect(kasa?.credit).toBe(100);
    expect(kasa?.debit).toBe(0);
  });

  it('A1b: aynı fiş ikinci kez ters çevrilemez', async () => {
    const e = await writeEntry(t, [
      { code: '100', debit: 50 },
      { code: '600', credit: 50 },
    ]);
    await accountingService.reverseEntry(e.id, t.userId, t.tenantId);
    await expect(accountingService.reverseEntry(e.id, t.userId, t.tenantId)).rejects.toThrow();
  });

  it('A2: taslak fiş güncellenip onaylanabilir ve gap-free numara alır', async () => {
    const draft = await writeEntry(
      t,
      [
        { code: '100', debit: 70 },
        { code: '600', credit: 70 },
      ],
      { status: 'draft' },
    );
    const updated = (await accountingService.updateEntry(
      draft.id,
      {
        status: 'posted',
        lines: [
          { account_id: await accountId(t, '100'), debit: 70, credit: 0 },
          { account_id: await accountId(t, '600'), debit: 0, credit: 70 },
        ],
      } as never,
      t.userId,
      t.tenantId,
    )) as EntryDetail | null;
    expect(updated?.status).toBe('posted');
    expect(updated?.entry_no).not.toBeNull();
    expect(updated?.posted_by).toBe(t.userId);
  });

  it('A1c: ters fiş yeniden ters çevrilemez; ters fiş istenen tarihte yazılır', async () => {
    const e = await writeEntry(t, [
      { code: '100', debit: 40 },
      { code: '600', credit: 40 },
    ]);
    const rev = await accountingService.reverseEntry(e.id, t.userId, t.tenantId, '2026-04-01');
    const detail = (await accountingService.getEntryById(rev.id, t.tenantId)) as EntryDetail & {
      entry_date: Date;
    };
    expect(detail.entry_date.getMonth()).toBe(3);
    await expect(accountingService.reverseEntry(rev.id, t.userId, t.tenantId)).rejects.toThrow();
  });

  it('A2b: postEntry taslağı onaylar; dengesiz taslak onaylanamaz', async () => {
    const ok = await writeEntry(
      t,
      [
        { code: '100', debit: 15 },
        { code: '600', credit: 15 },
      ],
      { status: 'draft' },
    );
    const posted = (await accountingService.postEntry(ok.id, t.userId, t.tenantId)) as EntryDetail;
    expect(posted.status).toBe('posted');
    expect(posted.entry_no).not.toBeNull();

    const bad = await writeEntry(
      t,
      [
        { code: '100', debit: 15 },
        { code: '600', credit: 10 },
      ],
      { status: 'draft' },
    );
    await expect(accountingService.postEntry(bad.id, t.userId, t.tenantId)).rejects.toThrow(
      /dengeli degil/,
    );
  });

  it('A3: DB, dengesiz onaylı fişi (doğrudan INSERT dahil) kabul etmez', async () => {
    const m = await getPool('migrator').connect();
    const entryId = newId();
    try {
      await m.query('BEGIN');
      await m.query(
        `INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, status, description, total_debit, total_credit)
         VALUES ($1, $2, 900001, '2026-03-15', 'posted', 'dengesiz', 100, 100)`,
        [entryId, t.tenantId],
      );
      await m.query(
        `INSERT INTO journal_lines (id, tenant_id, entry_id, line_no, account_id, debit, credit)
         VALUES ($1, $2, $3, 1, $4, 100, 0), ($5, $2, $3, 2, $6, 0, 50)`,
        [
          newId(),
          t.tenantId,
          entryId,
          await accountId(t, '100'),
          newId(),
          await accountId(t, '600'),
        ],
      );
      await expect(m.query('COMMIT')).rejects.toThrow();
    } finally {
      await m.query('ROLLBACK').catch(() => undefined);
      m.release();
    }
  });

  it('A3b: başlık toplamı satır toplamından farklıysa DB reddeder', async () => {
    const m = await getPool('migrator').connect();
    const entryId = newId();
    try {
      await m.query('BEGIN');
      await m.query(
        `INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, status, description, total_debit, total_credit)
         VALUES ($1, $2, 900002, '2026-03-15', 'posted', 'başlık yanlış', 999, 999)`,
        [entryId, t.tenantId],
      );
      await m.query(
        `INSERT INTO journal_lines (id, tenant_id, entry_id, line_no, account_id, debit, credit)
         VALUES ($1, $2, $3, 1, $4, 100, 0), ($5, $2, $3, 2, $6, 0, 100)`,
        [
          newId(),
          t.tenantId,
          entryId,
          await accountId(t, '100'),
          newId(),
          await accountId(t, '600'),
        ],
      );
      await expect(m.query('COMMIT')).rejects.toThrow();
    } finally {
      await m.query('ROLLBACK').catch(() => undefined);
      m.release();
    }
  });

  it('N1: create* uçları oluşturulan kaydı döndürür (iç içe bağlantı yüzünden null dönmemeli)', async () => {
    const period = await accountingService.createPeriod(
      {
        label: '2030',
        year: 2030,
        start_date: '2030-01-01',
        end_date: '2030-12-31',
        status: 'open',
      },
      t.userId,
      t.tenantId,
    );
    expect(period).not.toBeNull();
  });

  it('float: 0,1 + 0,2 borç = 0,3 alacak olan geçerli fiş reddedilmez', async () => {
    const e = await writeEntry(t, [
      { code: '100', debit: 0.1 },
      { code: '102', debit: 0.2 },
      { code: '600', credit: 0.3 },
    ]);
    expect(e.status).toBe('posted');
  });
});

describe.skipIf(!integrationEnabled)('Faz 3 — dönem kilidi (A7)', () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTestTenant();
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
  });

  it('A7: kilit tarihi öncesi tarihli kayıt, hangi dönemde olursa olsun reddedilir (tenant geneli)', async () => {
    await accountingService.createPeriod(
      {
        label: '2026',
        year: 2026,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        status: 'open',
      },
      t.userId,
      t.tenantId,
    );
    await accountingService.createPeriod(
      {
        label: '2027',
        year: 2027,
        start_date: '2027-01-01',
        end_date: '2027-12-31',
        status: 'open',
      },
      t.userId,
      t.tenantId,
    );
    await accountingService.createLock(
      { period_id: await periodIdByYear(t, 2026), lock_date: '2027-03-01', reason: 'IT' },
      t.userId,
      t.tenantId,
    );
    await expect(
      writeEntry(
        t,
        [
          { code: '100', debit: 10 },
          { code: '600', credit: 10 },
        ],
        { entry_date: '2027-02-01' },
      ),
    ).rejects.toThrow(/kilit|PERIOD_LOCKED|dönem/i);
  });
});

describe.skipIf(!integrationEnabled)('Faz 4 — raporlar (A5, A6)', () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTestTenant();
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
  });

  it('A5: gelir tablosu satış iadesi/ters hareketleri net hesaplar (100 satış − 30 iade = 70)', async () => {
    await writeEntry(t, [
      { code: '120', debit: 100 },
      { code: '600', credit: 100 },
    ]);
    await writeEntry(t, [
      { code: '600', debit: 30 },
      { code: '120', credit: 30 },
    ]);
    const r = await accountingService.incomeStatement(
      { from: '2026-01-01', to: '2026-12-31' },
      t.tenantId,
    );
    expect(r.brutSatislar).toBe(70);
  });

  it('A6: mizan hesap açılış bakiyelerini içerir', async () => {
    const acc = await accountingService.getAccountById(await accountId(t, '100'), t.tenantId);
    await accountingService.updateAccount(
      String((acc as { id: string }).id),
      { opening_debit: 500 },
      t.userId,
      t.tenantId,
    );
    const sermaye = await accountingService.getAccountById(await accountId(t, '500'), t.tenantId);
    await accountingService.updateAccount(
      String((sermaye as { id: string }).id),
      { opening_credit: 500 },
      t.userId,
      t.tenantId,
    );
    const tb = await accountingService.trialBalance(
      { from: '2026-01-01', to: '2026-12-31' },
      t.tenantId,
    );
    const kasa = tb.accounts.find((a) => a.code === '100');
    expect(kasa?.debit).toBeGreaterThanOrEqual(500);
    expect(tb.balanced).toBe(true);
  });
});

describe.skipIf(!integrationEnabled)('Faz 3 — dönem yönetimi (A7 devamı)', () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTestTenant();
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
  });

  const period = (year: number, extra: Record<string, unknown> = {}) => ({
    label: String(year),
    year,
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    status: 'open' as const,
    ...extra,
  });

  it('dönem tanımlı değilse o yıl için otomatik açılır ve fişe period_id yazılır', async () => {
    const e = await writeEntry(
      t,
      [
        { code: '100', debit: 5 },
        { code: '600', credit: 5 },
      ],
      { entry_date: '2025-06-10' },
    );
    const row = await periodRow(t, 2025);
    expect(row?.status).toBe('open');
    const detail = (await accountingService.getEntryById(e.id, t.tenantId)) as unknown as {
      period_id: string;
    };
    expect(detail.period_id).toBe(row?.id);
  });

  it('kapalı döneme onaylı fiş yazılamaz; yeniden açılınca yazılır', async () => {
    await accountingService.createPeriod(period(2024), t.userId, t.tenantId);
    const p = await periodRow(t, 2024);
    await accountingService.updatePeriod(p!.id, { status: 'closed' }, t.userId, t.tenantId);
    const lines = [
      { code: '100', debit: 9 },
      { code: '600', credit: 9 },
    ];
    await expect(writeEntry(t, lines, { entry_date: '2024-05-05' })).rejects.toThrow(/kapatıl/i);
    await accountingService.updatePeriod(p!.id, { status: 'open' }, t.userId, t.tenantId);
    await expect(writeEntry(t, lines, { entry_date: '2024-05-05' })).resolves.toBeTruthy();
  });

  it('taslak fişi olan dönem kapatılamaz', async () => {
    await accountingService.createPeriod(period(2023), t.userId, t.tenantId);
    await writeEntry(
      t,
      [
        { code: '100', debit: 3 },
        { code: '600', credit: 3 },
      ],
      { entry_date: '2023-02-02', status: 'draft' },
    );
    const p = await periodRow(t, 2023);
    await expect(
      accountingService.updatePeriod(p!.id, { status: 'closed' }, t.userId, t.tenantId),
    ).rejects.toThrow(/taslak/i);
  });

  it('çakışan veya ters tarihli dönem tanımlanamaz', async () => {
    await accountingService.createPeriod(period(2022), t.userId, t.tenantId);
    await expect(
      accountingService.createPeriod(
        period(2021, { start_date: '2021-06-01', end_date: '2022-03-31' }),
        t.userId,
        t.tenantId,
      ),
    ).rejects.toThrow(/çakış/i);
    await expect(
      accountingService.createPeriod(
        period(2020, { start_date: '2020-12-31', end_date: '2020-01-01' }),
        t.userId,
        t.tenantId,
      ),
    ).rejects.toThrow(/başlangıcı/i);
  });

  it('fişi olan dönem silinemez ve tarih aralığı değiştirilemez; boş dönem silinir', async () => {
    const p2024 = await periodRow(t, 2024); // önceki testte fiş yazıldı
    await expect(accountingService.deletePeriod(p2024!.id, t.tenantId, t.userId)).rejects.toThrow(
      /silinemez/i,
    );
    await expect(
      accountingService.updatePeriod(p2024!.id, { end_date: '2024-11-30' }, t.userId, t.tenantId),
    ).rejects.toThrow(/değiştirilemez/i);
    await accountingService.createPeriod(period(2019), t.userId, t.tenantId);
    const p2019 = await periodRow(t, 2019);
    await expect(accountingService.deletePeriod(p2019!.id, t.tenantId, t.userId)).resolves.toEqual({
      success: true,
    });
  });

  it('dönem ve kilit işlemleri audit_logs’a yazılır', async () => {
    const r = await getPool('migrator').query(
      `SELECT action FROM audit_logs WHERE tenant_id = $1 AND entity_type IN ('fiscal_periods','period_locks')`,
      [t.tenantId],
    );
    const actions = r.rows.map((x) => x.action as string);
    expect(actions).toContain('fiscal_periods.create');
    expect(actions).toContain('fiscal_periods.status_closed');
    expect(actions).toContain('fiscal_periods.status_open');
  });

  it('aynı hesap kodu tekrar eklenince 500 değil CONFLICT döner', async () => {
    await expect(
      accountingService.createAccount(
        {
          code: '100',
          name: 'MÜKERRER',
          type: 'detail',
          is_tdphp: false,
          is_active: true,
          opening_debit: 0,
          opening_credit: 0,
        },
        t.userId,
        t.tenantId,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('ortak dönem kapısı (çek / kur değerleme fişleri de bunu kullanır) kilit tarihini uygular', async () => {
    const p = await periodRow(t, 2024);
    await accountingService.createLock(
      { period_id: p!.id, lock_date: '2024-07-01', reason: 'IT' },
      t.userId,
      t.tenantId,
    );
    const client = await getPool('migrator').connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [t.tenantId]);
      await expect(openPeriodFor(client, '2024-06-30')).rejects.toMatchObject({
        code: 'PERIOD_LOCKED',
      });
      await expect(openPeriodFor(client, '2024-07-01')).resolves.toBeTruthy();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe.skipIf(!integrationEnabled)('Faz 4 — rapor doğruluğu (ek senaryolar)', () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTestTenant();
    await writeEntry(
      t,
      [
        { code: '120', debit: 100 },
        { code: '600', credit: 100 },
      ],
      { entry_date: '2025-05-01' },
    );
    await writeEntry(
      t,
      [
        { code: '120', debit: 40 },
        { code: '600', credit: 40 },
      ],
      { entry_date: '2026-05-01' },
    );
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
  });

  it('bilanço: önceki yıl sonucu "geçmiş yıllar", cari yıl "dönem net kârı"; aktif = pasif', async () => {
    const bs = await accountingService.balanceSheet({ as_of: '2026-12-31' }, t.tenantId);
    expect(bs.aktif.toplam).toBe(140);
    expect(bs.pasif.gecmisYillarKarZarari).toBe(100);
    expect(bs.pasif.donemNetKar).toBe(40);
    expect(bs.balanced).toBe(true);
  });

  it('mizan: devir (önceki yıl) + dönem hareketi = kümülatif; dengeli', async () => {
    const tb = await accountingService.trialBalance(
      { from: '2026-01-01', to: '2026-12-31' },
      t.tenantId,
    );
    const alicilar = tb.accounts.find((a) => a.code === '120');
    expect(alicilar?.openingDebit).toBe(100);
    expect(alicilar?.periodDebit).toBe(40);
    expect(alicilar?.debit).toBe(140);
    expect(tb.balanced).toBe(true);
  });

  it('gelir tablosu: ters kayıt satışı net düşürür; 7xx ayrı satırda ve net kârdan düşer', async () => {
    const sale = await writeEntry(
      t,
      [
        { code: '120', debit: 60 },
        { code: '600', credit: 60 },
      ],
      { entry_date: '2026-06-01' },
    );
    await accountingService.reverseEntry(sale.id, t.userId, t.tenantId, '2026-06-02');
    await writeEntry(
      t,
      [
        { code: '770', debit: 10 },
        { code: '100', credit: 10 },
      ],
      { entry_date: '2026-06-03' },
    );
    const is = await accountingService.incomeStatement(
      { from: '2026-01-01', to: '2026-12-31' },
      t.tenantId,
    );
    expect(is.brutSatislar).toBe(40); // 40 satış; 60 satış + 60 ters = 0
    expect(is.maliyetHesaplari7xx).toBe(10);
    expect(is.donemNetKari).toBe(30);
  });
});

describe.skipIf(!integrationEnabled)(
  'Faz 5 — kaynak belge değişmezliği ve modül kapısı (A8, A9)',
  () => {
    const invoices = new InvoiceService();
    let t: TestTenant;
    beforeAll(async () => {
      t = await createTestTenant();
    });
    afterAll(async () => {
      await cleanupTestTenant(t);
    });

    const newInvoiceId = async (amount = 100): Promise<string> => {
      const inv = (await withTenantScope(t, () =>
        invoices.createInvoice(
          {
            type: 'sales',
            currency: 'TRY',
            issue_date: '2026-03-10',
            lines: [
              { description: 'Hizmet', quantity: 1, unit_price: amount, discount_percent: 0 },
            ],
          } as never,
          t.userId,
        ),
      )) as unknown as { id?: string; invoice?: { id: string } };
      return (inv.id ?? inv.invoice?.id) as string;
    };
    const entryCount = async (source: string) => {
      const r = await getPool('migrator').query(
        `SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND source_type = $2`,
        [t.tenantId, source],
      );
      return r.rows[0].n as number;
    };

    it('A9: muhasebe modülü yokken fatura kesinleşir ama fiş üretilmez', async () => {
      const id = await newInvoiceId();
      const res = await withTenantScope(t, () => invoices.postInvoice(id, t.userId));
      expect(res.entryId).toBeNull();
      expect(await entryCount('invoice')).toBe(0);
      const row = await getPool('migrator').query(
        'SELECT posting_status FROM invoices WHERE id = $1',
        [id],
      );
      expect(row.rows[0].posting_status).toBe('posted');
    });

    it('A8: kesinleşmiş fatura silinemez, satırları ve tutar alanları değişmez; not güncellenir', async () => {
      await grantAccounting(t);
      const id = await newInvoiceId(200);
      // kesinleşmemiş faturaya ödeme (muhasebe aktif) reddedilir
      await expect(
        withTenantScope(t, () =>
          invoices.addPayment(id, { amount: 50, payment_method: 'cash' } as never, t.userId),
        ),
      ).rejects.toThrow(/kesinleştir/i);

      await withTenantScope(t, () => invoices.postInvoice(id, t.userId));
      expect(await entryCount('invoice')).toBe(1);

      await expect(withTenantScope(t, () => invoices.deleteInvoice(id, t.userId))).rejects.toThrow(
        /silinemez/i,
      );
      await expect(
        withTenantScope(t, () =>
          invoices.replaceLines(
            id,
            {
              lines: [{ description: 'x', quantity: 1, unit_price: 1, discount_percent: 0 }],
            } as never,
            t.userId,
          ),
        ),
      ).rejects.toThrow(/değiştirilemez/i);
      await expect(
        withTenantScope(t, () =>
          invoices.updateInvoice(id, { issue_date: '2026-01-01' }, t.userId),
        ),
      ).rejects.toThrow(/değiştirilemez/i);
      await expect(
        withTenantScope(t, () => invoices.updateInvoice(id, { notes: 'not' }, t.userId)),
      ).resolves.toBeTruthy();
    });

    it('A8: kesinleşmiş faturaya ödeme fişi yazılır; ödemesi olan fatura iptal edilemez', async () => {
      await grantAccounting(t);
      const id = await newInvoiceId(300);
      await withTenantScope(t, () => invoices.postInvoice(id, t.userId));
      await withTenantScope(t, () =>
        invoices.addPayment(id, { amount: 100, payment_method: 'cash' } as never, t.userId),
      );
      expect(await entryCount('invoice_payment')).toBe(1);
      await expect(
        withTenantScope(t, () => invoices.updateInvoice(id, { status: 'cancelled' }, t.userId)),
      ).rejects.toThrow(/Ödemesi olan/i);
    });

    it('A8: kesinleşmiş faturanın iptali yevmiye fişini ters çevirir; sonra ödeme/değişiklik olmaz', async () => {
      await grantAccounting(t);
      const id = await newInvoiceId(500);
      const posted = await withTenantScope(t, () => invoices.postInvoice(id, t.userId));
      // kaynak belgeye bağlı fiş doğrudan ters çevrilemez
      await expect(
        accountingService.reverseEntry(posted.entryId as string, t.userId, t.tenantId),
      ).rejects.toThrow(/Kaynak belgeye/i);

      await withTenantScope(t, () => invoices.updateInvoice(id, { status: 'cancelled' }, t.userId));
      const st = await getPool('migrator').query(
        'SELECT status, posting_status FROM invoices WHERE id = $1',
        [id],
      );
      expect(st.rows[0]).toMatchObject({ status: 'cancelled', posting_status: 'cancelled' });
      const rev = await getPool('migrator').query(
        `SELECT total_debit, total_credit FROM journal_entries WHERE reversal_of_id = $1`,
        [posted.entryId],
      );
      expect(rev.rows).toHaveLength(1);
      await expect(
        withTenantScope(t, () =>
          invoices.addPayment(id, { amount: 10, payment_method: 'cash' } as never, t.userId),
        ),
      ).rejects.toThrow(/İptal edilmiş/i);
      await expect(
        withTenantScope(t, () => invoices.updateInvoice(id, { notes: 'x' }, t.userId)),
      ).rejects.toThrow(/İptal edilmiş/i);
    });
  },
);

// Faz 2, 5 ve ayrı karar gerektiren maddeler — ilgili faz başında somutlaştırılır.
describe('Sonraki fazlar için bekleyen kırmızı testler', () => {
  it.todo(
    'A4: yetkisiz (accounting.entry.create olmayan) kullanıcı POST /accounting/entries → 403',
  );
});
