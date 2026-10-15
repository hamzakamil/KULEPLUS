import { Router, type Response, type NextFunction } from 'express';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { validate } from '../../middleware/validate.js';
import { generateReportSchema, reportRangeSchema } from './report.service';
import { generateReport, listReports, getReportById, reportService } from './report.service';

const router = Router();

// Tüm rapor uçları: kimlik + tenant + entitlement
router.use(authenticate, tenantContext, requireEntitlement('reports_plus'));

/** Tarih aralığı doğrulaması — canlı rapor uçlarının ortak kapısı. */
function parseRange(req: AuthenticatedRequest): Record<string, string | undefined> | null {
  const parsed = reportRangeSchema.safeParse(req.query);
  return parsed.success ? (req.query as Record<string, string | undefined>) : null;
}

/** Canlı rapor ucu sarmalayıcısı — doğrulama ve hata yönlendirmesini tek yerde yapar. */
function live(
  handler: (query: Record<string, string | undefined>) => Promise<unknown>,
): (req: AuthenticatedRequest, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const query = parseRange(req);
    if (!query) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Geçersiz tarih aralığı (YYYY-AA-GG).' },
      });
      return;
    }
    handler(query)
      .then((data) => res.json(data))
      .catch(next);
  };
}

// ============ Canlı Raporlar (istek anında hesaplanır) ============

/** Tüm modüllerin özeti — rapor ekranının ana kartları. */
router.get(
  '/overview',
  live((q) => reportService.overview(q)),
);

/** Modül bazında son değişiklik zamanları — istemci otomatik yenileme için. */
router.get('/freshness', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reportService.moduleFreshness());
  } catch (error) {
    next(error);
  }
});

router.get(
  '/sales',
  live((q) => reportService.salesReport(q)),
);
router.get(
  '/purchases',
  live((q) => reportService.purchaseReport(q)),
);
router.get(
  '/expenses',
  live((q) => reportService.expenseReport(q)),
);
router.get('/stock', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reportService.stockReport());
  } catch (error) {
    next(error);
  }
});
router.get(
  '/cash-bank',
  live((q) => reportService.cashBankReport(q)),
);
router.get(
  '/profit-loss',
  live((q) => reportService.profitLoss(q)),
);
router.get(
  '/tax-summary',
  live((q) => reportService.taxSummary(q)),
);
router.get(
  '/aged-receivable',
  live((q) => reportService.agedReport({ ...q, type: 'receivable' })),
);
router.get(
  '/aged-payable',
  live((q) => reportService.agedReport({ ...q, type: 'payable' })),
);

// Faz 6.4 — KDV hazırlık raporu (hesaplanan/indirilecek/devreden, tevkifat)
router.get(
  '/vat',
  live((q) => reportService.vatReport(q)),
);

// Faz 6.4 — belge/defter mutabakatı
router.get(
  '/ledger-reconciliation',
  live((q) => reportService.ledgerReconciliation(q)),
);

// Faz 6.5 — Ba-Bs raporu (eşik parametrik, varsayılan 5000)
router.get(
  '/babs',
  live((q) => reportService.babsReport({ ...q, threshold: Number(q.threshold) || 5000 })),
);

// Faz 6.5 — cari mutabakat mektubu verisi
// Not: `live()` sarmalayıcısı yalnızca query taşır; contactId route param'ından
// gelir, burada query'ye enjekte edilir.
router.get(
  '/contacts/:contactId/reconciliation',
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const query = parseRange(req);
    if (!query) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Geçersiz tarih aralığı (YYYY-AA-GG).' },
      });
      return;
    }
    reportService
      .contactReconciliationLetter({ ...query, contactId: req.params.contactId })
      .then((data) => res.json(data))
      .catch(next);
  },
);

// Faz 6.10 — vade bazlı nakit akış tahmini (haftalık kovalar)
router.get(
  '/cash-flow-forecast',
  live((q) => reportService.cashFlowForecast({ ...q, buckets: Number(q.buckets) || 8 })),
);

// ============ Arşiv (report_generations) ============

router.get('/', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await listReports());
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await getReportById(req.params.id);
    if (!result) throw new Error('Rapor bulunamadı');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/generate',
  validate(generateReportSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await generateReport(req.body, req.user!.sub);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

export { router as reportRoutes };
