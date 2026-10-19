import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '@kuleplus/shared';
import {
  createAccountSchema,
  updateAccountSchema,
  accountListQuerySchema,
  createPeriodSchema,
  updatePeriodSchema,
  periodListQuerySchema,
  createPeriodLockSchema,
  updatePeriodLockSchema,
  periodLockListQuerySchema,
  createJournalEntrySchema,
  updateJournalEntrySchema,
  journalEntryListQuerySchema,
  createPostingRuleSchema,
  updatePostingRuleSchema,
  postingRuleListQuerySchema,
  createAccountMappingSchema,
  updateAccountMappingSchema,
  accountMappingListQuerySchema,
  journalLineInputSchema,
  updateJournalLineSchema,
  reverseEntrySchema,
  reportRangeQuerySchema,
  balanceSheetQuerySchema,
} from './schemas';
import {
  listAccountingAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  listJournalEntries,
  getEntryById,
  createEntry,
  updateEntry,
  deleteEntry,
  reverseEntry,
  postEntry,
  listJournalLines,
  getLineById,
  createLine,
  updateLine,
  deleteLine,
  listFiscalPeriods,
  getPeriodById,
  createPeriod,
  updatePeriod,
  deletePeriod,
  listPeriodLocks,
  getLockById,
  createLock,
  updateLock,
  deleteLock,
  listPostingRules,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  listAccountMappings,
  getMappingById,
  createMapping,
  updateMapping,
  deleteMapping,
  getNextEntryNo,
  trialBalance,
  balanceSheet,
  incomeStatement,
  withholdingReport,
  ensureChartOfAccounts,
} from './service';

const router = Router();

/**
 * Dönem durumunu (open/closed) değiştiren istek ayrıca `accounting.period.close` ister:
 * dönem tanımlayan (period.manage) biri dönemi kapatıp açamaz (görev ayrımı).
 */
const periodStatusGuard = (req: Request, res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object' && 'status' in req.body) {
    return requirePermission('accounting.period.close')(req, res, next);
  }
  next();
};

// Tüm muhasebe uçları: kimlik + tenant + entitlement
router.use(authenticate, tenantContext, requireEntitlement('accounting'));

// ============ Raporlar (Faz 5) ============
// DİKKAT: sabit `/reports/*` rotaları, aşağıdaki parametrik `/:id`'den önce gelir.

