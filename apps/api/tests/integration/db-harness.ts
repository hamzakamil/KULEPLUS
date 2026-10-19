/**
 * Gerçek PostgreSQL entegrasyon test zemini (Faz 0 — muhasebe çekirdeği düzeltmeleri).
 *
 * Neden: `accounting.test.ts` gibi testler sahte havuz kullanır; SQL parametre hataları,
 * CHECK/trigger/RLS davranışları orada yakalanmaz. Bu testler gerçek şemaya karşı koşar.
 *
 * Çalıştırma (migration'lar uygulanmış bir DB gerekir: `npm run migrate -w packages/db`):
 *   PowerShell: $env:INTEGRATION_DB='1'; npm run test:integration -w apps/api
 *   bash:       INTEGRATION_DB=1 npm run test:integration -w apps/api
 * Dosyalar SIRALI çalışır (`--no-file-parallelism`): migration'ı yeniden oynatan testler tüm
 * tenant'ların satırlarını günceller; paralel dosyalarla kilitlenme (deadlock) üretir.
 * `INTEGRATION_DB=1` yoksa bu dosyayı kullanan testler atlanır (CI/yerel akış bozulmaz).
 *
 * Bağlantı: kök `.env` içindeki DATABASE_URL (app_user, RLS'e tabi — servis bunu kullanır)
 * ve DATABASE_MIGRATOR_URL (tohumlama/temizlik; RLS'i baypas eder).
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { beginTenantScope, closePool, getPool, runWithTenantScope } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';
import { accountingService } from '../../src/modules/accounting/service';
import type { CreateJournalEntryInput } from '../../src/modules/accounting/schemas';

loadEnv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

export const integrationEnabled = process.env.INTEGRATION_DB === '1';

export interface TestTenant {
  tenantId: string;
  userId: string;
}

/** Tenant + kullanıcı + TDHP hesap planı kurar (migrator havuzuyla; RLS baypas). */
export async function createTestTenant(): Promise<TestTenant> {
  const migrator = getPool('migrator');
  const tenantId = newId();
  const userId = newId();
  await migrator.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, [
    userId,
    `it-${userId}@test.local`,
  ]);
  await migrator.query(`INSERT INTO tenants (id, name, status) VALUES ($1, $2, 'active')`, [
    tenantId,
    `IT ${tenantId.slice(0, 8)}`,
  ]);
  await migrator.query(
    `INSERT INTO tenant_users (tenant_id, user_id, is_owner) VALUES ($1, $2, true)`,
    [tenantId, userId],
  );
  await accountingService.ensureChartOfAccounts(tenantId);
  return { tenantId, userId };
}

/** Test verisini FK sırasına uyarak siler (journal_* RESTRICT FK'leri yüzünden sıralı). */
export async function cleanupTestTenant(t: TestTenant): Promise<void> {
  // Tek transaction: ertelenmiş denge trigger'ı COMMIT'te çalışır; satırlar ve
  // başlıklar birlikte silindiğinde "satırsız onaylı fiş" ara durumu görülmez.
  const m = await getPool('migrator').connect();
  try {
    await m.query('BEGIN');
    await m.query(
      'DELETE FROM invoice_payments WHERE invoice_id IN (SELECT id FROM invoices WHERE tenant_id = $1)',
      [t.tenantId],
    );
    await m.query(
      'DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE tenant_id = $1)',
      [t.tenantId],
    );
    await m.query('DELETE FROM invoices WHERE tenant_id = $1', [t.tenantId]);
    await m.query('DELETE FROM invoice_sequences WHERE tenant_id = $1', [t.tenantId]);
    await m.query('DELETE FROM credit_cards WHERE tenant_id = $1', [t.tenantId]);
    await m.query('DELETE FROM cash_bank_accounts WHERE tenant_id = $1', [t.tenantId]);
    await m.query('UPDATE journal_entries SET reversal_of_id = NULL WHERE tenant_id = $1', [
      t.tenantId,
    ]);
    await m.query('DELETE FROM journal_lines WHERE tenant_id = $1', [t.tenantId]);
    await m.query('DELETE FROM journal_entries WHERE tenant_id = $1', [t.tenantId]);
    await m.query('DELETE FROM period_locks WHERE tenant_id = $1', [t.tenantId]);
    await m.query('DELETE FROM account_mappings WHERE tenant_id = $1', [t.tenantId]);
    await m.query('DELETE FROM fiscal_periods WHERE tenant_id = $1', [t.tenantId]);
    await m.query('DELETE FROM accounting_accounts WHERE tenant_id = $1', [t.tenantId]);
    await m.query('DELETE FROM tenants WHERE id = $1', [t.tenantId]);
    await m.query('DELETE FROM users WHERE id = $1', [t.userId]);
    await m.query('COMMIT');
  } catch (err) {
    await m.query('ROLLBACK');
    throw err;
  } finally {
    m.release();
  }
}

