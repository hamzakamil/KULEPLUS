import type { NextFunction, Request, Response } from 'express';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { TenantRequest } from './tenant.js';

/**
 * Entitlement kapısı — SPEC §8.5, TECHNICAL_SPEC §5.1 ("Modül kapalıysa
 * backend endpoint'i MODULE_NOT_ENTITLED döner").
 *
 * `tenantContext`ten SONRA çalışmalıdır (req.tenantId hazır olur).
 */
export function requireEntitlement(moduleCode: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = (req as TenantRequest).tenantId ?? (req as TenantRequest).user?.tenantId;
      if (!tenantId) {
        next(new AppError('UNAUTHENTICATED', 'Tenant context yok'));
        return;
      }
      const result = await getPool('app').query<{ status: string }>(
        `SELECT status FROM tenant_entitlements WHERE tenant_id = $1 AND module_code = $2`,
        [tenantId, moduleCode],
      );
      const status = result.rows[0]?.status;
      if (status !== 'active') {
        next(new AppError('MODULE_NOT_ENTITLED', `Bu modül paketinizde yok: ${moduleCode}`));
        return;
      }
      next();
    } catch (error) {
      next(error as Error);
    }
  };
}
