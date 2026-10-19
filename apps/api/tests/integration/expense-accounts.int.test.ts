/**
 * Faz 7-2 — alış faturasında stok/gider ayrımı ve gider kategorisi hesapları (gerçek PostgreSQL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import { InvoiceService } from '../../src/modules/trade/invoice/service';
import { StockService } from '../../src/modules/stock/service';
import {
  createExpenseCategory,
  updateExpenseCategory,
} from '../../src/modules/expense/expense.service';
import {
  accountId,
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  grantAccounting,
  integrationEnabled,
  withTenantScope,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('Faz 7-2 — gider hesapları ve alış satırları', () => {
  let t: TestTenant;
  let unitId: string;
  let supplierId: string;
  const m = () => getPool('migrator');
  const invoices = new InvoiceService();

  const newCategory = async (code: string, name: string) => {
    const id = newId();
    await m().query(
      `INSERT INTO expense_categories (id, tenant_id, code, name) VALUES ($1, $2, $3, $4)`,
      [id, t.tenantId, code, name],
    );
    return id;
  };
  const newProduct = async (
    code: string,
    track: boolean,
    defaultCategory: string | null = null,
  ) => {
    const id = newId();
    await m().query(
      `INSERT INTO products (id, tenant_id, code, name, unit_id, track_inventory, default_expense_category_id)
       VALUES ($1, $2, $3, $3, $4, $5, $6)`,
      [id, t.tenantId, code, unitId, track, defaultCategory],
    );
    return id;
  };
  const purchase = async (lines: Array<Record<string, unknown>>) => {
    const inv = (await withTenantScope(t, () =>
      invoices.createInvoice(
        {
          type: 'purchase',
          currency: 'TRY',
          issue_date: '2026-04-10',
          contact_id: supplierId,
          supplier_document_no: `SUP-${newId()}`,
          lines,
        } as never,
        t.userId,
      ),
    )) as unknown as { id?: string; invoice?: { id: string } };
    return (inv.id ?? inv.invoice?.id) as string;
  };
  const entryLines = async (invoiceId: string) =>
    (
      await m().query(
        `SELECT a.code, jl.debit::float AS debit, jl.credit::float AS credit
           FROM journal_entries je
           JOIN journal_lines jl ON jl.entry_id = je.id
           JOIN accounting_accounts a ON a.id = jl.account_id
          WHERE je.source_type = 'invoice' AND je.source_id = $1
          ORDER BY a.code`,
        [invoiceId],
      )
    ).rows as Array<{ code: string; debit: number; credit: number }>;

  beforeAll(async () => {
    t = await createTestTenant();
    await grantAccounting(t);
    supplierId = newId();
    await m().query(
      `INSERT INTO contacts (id, tenant_id, code, name) VALUES ($1, $2, 'TED1', 'Tedarikçi')`,
      [supplierId, t.tenantId],
    );
    unitId = newId();
    await m().query(
      `INSERT INTO units (id, tenant_id, code, name) VALUES ($1, $2, 'ADET', 'Adet')`,
      [unitId, t.tenantId],
    );
  });
  afterAll(async () => {
    await m().query(
      'DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE tenant_id = $1)',
      [t.tenantId],
    );
    await m().query('DELETE FROM invoices WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM contacts WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM products WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM units WHERE tenant_id = $1', [t.tenantId]);
    await m().query('DELETE FROM expense_categories WHERE tenant_id = $1', [t.tenantId]);
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it('stok satırı 153, gider satırı kategorinin 770.xx hesabı; 191 ve 320 doğru', async () => {
    const elektrik = await newCategory('ELEKTRIK', 'Elektrik');
    const urun = await newProduct('MAL1', true);
    const id = await purchase([
      {
        product_id: urun,
        description: 'Ticari mal',
        quantity: 2,
        unit_price: 100,
        discount_percent: 0,
      },
      {
        expense_category_id: elektrik,
        description: 'Elektrik faturası',
        quantity: 1,
        unit_price: 50,
        discount_percent: 0,
      },
    ]);
    await withTenantScope(t, () => invoices.postInvoice(id, t.userId));
    const lines = await entryLines(id);
    const by = (code: string) => lines.find((l) => l.code === code);
    expect(by('153')?.debit).toBe(200);
    const gider = lines.find((l) => l.code.startsWith('770.'));
    expect(gider?.debit).toBe(50);
    expect(by('320')?.credit).toBe(250);
    // kategori hesabı bağlandı
    const cat = await m().query('SELECT account_id FROM expense_categories WHERE id = $1', [
      elektrik,
    ]);
    expect(cat.rows[0].account_id).toBeTruthy();
  });

  it('stok takipsiz ürün kartındaki varsayılan gider kategorisine yazılır', async () => {
    const telefon = await newCategory('TELEKOM', 'Telefon');
    const hizmet = await newProduct('HZM1', false, telefon);
    const id = await purchase([
      {
        product_id: hizmet,
        description: 'Hat ücreti',
        quantity: 1,
        unit_price: 80,
        discount_percent: 0,
      },
    ]);
    await withTenantScope(t, () => invoices.postInvoice(id, t.userId));
    const lines = await entryLines(id);
    const gider = lines.find((l) => l.code.startsWith('770.'));
    expect(gider?.debit).toBe(80);
    expect(lines.find((l) => l.code === '153')).toBeUndefined();
  });

  it('kategori 760 hesabına bağlanırsa fiş oraya yazılır', async () => {
    const reklam = await newCategory('REKLAM', 'Reklam');
    const acc760 = await accountId(t, '760');
    await withTenantScope(t, () => updateExpenseCategory(reklam, { account_id: acc760 }, t.userId));
    const id = await purchase([
      {
        expense_category_id: reklam,
        description: 'İlan',
        quantity: 1,
        unit_price: 30,
        discount_percent: 0,
      },
    ]);
    await withTenantScope(t, () => invoices.postInvoice(id, t.userId));
    const lines = await entryLines(id);
    expect(lines.find((l) => l.code === '760')?.debit).toBe(30);
  });

  it('gider kategorisi 6xx/7xx dışı hesaba bağlanamaz', async () => {
    const acc100 = await accountId(t, '100');
    await expect(
      withTenantScope(t, () =>
        createExpenseCategory(
          {
            code: 'YANLIS',
            name: 'Yanlış',
            is_favorite: false,
            status: 'active',
            account_id: acc100,
          },
          t.userId,
        ),
      ),
    ).rejects.toThrow(/6xx\/7xx/);
  });

  it('stok veya gider seçilmemiş alış satırı kesinleştirilemez; ürün+kategori birlikte olamaz', async () => {
    const id = await purchase([
      { description: 'Belirsiz', quantity: 1, unit_price: 10, discount_percent: 0 },
    ]);
    await expect(withTenantScope(t, () => invoices.postInvoice(id, t.userId))).rejects.toThrow(
      /stok ürünü veya gider kategorisi/,
    );
    const cat = await newCategory('KIRTASIYE', 'Kırtasiye');
    const urun = await newProduct('MAL2', true);
    await expect(
      purchase([
        {
          product_id: urun,
          expense_category_id: cat,
          description: 'İkisi birden',
          quantity: 1,
          unit_price: 10,
          discount_percent: 0,
        },
      ]),
    ).rejects.toThrow(/hem ürün hem gider/);
  });

  it('GÜVENLİK: ürün güncellemede izin dışı anahtar SQL’e girmez', async () => {
    const urun = await newProduct('MAL3', true);
    const stock = new StockService();
    const res = await withTenantScope(t, () =>
      stock.updateProduct(urun, {
        name: 'Yeni Ad',
        ["name = 'x', code"]: 'enjeksiyon',
      } as never),
    );
    expect((res as { name: string; code: string }).name).toBe('Yeni Ad');
    expect((res as { code: string }).code).toBe('MAL3');
  });
});
