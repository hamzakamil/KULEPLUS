/**
 * Golden test altyapısı — gerçek şemaya uygun sahte (in-memory) DB yardımcıları.
 *
 * Neden sahte DB? `apps/api` testleri gerçek Postgres'e bağlanmaz; servisler
 * `getPool('app')` yerine yapıcıya verilen sahte havuzu kullanır, SQL eşleştirilip
 * sahte satırlar döndürülür (bkz. `invoice-posting.test.ts`, `accounting.test.ts`).
 * Gerçek DB entegrasyonu CI'daki ayrı Postgres adımındadır.
 *
 * Şema notları (202610050001_core_schema.sql):
 * - `users` PLATFORM kullanıcısıdır; `tenant_id`/`name`/`slug` kolonu YOKTUR.
 * - Tenant ↔ kullanıcı bağlantısı `tenant_users(tenant_id, user_id, is_owner)`.
 * - Yetki zinciri: `tenant_user_roles → roles → role_permissions → permissions`.
 *   (`tenant_user_permissions` gibi bir tablo YOKTUR.)
 */

import { vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';

export interface FakeDbOptions {
  /** `tenant_users.is_owner` bağlantı sorgusu sonucu. */
  isOwner?: boolean;
  /** Rol zincirinden çözülen permission kodları. */
  permissionCodes?: string[];
  /** Eşleşmeyen veri sorguları için varsayılan satırlar. */
  defaultRows?: Record<string, unknown>[];
}

/**
 * `InvoiceService(pool)` gibi servislere verilebilecek sahte havuz üretir.
 * BEGIN/COMMIT/ROLLBACK otomatik geçer; `is_owner`/izin sorguları yapılandırılmış
 * değerleri döner; diğer her şey `defaultRows`. Testte `clientQuery.mockImplementation`
 * ile senaryoya göre özelleştirilir.
 */
export function createFakePool(options: FakeDbOptions = {}) {
  const { isOwner = true, permissionCodes = [], defaultRows = [] } = options;
  const clientQuery = vi.fn(async (sql: string) => {
    const s = String(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim())) return { rows: [], rowCount: 0 };
    if (s.includes('FROM tenant_users') && s.includes('is_owner')) {
      return { rows: [{ is_owner: isOwner }], rowCount: 1 };
    }
    if (s.includes('SELECT DISTINCT p.code')) {
      return { rows: permissionCodes.map((code) => ({ code })), rowCount: permissionCodes.length };
    }
    return { rows: defaultRows, rowCount: defaultRows.length };
  });

  const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
  const pool = {
    query: clientQuery,
    connect: vi.fn(async () => client),
  } as unknown as Pool & { connect: ReturnType<typeof vi.fn> };

  return { pool, client, clientQuery };
}

/** Deterministik golden test kimlikleri. */
export const GOLDEN_TENANT_ID = '11111111-1111-1111-1111-111111111111';
export const GOLDEN_USER_ID = '22222222-2222-2222-2222-222222222222';
