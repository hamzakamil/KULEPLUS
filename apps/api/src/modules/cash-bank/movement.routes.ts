import { Router, type Response, type NextFunction } from 'express';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { validate } from '../../middleware/validate.js';
import {
  depositSchema,
  withdrawalSchema,
  transferSchema,
  CashBankMovementListQuerySchema,
} from './movement.service';
import type { CashBankMovementListQuery } from './movement.service';
import {
  deposit,
  withdrawal,
  transfer,
  listCashBankMovements,
  getCashBankMovementById,
  cancelMovement,
} from './movement.service';

const router = Router();

// Tüm kasa/banka hareket uçları: kimlik + tenant + entitlement
router.use(authenticate, tenantContext, requireEntitlement('cashbank'));

// ============ Movements ============

router.get(
  '/',
  validate(CashBankMovementListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await listCashBankMovements(req.query as unknown as CashBankMovementListQuery);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await getCashBankMovementById(req.params.id);
    if (!result) throw new Error('Hareket bulunamadı');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/deposit',
  validate(depositSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await deposit(req.body, req.user!.sub);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/withdrawal',
  validate(withdrawalSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await withdrawal(req.body, req.user!.sub);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/transfer',
  validate(transferSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await transfer(req.body, req.user!.sub);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/:id/cancel',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await cancelMovement(req.params.id, req.user!.sub);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export { router as cashBankMovementRoutes };