export async function closeAllPools(): Promise<void> {
  await closePool();
}

/** Hesap kodundan hesap id'si (tenant planında). */
export async function accountId(t: TestTenant, code: string): Promise<string> {
  const r = await getPool('migrator').query(
    'SELECT id FROM accounting_accounts WHERE tenant_id = $1 AND code = $2',
    [t.tenantId, code],
  );
  if (r.rows.length === 0) throw new Error(`Hesap bulunamadı: ${code}`);
  return r.rows[0].id as string;
}

export interface LineSpec {
  code: string;
  debit?: number;
  credit?: number;
}

/** Servis üzerinden fiş yazar (varsayılan: onaylı, 2026-03-15). */
export async function writeEntry(
  t: TestTenant,
  lines: LineSpec[],
  opts: Partial<
    Pick<CreateJournalEntryInput, 'status' | 'entry_date' | 'entry_type' | 'description'>
  > = {},
) {
  const mapped = [];
  for (const l of lines) {
    mapped.push({
      account_id: await accountId(t, l.code),
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
    });
  }
  return accountingService.createEntry(
    {
      entry_date: opts.entry_date ?? '2026-03-15',
      entry_type: opts.entry_type ?? 'mahsup',
      status: opts.status ?? 'posted',
      description: opts.description ?? 'IT fişi',
      lines: mapped,
    } as CreateJournalEntryInput,
    t.userId,
    t.tenantId,
  );
}

/** Yıla göre mali dönem id'si (create* dönüş değerine güvenmeden). */
export async function periodIdByYear(t: TestTenant, year: number): Promise<string> {
  const r = await getPool('migrator').query(
    'SELECT id FROM fiscal_periods WHERE tenant_id = $1 AND year = $2',
    [t.tenantId, year],
  );
  if (r.rows.length === 0) throw new Error(`Dönem bulunamadı: ${year}`);
  return r.rows[0].id as string;
}

/** Yıla göre mali dönem satırı (yoksa undefined). */
export async function periodRow(t: TestTenant, year: number) {
  const r = await getPool('migrator').query(
    'SELECT id, status FROM fiscal_periods WHERE tenant_id = $1 AND year = $2',
    [t.tenantId, year],
  );
  return r.rows[0] as { id: string; status: string } | undefined;
}

/** Servisleri istek-scoped tenant bağlamında çalıştırır (API'deki tenantContext eşdeğeri). */
export async function withTenantScope<T>(t: TestTenant, fn: () => Promise<T>): Promise<T> {
  const { scope, finish } = await beginTenantScope(getPool('app'), t.tenantId);
  try {
    const result = await runWithTenantScope(scope, fn);
    await finish(true);
    return result;
  } catch (err) {
    await finish(false);
    throw err;
  }
}

/** Tenant'a `accounting` modül hakkı verir. */
export async function grantAccounting(t: TestTenant): Promise<void> {
  await getPool('migrator').query(
    `INSERT INTO tenant_entitlements (tenant_id, module_code, status) VALUES ($1, 'accounting', 'active')
     ON CONFLICT (tenant_id, module_code) DO UPDATE SET status = 'active', expires_at = NULL`,
    [t.tenantId],
  );
}