/** Mizan (mizan-ı umumi) — hesap bazında borç/alacak/bakiye. */
router.get(
  '/reports/trial-balance',
  requirePermission('accounting.report.read'),
  validate(reportRangeQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await trialBalance(
        req.query as { from?: string; to?: string },
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Bilanço (dönem sonu itibarıyla). */
router.get(
  '/reports/balance-sheet',
  requirePermission('accounting.report.read'),
  validate(balanceSheetQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await balanceSheet(
        req.query as { as_of?: string },
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** KDV tevkifatı hazırlık raporu — KDV-2 (alış) ve KDV-1 kısmi tevkifat (satış). */
router.get(
  '/reports/withholding',
  requirePermission('accounting.report.read'),
  validate(reportRangeQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await withholdingReport(
        req.query as { from?: string; to?: string },
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Gelir tablosu. */
router.get(
  '/reports/income-statement',
  requirePermission('accounting.report.read'),
  validate(reportRangeQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await incomeStatement(
        req.query as { from?: string; to?: string },
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ============ Hesap Planı ============

/** TDHP hesap planını kur (idempotent; zaten doluysa 0 döner). */
router.post(
  '/bootstrap',
  requirePermission('accounting.account.manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const inserted = await ensureChartOfAccounts((req as TenantRequest).tenantId);
      res.json({ inserted });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/',
  requirePermission('accounting.account.read'),
  validate(accountListQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listAccountingAccounts(
        req.query as Record<string, unknown>,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/',
  requirePermission('accounting.account.manage'),
  validate(createAccountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createAccount(
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
  requirePermission('accounting.account.manage'),
  validate(updateAccountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await updateAccount(
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
  requirePermission('accounting.account.manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteAccount(req.params.id, (req as TenantRequest).tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
// ============ Yevmiye Fişleri ============

router.get(
  '/entries',
  requirePermission('accounting.entry.read'),
  validate(journalEntryListQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listJournalEntries(
        req.query as Record<string, unknown>,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/entries/:id',
  requirePermission('accounting.entry.read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getEntryById(req.params.id, (req as TenantRequest).tenantId);
      if (!result) throw new AppError('NOT_FOUND', 'Yevmiye fişi bulunamadi');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/entries',
  requirePermission('accounting.entry.create'),
  validate(createJournalEntrySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createEntry(
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
  '/entries/:id',
  requirePermission('accounting.entry.update'),
  validate(updateJournalEntrySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await updateEntry(
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

/** Onaylı fişi ters kayıtla düzelt (SPEC §15). */
router.post(
  '/entries/:id/reverse',
  requirePermission('accounting.entry.approve'),
  validate(reverseEntrySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
      const result = await reverseEntry(
        req.params.id,
        userId,
        (req as TenantRequest).tenantId,
        (req.body as { entry_date?: string } | undefined)?.entry_date,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Taslak fişi onayla (gap-free numara + denge + dönem kontrolü). */
router.post(
  '/entries/:id/post',
  requirePermission('accounting.entry.approve'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
      const result = await postEntry(req.params.id, userId, (req as TenantRequest).tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/entries/:id',
  requirePermission('accounting.entry.delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteEntry(req.params.id, (req as TenantRequest).tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
// ============ Yevmiye Satırları ============

router.get(
  '/entries/:entryId/lines',
  requirePermission('accounting.entry.read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Yol parametresi zorunlu filtre: başka fişin satırları dönmez.
      const result = await listJournalLines(
        { ...(req.query as Record<string, unknown>), entry_id: req.params.entryId },
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/entries/:entryId/lines/:id',
  requirePermission('accounting.entry.read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getLineById(req.params.id, (req as TenantRequest).tenantId);
      if (!result) throw new AppError('NOT_FOUND', 'Yevmiye satiri bulunamadi');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/entries/:entryId/lines',
  requirePermission('accounting.entry.update'),
  validate(journalLineInputSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createLine(
        { ...req.body, entry_id: req.params.entryId },
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
  '/entries/:entryId/lines/:id',
  requirePermission('accounting.entry.update'),
  validate(updateJournalLineSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await updateLine(
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
  '/entries/:entryId/lines/:id',
  requirePermission('accounting.entry.update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteLine(req.params.id, (req as TenantRequest).tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
// ============ Malî Dönemler ============

router.get(
  '/periods',
  requirePermission('accounting.period.read'),
  validate(periodListQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listFiscalPeriods(
        req.query as Record<string, unknown>,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/periods/:id',
  requirePermission('accounting.period.read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getPeriodById(req.params.id, (req as TenantRequest).tenantId);
      if (!result) throw new AppError('NOT_FOUND', 'Mali donem bulunamadi');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/periods',
  requirePermission('accounting.period.manage'),
  periodStatusGuard,
  validate(createPeriodSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createPeriod(
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
  '/periods/:id',
  requirePermission('accounting.period.manage'),
  periodStatusGuard,
  validate(updatePeriodSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await updatePeriod(
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
  '/periods/:id',
  requirePermission('accounting.period.manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deletePeriod(
        req.params.id,
        (req as TenantRequest).tenantId,
        (req as TenantRequest).user?.sub,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
// ============ Dönem Kilidi ============

router.get(
  '/period-locks',
  requirePermission('accounting.period.read'),
  validate(periodLockListQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listPeriodLocks(
        req.query as Record<string, unknown>,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/period-locks/:id',
  requirePermission('accounting.period.read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getLockById(req.params.id, (req as TenantRequest).tenantId);
      if (!result) throw new AppError('NOT_FOUND', 'Donem kilidi bulunamadi');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/period-locks',
  requirePermission('accounting.period.close'),
  validate(createPeriodLockSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createLock(
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
  '/period-locks/:id',
  requirePermission('accounting.period.close'),
  validate(updatePeriodLockSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await updateLock(
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
  '/period-locks/:id',
  requirePermission('accounting.period.close'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteLock(
        req.params.id,
        (req as TenantRequest).tenantId,
        (req as TenantRequest).user?.sub,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
// ============ Posting Kuralları ============

router.get(
  '/posting-rules',
  requirePermission('accounting.mapping.read'),
  validate(postingRuleListQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listPostingRules(
        req.query as Record<string, unknown>,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/posting-rules/:id',
  requirePermission('accounting.mapping.read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getRuleById(req.params.id, (req as TenantRequest).tenantId);
      if (!result) throw new AppError('NOT_FOUND', 'Posting kurali bulunamadi');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/posting-rules',
  requirePermission('accounting.mapping.manage'),
  validate(createPostingRuleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createRule(
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
  '/posting-rules/:id',
  requirePermission('accounting.mapping.manage'),
  validate(updatePostingRuleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await updateRule(
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
  '/posting-rules/:id',
  requirePermission('accounting.mapping.manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteRule(req.params.id, (req as TenantRequest).tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
// ============ Hesap Eşleme ============

router.get(
  '/account-mappings',
  requirePermission('accounting.mapping.read'),
  validate(accountMappingListQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listAccountMappings(
        req.query as Record<string, unknown>,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/account-mappings/:id',
  requirePermission('accounting.mapping.read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getMappingById(req.params.id, (req as TenantRequest).tenantId);
      if (!result) throw new AppError('NOT_FOUND', 'Hesap esleme bulunamadi');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/account-mappings',
  requirePermission('accounting.mapping.manage'),
  validate(createAccountMappingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createMapping(
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
  '/account-mappings/:id',
  requirePermission('accounting.mapping.manage'),
  validate(updateAccountMappingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await updateMapping(
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
  '/account-mappings/:id',
  requirePermission('accounting.mapping.manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteMapping(req.params.id, (req as TenantRequest).tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ============ Genel ============

router.get(
  '/next-entry-no',
  requirePermission('accounting.entry.read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getNextEntryNo((req as TenantRequest).tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// DİKKAT sıralama: parametrik hesap detayı (`/:id`) TÜM statik rotalardan SONRA
// tanımlanır. Aksi halde tek segmentli statik yollar (`/entries`, `/periods`,
// `/period-locks`, `/posting-rules`, `/account-mappings`, `/next-entry-no`)
// `/:id` ile eşleşip "invalid input syntax for type uuid" (500) üretir.
router.get(
  '/:id',
  requirePermission('accounting.account.read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getAccountById(req.params.id, (req as TenantRequest).tenantId);
      if (!result) throw new AppError('NOT_FOUND', 'Hesap bulunamadi');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export { router as accountingRoutes };
