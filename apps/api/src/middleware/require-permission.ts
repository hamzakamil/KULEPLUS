import type { NextFunction, Request, Response } from 'express';
import { AppError, isValidPermissionCode } from '@kuleplus/shared';
import type { AuthenticatedRequest } from './auth.js';
import type { TenantRequest } from './tenant.js';
import { loadPermissionGrants, type PermissionGrants } from './permission-grants.js';

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
const grantCache = new WeakMap<Request, Promise<PermissionGrants>>();

/**
 * İstek içi önbellek: aynı istekte birden fazla `requirePermission` varsa izin
 * sorgusu bir kez çalışır. Çözümleme mantığı `permission-grants.ts`te (tek kaynak).
 */
function grantsFor(req: Request): Promise<PermissionGrants> {
  let grants = grantCache.get(req);
  if (!grants) {
    const tenantId =
      (req as TenantRequest).tenantId ?? (req as AuthenticatedRequest).user?.tenantId;
    const userId = (req as AuthenticatedRequest).user?.sub;
    grants = loadPermissionGrants(tenantId, userId);
    grantCache.set(req, grants);
  }
  return grants;
}

export function requirePermission(...required: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { isOwner, codes } = await grantsFor(req);

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
