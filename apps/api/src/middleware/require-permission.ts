import type { NextFunction, Request, Response } from 'express';
import { getPool } from '@kuleplus/db';
import { AppError, isValidPermissionCode } from '@kuleplus/shared';
import type { AuthenticatedRequest } from './auth.js';
import type { TenantRequest } from './tenant.js';

/**
 * RBAC kapısı — SPEC §6.3 değerlendirme zinciri:
 * `WHO → Tenant Membership → Role(s) → Permission → Scope → ALLOW/DENY`.
 *
 * Neden gerekli? `packages/shared/permissions.ts` kataloğu ve `role_permissions`
 * tablosu vardı ama hiçbir route'ta zorlanmıyordu; tenant üyesi HER kimlikli
 * kullanıcı yönetici uçlarını çağırabiliyordu (P0 güvenlik açığı).
 *
 * Kurallar:
 * - `authenticate` SONRASI ve (varsa) `tenantContext`/`requireEntitlement`
 *   SONRASI çalışmalıdır (`req.tenantId` / `req.user` hazır olur).
 * - Owner (`tenant_users.is_owner`) tüm izinlere sahiptir (SPEC §6.6: OWNER tek
 *   ve tüm yetkileri taşır) → kontrol otomatik geçer; kurulum kesintiye uğramaz.
 * - Diğer kullanıcılar: rollerinin `role_permissions → permissions` birleşimi
 *   istenen kodlardan EN AZ BİRİNİ içermelidir. İzin yoksa → 403 FORBIDDEN.
 * - İstek içi önbellek: aynı istekte birden fazla `requirePermission` varsa
 *   izin sorgusu bir kez çalışır (WeakMap).
 * - `isValidPermissionCode` başarısız olursa (katalogda olmayan kod) geliştirme
 *   hatasıdır — 500 yerine açık FORBIDDEN + konsol uyarısı verilir.
 */
const grantCache = new WeakMap<Request, Promise<{ isOwner: boolean; codes: Set<string> }>>();

async function loadGrants(
  req: Request,
): Promise<{ isOwner: boolean; codes: Set<string> }> {
  const tenantId =
    (req as TenantRequest).tenantId ?? (req as AuthenticatedRequest).user?.tenantId;
  const userId = (req as AuthenticatedRequest).user?.sub;
  if (!tenantId || !userId) {
    throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
  }

  const pool = getPool('app');

  // Owner mu? (tenant_users is_owner — SPEC §6.6) — üyelik yoksa satır gelmez → fail-closed.
  const ownerResult = await pool.query<{ is_owner: boolean }>(
    `SELECT is_owner FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
    [tenantId, userId],
  );
  const isOwner = ownerResult.rows[0]?.is_owner ?? false;
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

  return { isOwner, codes };
}

export function requirePermission(...required: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let grants = grantCache.get(req);
      if (!grants) {
        grants = loadGrants(req);
        grantCache.set(req, grants);
      }
      const { isOwner, codes } = await grants;

      if (isOwner) {
        next();
        return;
      }

      // "ALL" semantiği: verilen kodların TAMAMI istenir (daha sıkı, güvenli taraf).
      const missing = required.filter((code) => !codes.has(code));
      if (missing.length === 0) {
        next();
        return;
      }

      // Katalogda olmayan kod = geliştirme hatası; logla ama sözleşmeyi bozma.
      for (const code of required) {
        if (!isValidPermissionCode(code)) {
          req.log?.error?.(
            { code },
            'requirePermission: katalogda olmayan izin kodu (permissions.ts güncellenmeli)',
          );
        }
      }

      req.log?.warn?.({ missing }, 'RBAC reddi');
      next(new AppError('FORBIDDEN', 'Bu işlem için gerekli yetkiniz yok'));
    } catch (error) {
      next(error as Error);
    }
  };
}
