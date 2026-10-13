import type { PoolClient } from 'pg';
import { newId } from '@kuleplus/shared';
import { TDHP_ACCOUNTS } from './tdhp';

/**
 * Verilen transaction client'ı üzerinde TDHP hesap planını **idempotent** bootstrap eder.
 * Hesap planı zaten doluysa (COUNT > 0) hiçbir şey yapmaz.
 *
 * Neden ayrı yardımcı: hem `AccountingService.ensureChartOfAccounts` (kendi
 * transaction'ı) hem de otomatik muhasebeleştirme (fatura/tahsilat — kendi
 * transaction'ı içinde) aynı mantığı paylaşır; ayrı bağlantı açmadan çalışır.
 */
export async function ensureChartOfAccountsOn(client: PoolClient): Promise<number> {
  const existing = await client.query(
    'SELECT COUNT(*) AS total FROM accounting_accounts WHERE tenant_id = current_tenant_id()',
  );
  if (Number(existing.rows[0].total) > 0) return 0;

  let inserted = 0;
  for (const [code, name, type] of TDHP_ACCOUNTS) {
    await client.query(
      `INSERT INTO accounting_accounts (id, tenant_id, code, name, type, is_tdphp)
       VALUES ($1, current_tenant_id(), $2, $3, $4, true)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [newId(), code, name, type],
    );
    inserted++;
  }
  return inserted;
}
