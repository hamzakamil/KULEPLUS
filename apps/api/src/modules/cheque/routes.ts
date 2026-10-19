import { Router, type Response, type NextFunction } from 'express';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '@kuleplus/shared';
import {
  createChequeSchema,
  updateChequeSchema,
  chequeListQuerySchema,
  endorseChequeSchema,
  collectChequeSchema,
  depositChequeSchema,
  pledgeChequeSchema,
  releaseChequeSchema,
  bounceChequeSchema,
  cancelChequeSchema,
  portfolioListQuerySchema,
  transactionListQuerySchema,
} from './schemas';
import type { ChequeListQuery, PortfolioListQuery, TransactionListQuery } from './schemas';
import { ChequeService } from './service';

const router = Router();

// Tüm çek/senet uçları: kimlik + tenant + entitlement.
// Modül kodu GOVERNANCE §2'ye göre 'cheque'dir (Faz 6).
router.use(authenticate, tenantContext, requireEntitlement('cheque'));

const service = new ChequeService();

// RBAC kapıları (SPEC §6.3): yaşam döngüsü aksiyonları ayrı izin ister.
const canCreate = requirePermission('cheque.cheque.create');
const canUpdate = requirePermission('cheque.cheque.update');
const canDelete = requirePermission('cheque.cheque.delete');
const canManage = requirePermission('cheque.cheque.manage');

// ============ Çek/Senet Kartları ============

router.get(
  '/',
  validate(chequeListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.listCheques(
        req.query as unknown as ChequeListQuery,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await service.getChequeById(req.params.id, (req as TenantRequest).tenantId);
    if (!result) throw new AppError('NOT_FOUND', 'Çek/senet bulunamadı');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/',
  canCreate,
  validate(createChequeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.createCheque(
        req.body,
        (req as TenantRequest).user!.sub,
        (req as TenantRequest).tenantId,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/:id',
  canUpdate,
  validate(updateChequeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.updateCheque(
        req.params.id,
        req.body,
        (req as TenantRequest).user!.sub,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/:id',
  canDelete,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.deleteCheque(req.params.id, (req as TenantRequest).tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ============ Yaşam Döngüsü Aksiyonları ============

router.post(
  '/:id/endorse',
  canManage,
  validate(endorseChequeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.endorseCheque(
        req.params.id,
        req.body,
        (req as TenantRequest).user!.sub,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/collect',
  canManage,
  validate(collectChequeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.collectCheque(
        req.params.id,
        req.body,
        (req as TenantRequest).user!.sub,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Tahsile ver / teminata ver / portföye geri al (Faz 7-4). */
router.post(
  '/:id/deposit',
  canManage,
  validate(depositChequeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.depositCheque(
        req.params.id,
        req.body,
        (req as TenantRequest).user!.sub,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/pledge',
  canManage,
  validate(pledgeChequeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.pledgeCheque(
        req.params.id,
        req.body,
        (req as TenantRequest).user!.sub,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/release',
  canManage,
  validate(releaseChequeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.releaseCheque(
        req.params.id,
        req.body,
        (req as TenantRequest).user!.sub,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/bounce',
  canManage,
  validate(bounceChequeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.bounceCheque(
        req.params.id,
        req.body,
        (req as TenantRequest).user!.sub,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/cancel',
  canManage,
  validate(cancelChequeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.cancelCheque(
        req.params.id,
        req.body,
        (req as TenantRequest).user!.sub,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ============ Durum Geçmişi ============

router.get(
  '/:id/transactions',
  validate(transactionListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.listTransactions(
        req.query as unknown as TransactionListQuery,
        req.params.id,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ============ Portföy ve Vade Takvimi ============

router.get(
  '/portfolio/summary',
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.portfolioSummary((_req as TenantRequest).tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/portfolio/list',
  validate(portfolioListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.listPortfolio(
        req.query as unknown as PortfolioListQuery,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/portfolio/due-calendar',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const days = Number(req.query.days ?? 30);
      const result = await service.dueCalendar(
        (req as TenantRequest).tenantId,
        Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : 30,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export { router as chequeRoutes };
