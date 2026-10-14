import { getPool, withTenant } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';

/**
 * Platform yönetimi servisi — SPEC §5.1, ADR-0003.
 *
 * Kural: Çapraz tenant erişimi YALNIZCA `support_access_grants` ile, süreli ve gerekçeli.
 * Grant olmadan hiçbir platform kullanıcısı tenant verisi göremez (SPEC §5.1).
 * Tek platform_owner; kısmi unique index ile korunur (migration).
 */

export interface PlatformUserRow {
  id: string;
  user_id: string;
  is_platform_owner: boolean;
  status: 'active' | 'suspended' | 'removed';
  email?: string;
}

export interface SupportGrantRow {
  id: string;
  tenant_id: string;
  platform_user_id: string;
  reason: string;
  scope: 'read_only' | 'read_write';
  granted_by: string;
  granted_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export class PlatformService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;

  constructor(pool?: Pool) {
    this.providedPool = pool ?? null;
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  /** Kullanıcının platform üyeliğini getir (yoksa null). */
  async getPlatformUserByUserId(userId: string): Promise<PlatformUserRow | null> {
    const result = await this.getPoolInstance().query<PlatformUserRow>(
      `SELECT pu.id, pu.user_id, pu.is_platform_owner, pu.status, u.email
       FROM platform_users pu
       JOIN users u ON u.id = pu.user_id
       WHERE pu.user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  /** Platform kullanıcısının rol kodlarını getir. */
  async getPlatformRoles(platformUserId: string): Promise<string[]> {
    const result = await this.getPoolInstance().query<{ role_code: string }>(
      `SELECT role_code FROM platform_user_roles WHERE platform_user_id = $1`,
      [platformUserId],
    );
    return result.rows.map((r) => r.role_code);
  }

  /**
   * Platform kullanıcısı oluşturur. `platform_owner` yalnızca tek olabilir;
   * ikinci owner kısmi unique index ile reddedilir (ADR-0003).
   */
  async createPlatformUser(input: {
    userId: string;
    isPlatformOwner?: boolean;
    roleCodes?: string[];
    grantedBy?: string;
  }): Promise<{ id: string }> {
    const now = new Date();
    const id = newId();
    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO platform_users (id, user_id, is_platform_owner, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', $4, $4)`,
        [id, input.userId, input.isPlatformOwner ?? false, now],
      );

      for (const roleCode of input.roleCodes ?? []) {
        await client.query(
          `INSERT INTO platform_user_roles (platform_user_id, role_code, granted_at, granted_by)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [id, roleCode, now, input.grantedBy ?? null],
        );
      }

      await client.query('COMMIT');
      return { id };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && error.message.includes('uq_platform_owner')) {
        throw new AppError('CONFLICT', 'Zaten aktif bir platform_owner var');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Destek erişim grantı açar — gerekçe ve süre ZORUNLU, her kullanım audit'li (SPEC §5.1).
   */
  async grantSupportAccess(input: {
    tenantId: string;
    platformUserId: string;
    reason: string;
    scope: 'read_only' | 'read_write';
    expiresInHours: number;
    grantedBy: string;
  }): Promise<{ id: string }> {
    if (!input.reason || input.reason.trim().length < 10) {
      throw new AppError('VALIDATION_ERROR', 'Gerekçe zorunludur (en az 10 karakter)');
    }
    if (input.expiresInHours <= 0 || input.expiresInHours > 24 * 30) {
      throw new AppError('VALIDATION_ERROR', 'Süre 0 ile 720 saat arasında olmalıdır');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiresInHours * 60 * 60 * 1000);
    const id = newId();

    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO support_access_grants
           (id, tenant_id, platform_user_id, reason, scope, granted_by, granted_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          input.tenantId,
          input.platformUserId,
          input.reason,
          input.scope,
          input.grantedBy,
          now,
          expiresAt,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, new_values, created_at)
         VALUES ($1, $2, NULL, 'support_access_grant.granted', 'support_access_grant', $3, $4, $5)`,
        [newId(), input.tenantId, id, JSON.stringify({ scope: input.scope, expiresAt }), now],
      );

      await client.query('COMMIT');
      return { id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Aktif (süresi dolmamış, iptal edilmemiş) grant var mı? */
  async hasActiveGrant(platformUserId: string, tenantId: string): Promise<SupportGrantRow | null> {
    const result = await this.getPoolInstance().query<SupportGrantRow>(
      `SELECT * FROM support_access_grants
       WHERE platform_user_id = $1 AND tenant_id = $2
         AND revoked_at IS NULL AND expires_at > now()
       ORDER BY expires_at DESC LIMIT 1`,
      [platformUserId, tenantId],
    );
    return result.rows[0] ?? null;
  }

  /** Grant'ı iptal et. */
  async revokeGrant(grantId: string, revokedBy: string): Promise<void> {
    const result = await this.getPoolInstance().query(
      `UPDATE support_access_grants SET revoked_at = now(), revoked_by = $2
       WHERE id = $1 AND revoked_at IS NULL`,
      [grantId, revokedBy],
    );
    if (result.rowCount === 0) {
      throw new AppError('NOT_FOUND', 'Aktif grant bulunamadı');
    }
  }

  /** Grant'ı kullanarak tenant bağlamında sorgu çalıştır (audit'li). */
  async readTenantDataWithGrant<T>(
    platformUserId: string,
    tenantId: string,
    query: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const grant = await this.hasActiveGrant(platformUserId, tenantId);
    if (!grant) {
      throw new AppError('SUPPORT_ACCESS_REQUIRED', 'Aktif destek erişim grantı yok');
    }

    await this.getPoolInstance().query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, created_at)
       VALUES ($1, $2, NULL, 'support_access_grant.used', 'support_access_grant', $3, now())`,
      [newId(), tenantId, grant.id],
    );

    // Tenant bağlamı transaction-local kurulur (SPEC §7.1)
    return withTenant(this.getPoolInstance(), tenantId, (client) => query(client));
  }
}

export default PlatformService;

// ===== Platform paneli sorguları (SPEC §28.1) =====
// Not: Bu fonksiyonlar modül dışından kullanıldığı için modül seviyesinde tanımlıdır.

import { getPool as getDbPool } from '@kuleplus/db';

const sharedPool = () => getDbPool('app');

export interface TenantListRow {
  id: string;
  name: string;
  status: string;
  created_at: Date;
  member_count?: number;
}

/** Tenant listesi (durum filtresi + offset pagination — ADR-0014). */
export async function listTenants(filters: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: TenantListRow[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const offset = (page - 1) * limit;
  const params: unknown[] = [];
  let where = '';
  if (filters.status) {
    params.push(filters.status);
    where = `WHERE status = $1`;
  }

  const totalResult = await sharedPool().query<{ total: string }>(
    `SELECT COUNT(*)::bigint AS total FROM tenants ${where}`,
    params,
  );
  const listResult = await sharedPool().query<TenantListRow>(
    `SELECT id, name, status, created_at FROM tenants ${where}
     ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return { items: listResult.rows, total: Number(totalResult.rows[0]?.total ?? 0) };
}

/** Tek tenant detayı (üye sayısı ile). */
export async function getTenantDetail(
  tenantId: string,
): Promise<(TenantListRow & { memberCount: number; entitlements: string[] }) | null> {
  const result = await sharedPool().query<TenantListRow>(
    `SELECT id, name, status, created_at FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const tenant = result.rows[0];
  if (!tenant) return null;

  const members = await sharedPool().query<{ count: string }>(
    `SELECT COUNT(*)::bigint AS count FROM tenant_users WHERE tenant_id = $1`,
    [tenantId],
  );
  const ent = await sharedPool().query<{ module_code: string }>(
    `SELECT module_code FROM tenant_entitlements WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId],
  );

  return {
    ...tenant,
    memberCount: Number(members.rows[0]?.count ?? 0),
    entitlements: ent.rows.map((r) => r.module_code),
  };
}

/** Tenant durumunu değiştir + audit (SPEC §5.3). */
export async function updateTenantStatus(
  tenantId: string,
  status: 'active' | 'suspended' | 'closed' | 'archived',
  actorUserId: string,
): Promise<void> {
  const result = await sharedPool().query(
    `UPDATE tenants SET status = $2, updated_at = now(), version = version + 1 WHERE id = $1`,
    [tenantId, status],
  );
  if (result.rowCount === 0) {
    throw new AppError('NOT_FOUND', 'Tenant bulunamadı');
  }
  await sharedPool().query(
    `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, new_values, created_at)
     VALUES ($1, $2, $3, 'tenant.status_changed', 'tenant', $2, $4, now())`,
    [newId(), tenantId, actorUserId, JSON.stringify({ status })],
  );
}

/** Destek erişim grantları (opsiyonel tenant filtresi). */
export async function listSupportGrants(tenantId?: string): Promise<SupportGrantRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (tenantId) {
    params.push(tenantId);
    where = `WHERE tenant_id = $1`;
  }
  const result = await sharedPool().query<SupportGrantRow>(
    `SELECT * FROM support_access_grants ${where} ORDER BY granted_at DESC LIMIT 200`,
    params,
  );
  return result.rows;
}

/** Platform düzeyi denetim kayıtları (cursor pagination — ADR-0014). */
export async function listPlatformAudit(filters: {
  tenantId?: string;
  action?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ items: unknown[]; nextCursor: string | null }> {
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.tenantId) {
    params.push(filters.tenantId);
    conditions.push(`tenant_id = $${params.length}`);
  }
  if (filters.action) {
    params.push(filters.action);
    conditions.push(`action = $${params.length}`);
  }
  if (filters.cursor) {
    params.push(filters.cursor);
    conditions.push(`id > $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await sharedPool().query(
    `SELECT id, tenant_id, user_id, action, entity_type, entity_id, created_at
     FROM audit_logs ${where} ORDER BY id ASC LIMIT $${params.length + 1}`,
    [...params, limit + 1],
  );

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (items[items.length - 1]?.id as string) : null;
  return { items, nextCursor };
}
