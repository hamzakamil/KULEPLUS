import { Router, type NextFunction, type Request, type Response } from 'express';
import { AppError } from '@kuleplus/shared';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { accountingService } from '../accounting/service';
import {
  downloadZip,
  generate,
  listYear,
  precheck,
  profileStatus,
  removeMonth,
  setDelivered,
} from './service';

/**
 * e-Defter (entegratör üzerinden): ön kontrol, üretim, indirme. Muhasebe modül hakkı gerekir.
 * Okuma: accounting.report.read · üretim/silme/gönderim işareti: accounting.period.close.
 */
const router = Router();
router.use(authenticate, tenantContext, requireEntitlement('accounting'));

const period = (req: Request) => {
  const p = String(req.params.period ?? '');
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(p))
    throw new AppError('VALIDATION_ERROR', 'Dönem YYYYAA olmalı');
  return p;
};
const userOf = (req: AuthenticatedRequest) => {
  const id = req.user?.sub;
  if (!id) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
  return id;
};
const tenant = (req: Request) => (req as TenantRequest).tenantId;

router.get(
  '/profile',
  requirePermission('accounting.report.read'),
  async (req, res, next: NextFunction) => {
    try {
      res.json(await profileStatus(tenant(req)));
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/',
  requirePermission('accounting.report.read'),
  async (req, res, next: NextFunction) => {
    try {
      const year = Number(req.query.year ?? new Date().getFullYear());
      if (!Number.isInteger(year)) throw new AppError('VALIDATION_ERROR', 'year gerekli');
      res.json({ year, parts: await listYear(year, tenant(req)) });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:period/precheck',
  requirePermission('accounting.report.read'),
  async (req, res, next: NextFunction) => {
    try {
      res.json(await precheck(period(req), tenant(req)));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:period/generate',
  requirePermission('accounting.period.close'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await generate(period(req), userOf(req), tenant(req)));
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:period/download',
  requirePermission('accounting.report.read'),
  async (req, res, next: NextFunction) => {
    try {
      const { fileName, body } = await downloadZip(period(req), tenant(req));
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(body);
    } catch (e) {
      next(e);
    }
  },
);

/** Ayı kilitler (kilit tarihi = sonraki ayın ilk günü): madde numaraları donar, sonra defter üretilir. */
router.post(
  '/:period/lock',
  requirePermission('accounting.period.close'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const p = period(req);
      const y = Number(p.slice(0, 4));
      const m = Number(p.slice(4));
      const next1 = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      res.json(
        await accountingService.advanceLock(next1, userOf(req), `e-Defter ${p}`, tenant(req)),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:period/delivered',
  requirePermission('accounting.period.close'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const delivered = (req.body as { delivered?: unknown } | undefined)?.delivered !== false;
      res.json(await setDelivered(period(req), delivered, userOf(req), tenant(req)));
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:period',
  requirePermission('accounting.period.close'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await removeMonth(period(req), userOf(req), tenant(req)));
    } catch (e) {
      next(e);
    }
  },
);

export { router as edefterRoutes };
