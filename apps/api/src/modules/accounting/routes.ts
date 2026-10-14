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
  ensureChartOfAccounts,
} from './service';

const router = Router();

// Tüm muhasebe uçları: kimlik + tenant + entitlement
router.use(authenticate, tenantContext, requireEntitlement('accounting'));

// ============ Raporlar (Faz 5) ============
// DİKKAT: sabit `/reports/*` rotaları, aşağıdaki parametrik `/:id`'den önce gelir.

/** Mizan (mizan-ı umumi) — hesap bazında borç/alacak/bakiye. */
router.get(
  '/reports/trial-balance',
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

/** Gelir tablosu. */
router.get(
  '/reports/income-statement',
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
  requirePermission('accounting.entry.create'),
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

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deleteAccount(req.params.id, (req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
// ============ Yevmiye Fişleri ============

router.get(
  '/entries',
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

router.get('/entries/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getEntryById(req.params.id, (req as TenantRequest).tenantId);
    if (!result) throw new AppError('NOT_FOUND', 'Yevmiye fişi bulunamadi');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/entries',
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
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
      const result = await reverseEntry(req.params.id, userId, (req as TenantRequest).tenantId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete('/entries/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deleteEntry(req.params.id, (req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
// ============ Yevmiye Satırları ============

router.get(
  '/entries/:entryId/lines',
  validate(journalEntryListQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listJournalLines(
        req.query as Record<string, unknown>,
        (req as TenantRequest).tenantId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get('/entries/:entryId/lines/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getLineById(req.params.id, (req as TenantRequest).tenantId);
    if (!result) throw new AppError('NOT_FOUND', 'Yevmiye satiri bulunamadi');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/entries/:entryId/lines',
  validate(journalLineInputSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createLine(
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
  '/entries/:entryId/lines/:id',
  validate(journalLineInputSchema),
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

router.delete('/entries/:entryId/lines/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deleteLine(req.params.id, (req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
// ============ Malî Dönemler ============

router.get(
  '/periods',
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

router.get('/periods/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getPeriodById(req.params.id, (req as TenantRequest).tenantId);
    if (!result) throw new AppError('NOT_FOUND', 'Mali donem bulunamadi');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/periods',
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

router.delete('/periods/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deletePeriod(req.params.id, (req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
// ============ Dönem Kilidi ============

router.get(
  '/period-locks',
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

router.get('/period-locks/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getLockById(req.params.id, (req as TenantRequest).tenantId);
    if (!result) throw new AppError('NOT_FOUND', 'Donem kilidi bulunamadi');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/period-locks',
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

router.delete('/period-locks/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deleteLock(req.params.id, (req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
// ============ Posting Kuralları ============

router.get(
  '/posting-rules',
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

router.get('/posting-rules/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getRuleById(req.params.id, (req as TenantRequest).tenantId);
    if (!result) throw new AppError('NOT_FOUND', 'Posting kurali bulunamadi');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/posting-rules',
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

router.delete('/posting-rules/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deleteRule(req.params.id, (req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
// ============ Hesap Eşleme ============

router.get(
  '/account-mappings',
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

router.get('/account-mappings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getMappingById(req.params.id, (req as TenantRequest).tenantId);
    if (!result) throw new AppError('NOT_FOUND', 'Hesap esleme bulunamadi');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/account-mappings',
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

router.delete('/account-mappings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deleteMapping(req.params.id, (req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============ Genel ============

router.get('/next-entry-no', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getNextEntryNo((req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// DİKKAT sıralama: parametrik hesap detayı (`/:id`) TÜM statik rotalardan SONRA
// tanımlanır. Aksi halde tek segmentli statik yollar (`/entries`, `/periods`,
// `/period-locks`, `/posting-rules`, `/account-mappings`, `/next-entry-no`)
// `/:id` ile eşleşip "invalid input syntax for type uuid" (500) üretir.
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getAccountById(req.params.id, (req as TenantRequest).tenantId);
    if (!result) throw new AppError('NOT_FOUND', 'Hesap bulunamadi');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export { router as accountingRoutes };
