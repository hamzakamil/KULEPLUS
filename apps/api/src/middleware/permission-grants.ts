import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';

/**
 * RBAC izin çözümlemesi — TEK KAYNAK (SPEC §6.3).
 *
 * Neden ayrıldı? Aynı sorgu iki yerde lazımdı:
 *  1) `requirePermission` middleware'i (endpoint kapısı),
 *  2) `GET /api/v1/auth/me` (frontend'in menü/yönlendirme için rol + izin listesi).
 * Kopyalanırsa biri güncellenip diğeri unutulabilir → yetki saptırması. DRY (§1).
 *
 * Kurallar:
 * - Owner (`tenant_users.is_owner`) tüm izinlere sahiptir (SPEC §6.6) → `codes` boş
 *  döner; çağıran taraf `isOwner` görürse kataloğun tamamını yetkili sayar.
 * - Owner tek başına yetmez: `tenant_users` satırı yoksa (üyelik silinmiş) sorgu
 *  satır dönmez → `isOwner=false` + boş `codes` → fail-closed.
 * - Sorgular core tablolara gider (RLS yok) ve `tenant_id` filtresi AÇIK tutulur
 *  (SPEC §7.0: `permissions` globaldir, roller/rol_permissions tenant bazlıdır).
 */
export interface PermissionGrants {
  /** `tenant_users.is_owner` — OWNER tüm izinleri taşır. */
  isOwner: boolean;
  /** Kullanıcının tenant içindeki rolleri — yalnızca `withRoles: true` ise dolu. */
  roles: { id: string; name: string; code: string | null }[];
  /** Rollerin izin kodlarının birleşimi (owner için boş bırakılır). */
  codes: Set<string>;
}

export interface LoadGrantsOptions {
  /** Rol adları `/auth/me` için gerekir; izin kontrolü başına ek sorgu atmak istemeyiz. */
  withRoles?: boolean;
}

export async function loadPermissionGrants(
  tenantId: string | undefined,
  userId: string | undefined,
  options: LoadGrantsOptions = {},
): Promise<PermissionGrants> {
  if (!tenantId || !userId) {
    throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
  }

  const pool = getPool('app');

  // Owner mu? (SPEC §6.6) — üyelik yoksa satır gelmez → fail-closed.
  const ownerResult = await pool.query<{ is_owner: boolean }>(
    `SELECT is_owner FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
    [tenantId, userId],
  );
  const isOwner = ownerResult.rows[0]?.is_owner ?? false;

  const roles: PermissionGrants['roles'] = [];
  if (options.withRoles) {
    const roleResult = await pool.query<{ id: string; name: string; code: string | null }>(
      `SELECT r.id, r.name, r.code
         FROM tenant_user_roles tur
         JOIN roles r ON r.id = tur.role_id AND r.tenant_id = tur.tenant_id
        WHERE tur.tenant_id = $1 AND tur.user_id = $2
        ORDER BY r.name`,
      [tenantId, userId],
    );
    roles.push(...roleResult.rows);
  }

  const codes = new Set<string>();
  if (!isOwner) {
    // Kullanıcının rollerinin izin kodlarını çöz — RLS'siz zincir (core tablolar),
    // tenant_id filtreleri açık bekletilir (SPEC §7.0: permissions globaldir).
    const permResult = await pool.query<{ code: string }>(
      `SELECT DISTINCT p.code
         FROM tenant_user_roles tur
         JOIN roles r ON r.id = tur.role_id AND r.tenant_id = tur.tenant_id
         JOIN role_permissions rp ON rp.tenant_id = tur.tenant_id
               AND rp.role_id = tur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE tur.tenant_id = $1 AND tur.user_id = $2`,
      [tenantId, userId],
    );
    for (const row of permResult.rows) codes.add(row.code);
  }

  return { isOwner, roles, codes };
}
