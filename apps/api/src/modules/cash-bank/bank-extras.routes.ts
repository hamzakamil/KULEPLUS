import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { validate } from '../../middleware/validate.js';
import {
  createBankLoanSchema,
  updateBankLoanSchema,
  createCreditCardSchema,
  updateCreditCardSchema,
  createPosAccountSchema,
  updatePosAccountSchema,
  listBankLoans,
  createBankLoan,
  updateBankLoan,
  deleteBankLoan,
  listCreditCards,
  createCreditCard,
  updateCreditCard,
  deleteCreditCard,
  listPosAccounts,
  createPosAccount,
  updatePosAccount,
  deletePosAccount,
} from './bank-extras.service';

const router = Router();

// Banka alt modülleri: kimlik + tenant + cashbank hakkı (kasa/banka ile aynı kapı).
router.use(authenticate, tenantContext, requireEntitlement('cashbank'));

const tenantOf = (req: Request) => (req as TenantRequest).tenantId;

// ============ Banka Kredileri ============

router.get('/loans', async (req, res, next) => {
  try {
    res.json(await listBankLoans(tenantOf(req), req.query.bankAccountId as string | undefined));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/loans',
  validate(createBankLoanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { sub?: string } }).user?.sub as string;
      res.status(201).json(await createBankLoan(req.body, userId, tenantOf(req)));
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/loans/:id',
  validate(updateBankLoanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { sub?: string } }).user?.sub as string;
      const result = await updateBankLoan(req.params.id, req.body, userId, tenantOf(req));
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);

router.delete('/loans/:id', async (req, res, next) => {
  try {
    res.json(await deleteBankLoan(req.params.id, tenantOf(req)));
  } catch (e) {
    next(e);
  }
});

// ============ Kredi Kartları ============

router.get('/credit-cards', async (req, res, next) => {
  try {
    res.json(await listCreditCards(tenantOf(req), req.query.bankAccountId as string | undefined));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/credit-cards',
  validate(createCreditCardSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { sub?: string } }).user?.sub as string;
      res.status(201).json(await createCreditCard(req.body, userId, tenantOf(req)));
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/credit-cards/:id',
  validate(updateCreditCardSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { sub?: string } }).user?.sub as string;
      res.json(await updateCreditCard(req.params.id, req.body, userId, tenantOf(req)));
    } catch (e) {
      next(e);
    }
  },
);

router.delete('/credit-cards/:id', async (req, res, next) => {
  try {
    res.json(await deleteCreditCard(req.params.id, tenantOf(req)));
  } catch (e) {
    next(e);
  }
});

// ============ POS Hesapları ============

router.get('/pos', async (req, res, next) => {
  try {
    res.json(await listPosAccounts(tenantOf(req), req.query.bankAccountId as string | undefined));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/pos',
  validate(createPosAccountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { sub?: string } }).user?.sub as string;
      res.status(201).json(await createPosAccount(req.body, userId, tenantOf(req)));
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/pos/:id',
  validate(updatePosAccountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { sub?: string } }).user?.sub as string;
      res.json(await updatePosAccount(req.params.id, req.body, userId, tenantOf(req)));
    } catch (e) {
      next(e);
    }
  },
);

router.delete('/pos/:id', async (req, res, next) => {
  try {
    res.json(await deletePosAccount(req.params.id, tenantOf(req)));
  } catch (e) {
    next(e);
  }
});

export { router as bankExtrasRoutes };
