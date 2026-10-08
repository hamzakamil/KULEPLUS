import { type Response, type NextFunction } from 'express';
import { AppError } from '@kuleplus/shared';
import { PlatformService } from '../modules/platform/service';
import type { AuthenticatedRequest } from './auth';

/**
 * Platform yetkilendirme — SPEC §5.1, ADR-0003.
 *
 * İki aşamalı: (1) kullanıcı platform kullanıcısı mı? (2) gereken rol/owner mı?
 * Çapraz tenant ERİŞİMİ bu middleware ile verilmez; o yalnızca support_access_grants ile olur.
 */

const service = new PlatformService();

export interface PlatformRequest extends AuthenticatedRequest {
  platformUser?: { id: string; userId: string; isOwner: boolean; roles: string[] };
}

/** Platform kullanıcısı olmayı zorunlu kılar (aktif üyelik). */
export function requirePlatformUser() {
  return async (req: PlatformRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');

      const platformUser = await service.getPlatformUserByUserId(userId);
      if (!platformUser || platformUser.status !== 'active') {
        throw new AppError('FORBIDDEN', 'Platform yetkisi gerekli');
      }

      const roles = await service.getPlatformRoles(platformUser.id);
      req.platformUser = {
        id: platformUser.id,
        userId: platformUser.user_id,
        isOwner: platformUser.is_platform_owner,
        roles,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Yalnızca platform_owner (başvuru onayı, plan kataloğu, owner benzeri işlemler). */
export function requirePlatformOwner() {
  return async (req: PlatformRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.platformUser?.isOwner) {
        throw new AppError('FORBIDDEN', 'Bu işlem için platform_owner yetkisi gerekli');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Belirli platform rolü veya owner zorunlu kılar.
 * Örnek: requirePlatformRole('platform_support') — destek grant'ı açabilmek için.
 */
export function requirePlatformRole(roleCode: string) {
  return async (req: PlatformRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const pu = req.platformUser;
      if (!pu) throw new AppError('FORBIDDEN', 'Platform yetkisi gerekli');
      if (!pu.isOwner && !pu.roles.includes(roleCode)) {
        throw new AppError('FORBIDDEN', `Bu işlem için ${roleCode} rolü gerekli`);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
