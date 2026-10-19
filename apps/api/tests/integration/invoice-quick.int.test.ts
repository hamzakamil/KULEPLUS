/**
 * Faz 8 — tek ekran fatura akışı: kaydet + kesinleştir + peşin ödeme/tahsilat TEK transaction.
 * Başarılı yolda üç etki birlikte kalıcıdır; bir adım hata verirse HİÇBİRİ kalıcı olmaz.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import { InvoiceService } from '../../src/modules/trade/invoice/service';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  grantAccounting,
  integrationEnabled,
  withTenantScope,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('Faz 8 — tek ekran fatura (createAndFinalize)', () => {
  let t: TestTenant;
  let customer: string;
  let supplier: string;
  let bank: string;
  let kdv20: string;
  let kira: string;
  const m = () => getPool('migrator');
  const invoices = new InvoiceService();

  const quick = (input: Record<string, unknown>) =>
    withTenantScope(t, () =>
      invoices.createAndFinalize(
        { currency: 'TRY', issue_date: '2026-07-10', finalize: false, ...input } as never,
        t.userId,
      ),
    ) as Promise<{ id?: string; invoice?: { id: string } }>;
  const counts = async () => {
    const r = await m().query(
      `SELECT (SELECT COUNT(*) FROM invoices WHERE tenant_id = $1)::int AS invoices,
              (SELECT COUNT(*) FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.tenant_id = $1)::int AS payments,
              (SELECT COUNT(*) FROM journal_entries WHERE tenant_id = $1)::int AS entries`,
      [t.tenantId],
    );
    return r.rows[0] as { invoices: number; payments: number; entries: number };
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
    customer = newId();
    supplier = newId();
    bank = newId();
    await m().query(
      `INSERT INTO contacts (id, tenant_id, code, name) VALUES ($1, $3, 'M1', 'Müşteri'), ($2, $3, 'T1', 'Tedarikçi')`,
      [customer, supplier, t.tenantId],
    );
    await m().query(
      `INSERT INTO cash_bank_accounts (id, tenant_id, account_type, account_name) VALUES ($1, $2, 'bank', 'Banka')`,
      [bank, t.tenantId],
    );
    kira = newId();
    await m().query(
      `INSERT INTO expense_categories (id, tenant_id, code, name) VALUES ($1, $2, 'KIRA', 'Kira')`,
      [kira, t.tenantId],
    );
    kdv20 = newId();
    await m().query(
      `INSERT INTO tax_rates (id, tenant_id, code, name, rate) VALUES ($1, $2, 'KDV20', 'KDV %20', 20)`,
      [kdv20, t.tenantId],
    );
  });
  afterAll(async () => {
    await m().query(
      'DELETE FROM invoice_payments WHERE invoice_id IN (SELECT id FROM invoices WHERE tenant_id = $1)',
      [t.tenantId],
    );
    await m().query('DELETE FROM tax_rates WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM expense_categories WHERE tenant_id = $1', [t.tenantId]);
    await m().query(
      'DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE tenant_id = $1)',
      [t.tenantId],
    );
    await m().query('DELETE FROM invoices WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM contacts WHERE tenant_id = $1', [t.tenantId]);
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it('yalnızca kaydet: taslak fatura, fiş yok', async () => {
    const before = await counts();
    const inv = (await quick({ type: 'sales', contact_id: customer, lines: [line(100)] })) as never;
    const id = ((inv as { id?: string }).id ??
      (inv as { invoice: { id: string } }).invoice.id) as string;
    const row = (await m().query('SELECT posting_status FROM invoices WHERE id = $1', [id]))
      .rows[0];
    expect(row.posting_status).toBe('draft');
    const after = await counts();
    expect(after.invoices - before.invoices).toBe(1);
    expect(after.entries - before.entries).toBe(0);
  });

  it('kaydet + kesinleştir: yevmiye fişi oluşur', async () => {
    const before = await counts();
    const inv = (await quick({
      type: 'sales',
      contact_id: customer,
      finalize: true,
      lines: [line(200)],
    })) as { id?: string; invoice?: { id: string } };
    const id = (inv.id ?? inv.invoice?.id) as string;
    const row = (
      await m().query('SELECT posting_status, total::float FROM invoices WHERE id = $1', [id])
    ).rows[0];
    expect(row.posting_status).toBe('posted');
    expect(row.total).toBe(240);
    expect((await counts()).entries - before.entries).toBe(1);
  });

  it('kaydet + kesinleştir + peşin tahsilat (tutar boş = ödenecek): fatura ödendi, iki fiş', async () => {
    const before = await counts();
    const inv = (await quick({
      type: 'sales',
      contact_id: customer,
      lines: [line(500)],
      payment: { payment_method: 'bank_transfer', cash_bank_account_id: bank },
    })) as { id?: string; invoice?: { id: string } };
    const id = (inv.id ?? inv.invoice?.id) as string;
    const row = (
      await m().query(
        'SELECT status, paid_amount::float, balance::float FROM invoices WHERE id = $1',
        [id],
      )
    ).rows[0];
    expect(row).toMatchObject({ status: 'paid', paid_amount: 600, balance: 0 });
    const after = await counts();
    expect(after.payments - before.payments).toBe(1);
    expect(after.entries - before.entries).toBe(2); // fatura + tahsilat
  });

  it('alış: gider satırı + kısmi peşin ödeme: bakiye kalır, 320 ve banka fişleri', async () => {
    const inv = (await quick({
      type: 'purchase',
      contact_id: supplier,
      supplier_document_no: `Q-${newId()}`,
      lines: [line(1000, { description: 'Kira', expense_category_id: kira })],
      payment: { amount: 400, payment_method: 'bank_transfer', cash_bank_account_id: bank },
    })) as { id?: string; invoice?: { id: string } };
    const id = (inv.id ?? inv.invoice?.id) as string;
    const row = (
      await m().query(
        'SELECT status, paid_amount::float, balance::float FROM invoices WHERE id = $1',
        [id],
      )
    ).rows[0];
    expect(row).toMatchObject({ status: 'partial', paid_amount: 400, balance: 800 });
  });

  it('bir adım hata verirse HİÇBİRİ kalıcı olmaz (fatura, ödeme, fiş)', async () => {
    const before = await counts();
    await expect(
      quick({
        type: 'purchase',
        contact_id: supplier,
        supplier_document_no: `Q-${newId()}`,
        lines: [line(100, { description: 'Belirsiz' })],
        finalize: true,
      }),
    ).rejects.toThrow(/stok ürünü veya gider kategorisi/);
    expect(await counts()).toEqual(before);
  });

  it('ödeme adımı hata verirse (fazla tutar) fatura da kesinleşme de geri alınır', async () => {
    const before = await counts();
    await expect(
      quick({
        type: 'sales',
        contact_id: customer,
        lines: [line(100)],
        payment: { amount: 999999, payment_method: 'bank_transfer', cash_bank_account_id: bank },
      }),
    ).rejects.toThrow(/kalan bakiyeyi/);
    expect(await counts()).toEqual(before);
  });

  it('carisiz alış faturası kesinleştirilemez', async () => {
    const before = await counts();
    await expect(
      quick({
        type: 'purchase',
        supplier_document_no: `Q-${newId()}`,
        lines: [line(100)],
        finalize: true,
      }),
    ).rejects.toThrow(/cari \(tedarikçi\) seçilmelidir/);
    expect(await counts()).toEqual(before);
  });
});
