/**
 * Faz 7-5 — Giderler ekranı muhasebesi ve mükerrer belge engeli (gerçek PostgreSQL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import { expenseService } from '../../src/modules/expense/expense.service';
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

describe.skipIf(!integrationEnabled)('Faz 7-5 — giderler', () => {
  let t: TestTenant;
  let kira: string;
  let kasa: string;
  let banka: string;
  let kart: string;
  let tedarikci: string;
  const m = () => getPool('migrator');
  const invoices = new InvoiceService();

  const entry = async (sourceType: string, sourceId: string) =>
    (
      await m().query(
        `SELECT a.code, jl.debit::float AS debit, jl.credit::float AS credit, jl.description
           FROM journal_entries je
           JOIN journal_lines jl ON jl.entry_id = je.id
           JOIN accounting_accounts a ON a.id = jl.account_id
          WHERE je.source_type = $1 AND je.source_id = $2 AND je.entry_type <> 'ters'`,
        [sourceType, sourceId],
      )
    ).rows as Array<{ code: string; debit: number; credit: number; description: string }>;
  const create = (input: Record<string, unknown>) =>
    withTenantScope(t, () =>
      expenseService.createExpense(
        {
          category_id: kira,
          description: 'Ofis kirası',
          expense_date: '2026-06-15',
          currency: 'TRY',
          exchange_rate: 1,
          payment_status: 'unpaid',
          status: 'draft',
          ...input,
        } as never,
        t.userId,
      ),
    ) as Promise<{ id: string; status: string; payment_status: string; amount: number }>;
  const update = (id: string, input: Record<string, unknown>) =>
    withTenantScope(t, () => expenseService.updateExpense(id, input as never, t.userId));

  beforeAll(async () => {
    t = await createTestTenant();
    await grantAccounting(t);
    kira = newId();
    await m().query(
      `INSERT INTO expense_categories (id, tenant_id, code, name) VALUES ($1, $2, 'KIRA', 'Kira')`,
      [kira, t.tenantId],
    );
    kasa = newId();
    banka = newId();
    await m().query(
      `INSERT INTO cash_bank_accounts (id, tenant_id, account_type, account_name)
       VALUES ($1, $3, 'cash', 'Merkez Kasa'), ($2, $3, 'bank', 'İş Bankası')`,
      [kasa, banka, t.tenantId],
    );
    kart = newId();
    await m().query(
      `INSERT INTO credit_cards (id, tenant_id, bank_account_id, card_label) VALUES ($1, $2, $3, 'Şirket Kartı')`,
      [kart, t.tenantId, banka],
    );
    tedarikci = newId();
    await m().query(
      `INSERT INTO contacts (id, tenant_id, code, name, tax_number) VALUES ($1, $2, 'T001', 'Tedarikçi A.Ş.', '1234567890')`,
      [tedarikci, t.tenantId],
    );
  });
  afterAll(async () => {
    await m().query('DELETE FROM expense_payments WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM expenses WHERE tenant_id = $1', [t.tenantId]);
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

  it('carisiz peşin gider (kasa): 770.xx + 191 B / 100.xx A; ödendi sayılır; açıklamada belge + satıcı', async () => {
    const e = await create({
      net_amount: 100,
      tax_rate: 20,
      invoice_number: 'FIS-1',
      counterparty_name: 'Kırtasiye Ltd.',
      payment_source_type: 'cash_bank',
      payment_source_id: kasa,
      status: 'posted',
    });
    expect(e.status).toBe('posted');
    expect(e.payment_status).toBe('paid');
    expect(Number(e.amount)).toBe(120);
    const lines = await entry('expense', e.id);
    expect(lines.find((l) => l.code.startsWith('770.'))?.debit).toBe(100);
    expect(lines.find((l) => l.code === '191')?.debit).toBe(20);
    const credit = lines.find((l) => l.credit > 0)!;
    expect(credit.code).toMatch(/^100\.\d{2}$/);
    expect(credit.credit).toBe(120);
    expect(credit.description).toContain('FIS-1');
    expect(credit.description).toContain('Kırtasiye Ltd.');
  });

  it('carisiz gider: belge no / satıcı / ödeme kaynağı eksikse kesinleşmez', async () => {
    const e = await create({ net_amount: 10, tax_rate: 20 });
    await expect(update(e.id, { status: 'posted' })).rejects.toThrow(
      /belge no, satıcı unvanı, ödeme kaynağı/,
    );
  });

  it('carisiz gider şirket kredi kartıyla: alacak 309.xx', async () => {
    const e = await create({
      net_amount: 50,
      tax_rate: 0,
      invoice_number: 'FIS-2',
      counterparty_name: 'Akaryakıt',
      payment_source_type: 'credit_card',
      payment_source_id: kart,
      status: 'posted',
    });
    const credit = (await entry('expense', e.id)).find((l) => l.credit > 0)!;
    expect(credit.code).toMatch(/^309\.\d{2}$/);
    expect(credit.credit).toBe(50);
  });

  it('carili gider: 320 A; ödeme 320 B / 102.xx A; kısmi ödeme ve fazla ödeme engeli', async () => {
    const e = await create({
      net_amount: 1000,
      tax_rate: 20,
      contact_id: tedarikci,
      invoice_number: 'A-100',
      status: 'posted',
    });
    expect((await entry('expense', e.id)).find((l) => l.code === '320')?.credit).toBe(1200);
    const paid = (await withTenantScope(t, () =>
      expenseService.createPayment(
        e.id,
        { amount: 500, cash_bank_account_id: banka, currency: 'TRY' } as never,
        t.userId,
      ),
    )) as { payment_status: string };
    expect(paid.payment_status).toBe('partial');
    const pay = await m().query(`SELECT id FROM expense_payments WHERE expense_id = $1`, [e.id]);
    const payLines = await entry('expense_payment', pay.rows[0].id);
    expect(payLines.find((l) => l.code === '320')?.debit).toBe(500);
    expect(payLines.find((l) => l.credit > 0)?.code).toMatch(/^102\.\d{2}$/);
    await expect(
      withTenantScope(t, () =>
        expenseService.createPayment(
          e.id,
          { amount: 800, cash_bank_account_id: banka, currency: 'TRY' } as never,
          t.userId,
        ),
      ),
    ).rejects.toThrow(/kalan borcu/);
    // ödemesi olan gider iptal edilemez
    await expect(update(e.id, { status: 'cancelled' })).rejects.toThrow(/Ödemesi olan/);
  });

  it('kesinleşmiş gider değişmez (yalnız not); iptal fişi ters çevirir', async () => {
    const e = await create({
      net_amount: 40,
      tax_rate: 20,
      contact_id: tedarikci,
      invoice_number: 'A-200',
      status: 'posted',
    });
    await expect(update(e.id, { net_amount: 41 })).rejects.toThrow(/değiştirilemez/);
    await expect(update(e.id, { notes: 'not' })).resolves.toBeTruthy();
    await update(e.id, { status: 'cancelled' });
    const rev = await m().query(
      `SELECT r.id FROM journal_entries o JOIN journal_entries r ON r.reversal_of_id = o.id
        WHERE o.source_type = 'expense' AND o.source_id = $1`,
      [e.id],
    );
    expect(rev.rows).toHaveLength(1);
  });

  it('mükerrer belge: aynı cari + belge no ikinci kez gider ya da alış faturası olarak kesinleşmez', async () => {
    await create({
      net_amount: 10,
      tax_rate: 0,
      contact_id: tedarikci,
      invoice_number: 'MUK-1',
      status: 'posted',
    });
    await expect(
      create({
        net_amount: 10,
        tax_rate: 0,
        contact_id: tedarikci,
        invoice_number: ' muk-1 ',
        status: 'posted',
      }),
    ).rejects.toThrow(/zaten gider olarak kayıtlı/);

    const inv = (await withTenantScope(t, () =>
      invoices.createInvoice(
        {
          type: 'purchase',
          currency: 'TRY',
          issue_date: '2026-06-20',
          contact_id: tedarikci,
          supplier_document_no: 'MUK-1',
          lines: [
            {
              description: 'Kira',
              quantity: 1,
              unit_price: 10,
              discount_percent: 0,
              expense_category_id: kira,
            },
          ],
        } as never,
        t.userId,
      ),
    )) as unknown as { id?: string; invoice?: { id: string } };
    const id = (inv.id ?? inv.invoice?.id) as string;
    await expect(withTenantScope(t, () => invoices.postInvoice(id, t.userId))).rejects.toThrow(
      /zaten gider olarak kayıtlı/,
    );
  });

  it('muhasebe aktifken tedarikçi belge no’suz alış faturası kesinleşmez', async () => {
    const inv = (await withTenantScope(t, () =>
      invoices.createInvoice(
        {
          type: 'purchase',
          currency: 'TRY',
          issue_date: '2026-06-20',
          contact_id: tedarikci,
          lines: [
            {
              description: 'Kira',
              quantity: 1,
              unit_price: 10,
              discount_percent: 0,
              expense_category_id: kira,
            },
          ],
        } as never,
        t.userId,
      ),
    )) as unknown as { id?: string; invoice?: { id: string } };
    const id = (inv.id ?? inv.invoice?.id) as string;
    await expect(withTenantScope(t, () => invoices.postInvoice(id, t.userId))).rejects.toThrow(
      /tedarikçinin belge numarası/,
    );
  });
});
