import type * as pg from 'pg';

/**
 * Tenant bağlamı — SPEC §7 + ROADMAP Faz 0:
 * "RLS iskeleti: set_config('app.tenant_id', $1, true) transaction-local bağlam"
 * ve `withTenant()` yardımcı fonksiyonu.
 *
 * Kurallar:
 * - Bağlam transaction içinde kurulur (local) → transaction bitince sıfırlanır.
 * - Başarısız iş rollback edilir; bağlantı pool'a iade edilir.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // rollback hatası orijinal hatayı maskelemez
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * SQL dosya adı kuralı — SPEC §30.7:
 * "Migration adlandırma YYYYMMDDHHMM_<slug>.sql; her migration'ın down SQL'i zorunlu."
 */
export const MIGRATION_FILE_RE = /^\d{12}_[a-z0-9_]+\.sql$/;

export function isValidMigrationName(fileName: string): boolean {
  return MIGRATION_FILE_RE.test(fileName);
}
