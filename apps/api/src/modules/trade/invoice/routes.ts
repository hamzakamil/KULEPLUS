import { Router, type Request, type Response, type NextFunction } from 'express';
import { InvoiceService } from './service.js';
import { authenticate, type AuthenticatedRequest } from '../../../middleware/auth.js';
import { tenantContext } from '../../../middleware/tenant.js';
import { requireEntitlement } from '../../../middleware/require-entitlement.js';
import { requirePermission } from '../../../middleware/require-permission.js';
import { idempotency } from '../../../middleware/idempotency.js';
import { validate } from '../../../middleware/validate.js';
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  replaceInvoiceLinesSchema,
  paymentSchema,
  listInvoicesQuerySchema,
  withholdingTypeSchema,
  updateWithholdingTypeSchema,
} from './schemas.js';
import { AppError } from '@kuleplus/shared';
import type { ListInvoicesQuery } from './schemas.js';

const router = Router();
const service = new InvoiceService();

// Tüm fatura uçları: kimlik + tenant + entitlement.
// Modül kodu GOVERNANCE §2'ye göre 'trade'tir (fatura trade.invoice.* altındadır, ADR-0007).
// NOT: 'invoices' diye bir modül kodu YOKTUR → kapı her zaman 403 verirdi.
router.use(authenticate, tenantContext, requireEntitlement('trade'));

/** Fatura listele */
router.get(
  '/',
  validate(listInvoicesQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.listInvoices(req.query as unknown as ListInvoicesQuery);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** KDV oranları */
router.get('/tax-rates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.getTaxRates();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Tevkifat türleri (Faz 7-3). `?active_on=YYYY-MM-DD` → o tarihte geçerli aktif türler. */
router.get('/withholding-types', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const activeOn = typeof req.query.active_on === 'string' ? req.query.active_on : undefined;
    res.json(await service.listWithholdingTypes(activeOn));
  } catch (error) {
    next(error);
  }
});

router.post(
  '/withholding-types',
  requirePermission('core.settings.update'),
  validate(withholdingTypeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await service.createWithholdingType(req.body));
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/withholding-types/:id',
  requirePermission('core.settings.update'),
  validate(updateWithholdingTypeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service.updateWithholdingType(req.params.id, req.body));
    } catch (error) {
      next(error);
    }
  },
);

/** Fatura sıraları */
router.get('/sequences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.getInvoiceSequences();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Fatura oluştur */
router.post(
  '/',
  validate(createInvoiceSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.createInvoice(req.body, req.user?.sub);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Fatura getir (detay + satırlar + ödemeler) */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.getInvoice(req.params.id);
    if (!result) {
      throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Fatura güncelle */
router.patch(
  '/:id',
  validate(updateInvoiceSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.updateInvoice(req.params.id, req.body, req.user?.sub);
      if (!result) {
        throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Fatura satırlarını tamamen değiştir */
router.put(
  '/:id/lines',
  validate(replaceInvoiceLinesSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await service.replaceLines(req.params.id, req.body, req.user?.sub);
      if (!result) {
        throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Fatura sil */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const deleted = await service.deleteInvoice(req.params.id, req.user?.sub);
    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
    }
    res.json({ message: 'Fatura başarıyla silindi' });
  } catch (error) {
    next(error);
  }
});

/** Fatura ödeme ekle */
router.post(
  '/:id/payments',
  idempotency(),
  validate(paymentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
      const result = await service.addPayment(req.params.id, req.body, userId);
      if (!result) {
        throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
      }
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Faturayı kesinleştir + otomatik yevmiye fişi üret (Faz 3/5, SPEC §12.2/§15).
 * `trade.invoice.approve` izni gerekir; idempotenttir.
 */
router.post(
  '/:id/post',
  requirePermission('trade.invoice.approve'),
  idempotency(),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new AppError('UNAUTHENTICATED', 'Kimlik doğrulama gerekli');
      const result = await service.postInvoice(req.params.id, userId);
      res.status(result.alreadyPosted ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
