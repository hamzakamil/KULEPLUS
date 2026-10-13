import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '@kuleplus/shared';
import {
  createCashBankAccountSchema,
  updateCashBankAccountSchema,
  CashBankAccountListQuerySchema,
} from './cash-bank.service';
import type { CashBankAccountListQuery } from './cash-bank.service';
import {
  createCashBankAccount,
  getCashBankAccountById,
  listCashBankAccounts,
  updateCashBankAccount as updateCashBankAccountService,
  deleteCashBankAccount,
} from './cash-bank.service';

const router = Router();

// Tüm kasa/banka uçları: kimlik + tenant + entitlement
router.use(authenticate, tenantContext, requireEntitlement('cashbank'));

// ============ Cash/Bank Accounts ============

router.get(
  '/',
  validate(CashBankAccountListQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listCashBankAccounts(
        req.query as unknown as CashBankAccountListQuery,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getCashBankAccountById(req.params.id, (req as TenantRequest).tenantId);
    if (!result) throw new AppError('NOT_FOUND', 'Cash/Bank account not found');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/',
  validate(createCashBankAccountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createCashBankAccount(
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
  validate(updateCashBankAccountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await updateCashBankAccountService(
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

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deleteCashBankAccount(req.params.id, (req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export { router as cashBankRoutes };
