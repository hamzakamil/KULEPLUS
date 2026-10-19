/**
 * Faz 7-3 — KDV tevkifatı, iade faturaları ve tenant varsayılan verileri (gerçek PostgreSQL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import { InvoiceService } from '../../src/modules/trade/invoice/service';
import { accountingService } from '../../src/modules/accounting/service';
import { ensureTenantDefaults } from '../../src/modules/core/tenant-defaults';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  grantAccounting,
  integrationEnabled,
  withTenantScope,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('Faz 7-3 — tevkifat ve iade', () => {
  let t: TestTenant;
  let kdv20: string;
  let kdv0: string;
  let kira: string;
  let supplierId: string;
  const types = new Map<string, string>();
  const m = () => getPool('migrator');
  const invoices = new InvoiceService();

  const create = async (
    type: 'sales' | 'purchase' | 'credit_note' | 'debit_note',
    lines: Array<Record<string, unknown>>,
    extra: Record<string, unknown> = {},
  ) => {
    const inv = (await withTenantScope(t, () =>
      invoices.createInvoice(
        {
          type,
          currency: 'TRY',
          issue_date: '2026-05-10',
          lines,
          ...(type === 'purchase'
            ? { supplier_document_no: `SUP-${newId()}`, contact_id: supplierId }
            : {}),
          ...extra,
        } as never,
        t.userId,
      ),
    )) as unknown as { id?: string; invoice?: { id: string } };
    return (inv.id ?? inv.invoice?.id) as string;
  };
  const post = (id: string) => withTenantScope(t, () => invoices.postInvoice(id, t.userId));
  const head = async (id: string) =>
    (
      await m().query(
        `SELECT total::float, tax_total::float, withholding_total::float, balance::float,
                returned_amount::float, status, posting_status
           FROM invoices WHERE id = $1`,
        [id],
      )
    ).rows[0];
  const entry = async (id: string) => {
    const r = await m().query(
      `SELECT a.code, a.name, jl.debit::float AS debit, jl.credit::float AS credit
         FROM journal_entries je
         JOIN journal_lines jl ON jl.entry_id = je.id
         JOIN accounting_accounts a ON a.id = jl.account_id
        WHERE je.source_type = 'invoice' AND je.source_id = $1 AND je.entry_type <> 'ters'`,
      [id],
    );
    const by = (code: string) => r.rows.find((x) => x.code === code);
    return { rows: r.rows, by };
  };
  const line = (price: number, extra: Record<string, unknown> = {}) => ({
    description: 'Kalem',
    quantity: 1,
    unit_price: price,
    discount_percent: 0,
    tax_rate_id: kdv20,
    ...extra,
  });

  beforeAll(async () => {
    t = await createTestTenant();
    await grantAccounting(t);
    supplierId = newId();
    await m().query(
      `INSERT INTO contacts (id, tenant_id, code, name) VALUES ($1, $2, 'TED1', 'Tedarikçi')`,
      [supplierId, t.tenantId],
    );
    const c = await m().connect();
    try {
      await c.query('BEGIN');
      await ensureTenantDefaults(c, t.tenantId);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    const rates = await m().query('SELECT id, rate::float FROM tax_rates WHERE tenant_id = $1', [
      t.tenantId,
    ]);
    kdv20 = rates.rows.find((r) => r.rate === 20)!.id;
    kdv0 = rates.rows.find((r) => r.rate === 0)!.id;
    const wt = await m().query(
      'SELECT id, einvoice_code FROM withholding_types WHERE tenant_id = $1',
      [t.tenantId],
    );
    for (const r of wt.rows) types.set(String(r.einvoice_code), String(r.id));
    kira = (
      await m().query(`SELECT id FROM expense_categories WHERE tenant_id = $1 AND code = 'KIRA'`, [
        t.tenantId,
      ])
    ).rows[0].id;
  });
  afterAll(async () => {
    await m().query(
      'DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE tenant_id = $1)',
      [t.tenantId],
    );
    await m().query('DELETE FROM invoices WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM contacts WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM withholding_types WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM expense_categories WHERE tenant_id = $1', [t.tenantId]);
    await cleanupTestTenant(t);
    await m().query('DELETE FROM tax_rates WHERE tenant_id = $1', [t.tenantId]);
    await closeAllPools();
  });

  it('tenant varsayılanları: 4 KDV oranı, 25 tevkifat türü, 12 gider kategorisi; idempotent', async () => {
    const c = await m().connect();
    try {
      await c.query('BEGIN');
      await ensureTenantDefaults(c, t.tenantId);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    const n = async (table: string) =>
      Number(
        (await m().query(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = $1`, [t.tenantId]))
          .rows[0].n,
      );
    expect(await n('tax_rates')).toBe(4);
    expect(await n('withholding_types')).toBe(25);
    expect(await n('expense_categories')).toBe(12);
  });

  it('alış 4/10 tevkifat (601/301): 191 tam KDV, 320 ödenecek, 360.01.301 tevkif edilen', async () => {
    const id = await create('purchase', [
      line(1000, { expense_category_id: kira, withholding_type_id: types.get('601') }),
    ]);
    const h = await head(id);
    expect(h.tax_total).toBe(200);
    expect(h.withholding_total).toBe(80);
    expect(h.total).toBe(1120);
    await post(id);
    const e = await entry(id);
    expect(e.rows.find((r) => r.code.startsWith('770.'))?.debit).toBe(1000);
    expect(e.by('191')?.debit).toBe(200);
    expect(e.by('320')?.credit).toBe(1120);
    expect(e.by('360.01.301')?.credit).toBe(80);
    expect(e.by('360.01.301')?.name).toMatch(/4\/10/);
  });

  it('satış 9/10 tevkifat (602): 120 ödenecek, 391 yalnızca tahsil edilen KDV', async () => {
    const id = await create('sales', [line(1000, { withholding_type_id: types.get('602') })]);
    expect((await head(id)).total).toBe(1020);
    await post(id);
    const e = await entry(id);
    expect(e.by('120')?.debit).toBe(1020);
    expect(e.by('600')?.credit).toBe(1000);
    expect(e.by('391')?.credit).toBe(20);
  });

  it('KDV’siz satıra / iade faturasına tevkifat uygulanamaz; pasif tür reddedilir', async () => {
    await expect(
      create('sales', [line(100, { tax_rate_id: kdv0, withholding_type_id: types.get('602') })]),
    ).rejects.toThrow(/KDV'siz/);
    await expect(
      create('credit_note', [line(100, { withholding_type_id: types.get('602') })]),
    ).rejects.toThrow(/yalnızca satış ve alış/);
    await m().query(`UPDATE withholding_types SET is_active = false WHERE id = $1`, [
      types.get('625'),
    ]);
    await expect(
      create('sales', [line(100, { withholding_type_id: types.get('625') })]),
    ).rejects.toThrow(/bulunamadı, pasif/);
  });

  it('tevkifat raporu: KDV-2 kod bazında matrah/KDV/tevkifat ve 360.01 mutabakatı; KDV-1 satış', async () => {
    const r = await accountingService.withholdingReport(
      { from: '2026-01-01', to: '2026-12-31' },
      t.tenantId,
    );
    const k301 = r.kdv2.find((x) => x.kdv2Code === '301');
    expect(k301).toMatchObject({ base: 1000, vat: 200, withheld: 80, ledger: 80, difference: 0 });
    expect(k301?.rate).toBe('4/10');
    const k602 = r.kdv1.find((x) => x.einvoiceCode === '602');
    expect(k602).toMatchObject({ base: 1000, vat: 200, withheld: 180 });
  });

  it('alınan iade (satıştan iade): 610 + 391 B / 120 A; orijinal bakiyesi düşer, aşamaz, iptalde geri gelir', async () => {
    const sale = await create('sales', [line(500)]);
    await post(sale);
    const note = await create('credit_note', [line(100)], {
      reference_type: 'invoice',
      reference_id: sale,
    });
    await post(note);
    const e = await entry(note);
    expect(e.by('610')?.debit).toBe(100);
    expect(e.by('391')?.debit).toBe(20);
    expect(e.by('120')?.credit).toBe(120);
    expect(await head(sale)).toMatchObject({ balance: 480, returned_amount: 120 });
    expect((await head(note)).balance).toBe(0);

    // kalan bakiyeyi (480) aşan iade reddedilir
    const big = await create('credit_note', [line(500)], {
      reference_type: 'invoice',
      reference_id: sale,
    });
    await expect(post(big)).rejects.toThrow(/aşamaz/);

    // iadesi olan orijinal fatura iptal edilemez
    await expect(
      withTenantScope(t, () => invoices.updateInvoice(sale, { status: 'cancelled' }, t.userId)),
    ).rejects.toThrow(/Bağlı iade/);

    // iade iptal edilince orijinalin bakiyesi geri gelir
    await withTenantScope(t, () => invoices.updateInvoice(note, { status: 'cancelled' }, t.userId));
    expect(await head(sale)).toMatchObject({ balance: 600, returned_amount: 0 });
  });

  it('verilen iade (alıştan iade): 320 B / gider hesabı + 191 A; yanlış türe bağlanamaz', async () => {
    const buy = await create('purchase', [line(300, { expense_category_id: kira })]);
    await post(buy);
    const note = await create('debit_note', [line(50, { expense_category_id: kira })], {
      reference_type: 'invoice',
      reference_id: buy,
    });
    await post(note);
    const e = await entry(note);
    expect(e.by('320')?.debit).toBe(60);
    expect(e.rows.find((r) => r.code.startsWith('770.'))?.credit).toBe(50);
    expect(e.by('191')?.credit).toBe(10);
    expect((await head(buy)).balance).toBe(300);

    const sale = await create('sales', [line(100)]);
    await post(sale);
    const wrong = await create('debit_note', [line(10, { expense_category_id: kira })], {
      reference_type: 'invoice',
      reference_id: sale,
    });
    await expect(post(wrong)).rejects.toThrow(/alış faturasına/);
  });
});
