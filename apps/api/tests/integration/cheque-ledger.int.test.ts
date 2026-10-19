/**
 * Faz 7-4 — çek/senet yardımcı hesapları ve yaşam döngüsü fişleri (gerçek PostgreSQL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import { ChequeService } from '../../src/modules/cheque/service';
import {
  cleanupTestTenant,
  closeAllPools,
  createTestTenant,
  grantAccounting,
  integrationEnabled,
  withTenantScope,
  type TestTenant,
} from './db-harness';

describe.skipIf(!integrationEnabled)('Faz 7-4 — çek/senet muhasebesi', () => {
  let t: TestTenant;
  let bank: string;
  const m = () => getPool('migrator');
  const cheques = new ChequeService();
  let seq = 0;

  const balance = async (code: string) =>
    Number(
      (
        await m().query(
          `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS b
             FROM journal_lines jl
             JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'
             JOIN accounting_accounts a ON a.id = jl.account_id
            WHERE je.tenant_id = $1 AND a.code = $2`,
          [t.tenantId, code],
        )
      ).rows[0].b,
    );
  const bankCode = async () =>
    (
      await m().query(
        `SELECT a.code FROM cash_bank_accounts c JOIN accounting_accounts a ON a.id = c.accounting_account_id
          WHERE c.id = $1`,
        [bank],
      )
    ).rows[0]?.code as string;
  const create = (
    direction: 'incoming' | 'outgoing',
    amount: number,
    chequeType: 'cheque' | 'promissory' = 'cheque',
  ) =>
    withTenantScope(t, () =>
      cheques.createCheque(
        {
          cheque_type: chequeType,
          direction,
          cheque_no: `IT-${++seq}`,
          drawer_name: 'Keşideci',
          issue_date: '2026-06-01',
          due_date: '2026-07-01',
          amount,
          currency: 'TRY',
          portfolio_holder: 'own',
        } as never,
        t.userId,
        t.tenantId,
      ),
    ) as Promise<{ id: string }>;
  const act = <T>(fn: () => Promise<T>) => withTenantScope(t, fn);

  beforeAll(async () => {
    t = await createTestTenant();
    await grantAccounting(t);
    bank = newId();
    await m().query(
      `INSERT INTO cash_bank_accounts (id, tenant_id, account_type, account_name) VALUES ($1, $2, 'bank', 'Tahsil Bankası')`,
      [bank, t.tenantId],
    );
  });
  afterAll(async () => {
    await m().query('DELETE FROM cheques WHERE tenant_id = $1', [t.tenantId]);
    await cleanupTestTenant(t);
    await closeAllPools();
  });

  it('alınan çek: alış 101.01/120 → tahsile ver 101.02/101.01 → tahsil 102.xx/101.02', async () => {
    const c = await create('incoming', 1000);
    expect(await balance('101.01')).toBe(1000);
    expect(await balance('120')).toBe(-1000);
    await act(() =>
      cheques.depositCheque(
        c.id,
        { cash_bank_account_id: bank, transaction_date: '2026-06-05' },
        t.userId,
        t.tenantId,
      ),
    );
    expect(await balance('101.01')).toBe(0);
    expect(await balance('101.02')).toBe(1000);
    await act(() =>
      cheques.collectCheque(
        c.id,
        { cash_bank_account_id: bank, transaction_date: '2026-07-01' },
        t.userId,
        t.tenantId,
      ),
    );
    expect(await balance('101.02')).toBe(0);
    expect(await balance(await bankCode())).toBe(1000);
  });

  it('tahsildeki çek karşılıksız çıkarsa 128 Şüpheli Ticari Alacaklar / 101.02', async () => {
    const c = await create('incoming', 300);
    await act(() =>
      cheques.depositCheque(
        c.id,
        { cash_bank_account_id: bank, transaction_date: '2026-06-05' },
        t.userId,
        t.tenantId,
      ),
    );
    await act(() =>
      cheques.bounceCheque(
        c.id,
        { transaction_date: '2026-07-02', reason: 'Karşılıksız' },
        t.userId,
        t.tenantId,
      ),
    );
    expect(await balance('128')).toBe(300);
    expect(await balance('101.02')).toBe(0);
  });

  it('alınan senet: 121.01 → teminat 121.03 → geri al 121.01 → ciro 320/121.01', async () => {
    const s = await create('incoming', 500, 'promissory');
    expect(await balance('121.01')).toBe(500);
    await act(() =>
      cheques.pledgeCheque(
        s.id,
        { party_name: 'X Bankası', transaction_date: '2026-06-03' },
        t.userId,
        t.tenantId,
      ),
    );
    expect(await balance('121.03')).toBe(500);
    expect(await balance('121.01')).toBe(0);
    await act(() =>
      cheques.releaseCheque(s.id, { transaction_date: '2026-06-10' }, t.userId, t.tenantId),
    );
    expect(await balance('121.01')).toBe(500);
    await act(() =>
      cheques.endorseCheque(
        s.id,
        { to_holder: 'supplier', party_name: 'Tedarikçi', transaction_date: '2026-06-12' },
        t.userId,
        t.tenantId,
      ),
    );
    expect(await balance('121.01')).toBe(0);
    expect(await balance('320')).toBe(500);
  });

  it('verilen çek: 320/103 → ödenince 103/102.xx', async () => {
    const before320 = await balance('320');
    const c = await create('outgoing', 200);
    expect(await balance('103')).toBe(-200);
    expect((await balance('320')) - before320).toBe(200);
    const beforeBank = await balance(await bankCode());
    await act(() =>
      cheques.collectCheque(
        c.id,
        { cash_bank_account_id: bank, transaction_date: '2026-07-01' },
        t.userId,
        t.tenantId,
      ),
    );
    expect(await balance('103')).toBe(0);
    expect((await balance(await bankCode())) - beforeBank).toBe(-200);
  });

  it('portföydeki çek iptal edilirse alış fişi ters kayıtla düzeltilir', async () => {
    const before = await balance('101.01');
    const c = await create('incoming', 70);
    expect((await balance('101.01')) - before).toBe(70);
    await act(() => cheques.cancelCheque(c.id, { reason: 'Hatalı giriş' }, t.userId, t.tenantId));
    expect((await balance('101.01')) - before).toBe(0);
  });

  it('muhasebe kapalıyken alınan (eski) çek: tahsilde karşı hesap 120 olur, 101 bozulmaz', async () => {
    await m().query(
      `UPDATE tenant_entitlements SET status = 'revoked' WHERE tenant_id = $1 AND module_code = 'accounting'`,
      [t.tenantId],
    );
    const c = await create('incoming', 90);
    await grantAccounting(t);
    const before101 = await balance('101.01');
    const before120 = await balance('120');
    await act(() =>
      cheques.collectCheque(
        c.id,
        { cash_bank_account_id: bank, transaction_date: '2026-07-01' },
        t.userId,
        t.tenantId,
      ),
    );
    expect(await balance('101.01')).toBe(before101);
    expect((await balance('120')) - before120).toBe(-90);
  });
});
