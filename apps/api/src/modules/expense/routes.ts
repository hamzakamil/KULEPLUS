import { Router, type Response, type NextFunction } from 'express';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import {
  createExpenseCategorySchema,
  updateExpenseCategorySchema,
  createExpenseSchema,
  updateExpenseSchema,
  expenseListQuerySchema,
} from './expense.service';
import type { ExpenseListQuery } from './expense.service';
import {
  createExpenseCategory,
  getExpenseCategoryById,
  listExpenseCategories,
  createExpense,
  getExpenseById,
  updateExpense,
  deleteExpense,
  listExpenses,
  updateExpenseCategory,
  deleteExpenseCategory,
  createExpensePayment,
} from './expense.service';

const router = Router();

// Tüm gider uçları: kimlik + tenant + entitlement.
// Modül kodu GOVERNANCE §2'ye göre 'trade'tir (gider trade.expense.* altındadır, ADR-0008).
// NOT: 'expense' diye bir modül kodu YOKTUR → kapı her zaman 403 verirdi.
router.use(authenticate, tenantContext, requireEntitlement('trade'));

// RBAC kapıları (SPEC §6.3): gider kategorisi/gider oluşturma-güncelleme-silme
// yalnızca `trade.expense.*` iznine sahip kullanıcılar. Okuma tamamı auth'ludur.
const canExpenseCreate = requirePermission('trade.expense.create');
const canExpenseUpdate = requirePermission('trade.expense.update');
const canExpenseDelete = requirePermission('trade.expense.delete');

// ============ Expense Categories ============

router.get(
  '/categories',
  validate(expenseListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await listExpenseCategories(req.query as unknown as ExpenseListQuery);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/categories/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await getExpenseCategoryById(req.params.id);
      if (!result) throw new Error('Gider kategorisi bulunamadı');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/categories',
  canExpenseCreate,
  validate(createExpenseCategorySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await createExpenseCategory(req.body, req.user!.sub);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/categories/:id',
  canExpenseUpdate,
  validate(updateExpenseCategorySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updateExpenseCategory(req.params.id, req.body, req.user!.sub);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/categories/:id',
  canExpenseDelete,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await deleteExpenseCategory(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ============ Expenses ============

router.get(
  '/',
  validate(expenseListQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await listExpenses(req.query as unknown as ExpenseListQuery);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await getExpenseById(req.params.id);
    if (!result) throw new Error('Gider bulunamadı');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/',
  canExpenseCreate,
  validate(createExpenseSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await createExpense(req.body, req.user!.sub);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/:id',
  canExpenseUpdate,
  validate(updateExpenseSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await updateExpense(req.params.id, req.body, req.user!.sub);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete('/:id', canExpenseDelete, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await deleteExpense(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============ Expense Payments ============

router.post(
  '/:id/payments',
  canExpenseUpdate,
  validate(createExpenseSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // This is a simplified payment creation - in full implementation would need expenseId
      // For now, we'll just validate and return
      const result = await createExpensePayment(req.params.id, req.body, req.user!.sub);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

export { router as expenseRoutes };
