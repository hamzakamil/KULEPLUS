import { AsyncLocalStorage } from 'node:async_hooks';
import type * as pg from 'pg';

/** Tenant GUC adı (SQL `current_tenant_id()` buradan okur) */
export const TENANT_GUC = 'app.tenant_id';

/**
 * Tenant bağlamı — SPEC §7 + ROADMAP Faz 0:
 * "RLS iskeleti: set_config('app.tenant_id', $1, true) transaction-local bağlam"
 * ve `withTenant()` yardımcı fonksiyonu.
 *
 * Kurallar:
 * - Bağlam transaction içinde kurulur (local) → transaction bitince sıfırlanır.
 * - Başarısız iş rollback edilir; bağlantı pool'a iade edilir.
 */

/**
 * İstek-scoped tenant bağlamı (AsyncLocalStorage).
 *
 * Arka plan: `pool.query('SELECT set_config(...)')` tek başına bir bağlantıda
 * çalışır; sonraki `pool.query` çağrıları FARKLI bağlantılara gidebilir
 * (pool max 20) ve `current_tenant_id()` null döner. Bu yüzden istek başına
 * ayrılmış bir bağlantı + transaction + ALS gerekir; `TenantAwarePool`
 * (client.ts) kapsam içindeki tüm `query` çağrılarını bu bağlantıya yönlendirir.
 */
export type TenantScope = {
  client: pg.PoolClient;
  tenantId: string;
};

const tenantScopeStorage = new AsyncLocalStorage<TenantScope>();

/** Aktif istek kapsamı (yoksa undefined — worker/script/test yolu) */
export function getTenantScope(): TenantScope | undefined {
  return tenantScopeStorage.getStore();
}

/** Kapsam içinde çalıştır (Express middleware zinciri buradan girer) */
export function runWithTenantScope<T>(scope: TenantScope, fn: () => T): T {
  return tenantScopeStorage.run(scope, fn);
}

/**
 * İstek-scoped transaction açar: BEGIN + local GUC.
 * `finish(true)` → COMMIT, `finish(false)` → ROLLBACK; her ikisi de bağlantıyı iade eder.
 */
export async function beginTenantScope(
  pool: pg.Pool,
  tenantId: string,
): Promise<{ scope: TenantScope; finish: (commit: boolean) => Promise<void> }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [TENANT_GUC, tenantId]);
  } catch (error) {
    client.release();
    throw error;
  }
  const scope: TenantScope = { client, tenantId };
  let settled = false;
  const finish = async (commit: boolean): Promise<void> => {
    if (settled) return;
    settled = true;
    try {
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    } finally {
      client.release();
    }
  };
  return { scope, finish };
}
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
