/**
 * Faz 7-1 — alt hesap (yardımcı hesap) altyapısı, gerçek PostgreSQL.
 * Kasa/banka → 100.xx/102.xx, şirket kredi kartı → 309.xx; fatura ödemesi seçilen
 * kartın alt hesabına yazılır; migration mevcut kartları bağlar ve idempotenttir.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import { InvoiceService } from '../../src/modules/trade/invoice/service';
import {
  cashBankLedgerAccount,
  createSubAccount,
  creditCardLedgerAccount,
} from '../../src/modules/accounting/subledger';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  grantAccounting,
  integrationEnabled,
  withTenantScope,
  type TestTenant,
} from './db-harness';

const migrationSql = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../packages/db/migrations/202610540000_subledger_accounts.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe.skipIf(!integrationEnabled)('Faz 7-1 — alt hesaplar', () => {
  let t: TestTenant;
  const m = () => getPool('migrator');

  /** Tenant GUC'u kurulu tek transaction'da fonksiyonu çalıştırır. */
  const inTx = async <T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> => {
    const c = await getPool('app').connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.tenantId]);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };
  const account = async (id: string) =>
    (
      await m().query(
        `SELECT a.code, a.name, a.is_tdphp, p.code AS parent_code
           FROM accounting_accounts a LEFT JOIN accounting_accounts p ON p.id = a.parent_id
          WHERE a.id = $1`,
        [id],
      )
    ).rows[0] as { code: string; name: string; is_tdphp: boolean; parent_code: string };
  const newCashBank = async (type: 'cash' | 'bank', name: string) => {
    const id = newId();
    await m().query(
      `INSERT INTO cash_bank_accounts (id, tenant_id, account_type, account_name) VALUES ($1, $2, $3, $4)`,
      [id, t.tenantId, type, name],
    );
    return id;
  };

  beforeAll(async () => {
    t = await createTestTenant();
  });
  afterAll(async () => {
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it('alt hesap noktalı ve sıralı açılır; elle açılmış numaranın üzerine devam eder', async () => {
    const first = await inTx((c) => createSubAccount(c, '136', 'Deneme A'));
    expect((await account(first)).code).toBe('136.01');
    expect((await account(first)).parent_code).toBe('136');
    expect((await account(first)).is_tdphp).toBe(false);
    // kullanıcı elle 136.07 açmış olsun
    await m().query(
      `INSERT INTO accounting_accounts (id, tenant_id, code, name, type, is_tdphp)
       VALUES ($1, $2, '136.07', 'Elle', 'detail', false)`,
      [newId(), t.tenantId],
    );
    const next = await inTx((c) => createSubAccount(c, '136', 'Deneme B'));
    expect((await account(next)).code).toBe('136.08');
  });

  it('kasa → 100.xx, banka → 102.xx; ikinci çağrı aynı hesabı döner ve bağlantı karta yazılır', async () => {
    const kasa = await newCashBank('cash', 'Merkez Kasa');
    const banka = await newCashBank('bank', 'Ziraat TL');
    const kasaAcc = await inTx((c) => cashBankLedgerAccount(c, kasa));
    const bankaAcc = await inTx((c) => cashBankLedgerAccount(c, banka));
    expect((await account(kasaAcc!)).code).toMatch(/^100\.\d{2}$/);
    expect((await account(bankaAcc!)).code).toMatch(/^102\.\d{2}$/);
    expect((await account(bankaAcc!)).name).toBe('Ziraat TL');
    expect(await inTx((c) => cashBankLedgerAccount(c, banka))).toBe(bankaAcc);
    const link = await m().query(
      'SELECT accounting_account_id FROM cash_bank_accounts WHERE id = $1',
      [banka],
    );
    expect(link.rows[0].accounting_account_id).toBe(bankaAcc);
  });

  it('şirket kredi kartı → 309.xx (Kredi Kartı etiket (*son4))', async () => {
    const banka = await newCashBank('bank', 'Kart Bankası');
    const cardId = newId();
    await m().query(
      `INSERT INTO credit_cards (id, tenant_id, bank_account_id, card_label, card_number_last4)
       VALUES ($1, $2, $3, 'Şirket Kartı', '4242')`,
      [cardId, t.tenantId, banka],
    );
    const acc = await inTx((c) => creditCardLedgerAccount(c, cardId));
    const a = await account(acc!);
    expect(a.code).toMatch(/^309\.\d{2}$/);
    expect(a.name).toBe('Kredi Kartı Şirket Kartı (*4242)');
  });

  it('fatura tahsilatı seçilen bankanın alt hesabına yazılır', async () => {
    await grantAccounting(t);
    const banka = await newCashBank('bank', 'Tahsilat Bankası');
    const invoices = new InvoiceService();
    const inv = (await withTenantScope(t, () =>
      invoices.createInvoice(
        {
          type: 'sales',
          currency: 'TRY',
          issue_date: '2026-03-10',
          lines: [{ description: 'Hizmet', quantity: 1, unit_price: 100, discount_percent: 0 }],
        } as never,
        t.userId,
      ),
    )) as unknown as { id?: string; invoice?: { id: string } };
    const id = (inv.id ?? inv.invoice?.id) as string;
    await withTenantScope(t, () => invoices.postInvoice(id, t.userId));
    await withTenantScope(t, () =>
      invoices.addPayment(
        id,
        { amount: 60, payment_method: 'bank_transfer', cash_bank_account_id: banka } as never,
        t.userId,
      ),
    );
    const r = await m().query(
      `SELECT a.code, jl.debit FROM journal_entries je
         JOIN journal_lines jl ON jl.entry_id = je.id
         JOIN accounting_accounts a ON a.id = jl.account_id
        WHERE je.tenant_id = $1 AND je.source_type = 'invoice_payment' AND jl.debit > 0`,
      [t.tenantId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].code).toMatch(/^102\.\d{2}$/);
    expect(Number(r.rows[0].debit)).toBe(60);
  });

  it('migration: bağlantısız mevcut kartları bağlar; tekrar çalıştırma değiştirmez', async () => {
    const eski = await newCashBank('bank', 'Eski Banka');
    await m().query(migrationSql);
    const link1 = (
      await m().query('SELECT accounting_account_id FROM cash_bank_accounts WHERE id = $1', [eski])
    ).rows[0].accounting_account_id as string;
    expect(link1).toBeTruthy();
    expect((await account(link1)).code).toMatch(/^102\.\d{2}$/);
    await m().query(migrationSql);
    const link2 = (
      await m().query('SELECT accounting_account_id FROM cash_bank_accounts WHERE id = $1', [eski])
    ).rows[0].accounting_account_id;
    expect(link2).toBe(link1);
  });
});
