import { Router, type Response, type NextFunction } from 'express';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireModule, checkLimit, incrementUsage } from './service.js';
import { requireModuleSchema, checkLimitSchema, incrementUsageSchema } from './schemas.js';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';

const router = Router();

/** Tenant entitlement'lerini listele */
router.get(
  '/entitlements',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');

      const result = await getPool().query<{
        module_code: string;
        status: string;
        granted_at: Date;
        expires_at: Date | null;
      }>(
        `SELECT module_code, status, granted_at, expires_at
         FROM tenant_entitlements
         WHERE tenant_id = $1
         ORDER BY module_code`,
        [tenantId],
      );

      res.json({
        tenantId,
        entitlements: result.rows.map(
          (r: {
            module_code: string;
            status: string;
            granted_at: Date;
            expires_at: Date | null;
          }) => ({
            moduleCode: r.module_code,
            status: r.status,
            grantedAt: r.granted_at,
            expiresAt: r.expires_at,
          }),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Modül yetkisi doğrula - requireModule service fonksiyonunu kullanır */
router.post(
  '/entitlements/check-module',
  authenticate,
  validate(requireModuleSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { moduleCode } = req.body;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      }

      const result = await requireModule(tenantId, moduleCode);

      res.json({
        tenantId,
        moduleCode: result.moduleCode,
        entitled: result.entitled,
        status: result.status,
        grantedAt: result.grantedAt,
        expiresAt: result.expiresAt,
        reason: result.reason,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Limit kontrolü - checkLimit service fonksiyonunu kullanır */
router.post(
  '/entitlements/check-limit',
  authenticate,
  validate(checkLimitSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { limitKey } = req.body;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      }

      const result = await checkLimit(tenantId, limitKey);

      res.json({
        tenantId,
        limitKey: result.limitKey,
        allowed: result.allowed,
        current: result.current,
        limit: result.limit,
        remaining: result.remaining,
        resetAt: result.resetAt,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Kullanım sayacını artır - incrementUsage service fonksiyonunu kullanır */
router.post(
  '/entitlements/increment-usage',
  authenticate,
  validate(incrementUsageSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { limitKey, periodStart } = req.body;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      }

      await incrementUsage(tenantId, limitKey, periodStart);

      res.status(200).json({
        tenantId,
        limitKey,
        incremented: true,
        periodStart,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
