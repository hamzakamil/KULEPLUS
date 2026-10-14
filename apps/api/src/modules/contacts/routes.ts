import { Router, type Request, type Response, type NextFunction } from 'express';
import { ContactService } from './service.js';
import { ContactImportService } from './import.service.js';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { AppError } from '@kuleplus/shared';
import { z } from 'zod';

const router = Router();
const service = new ContactService();
const importService = new ContactImportService();

/** Kritik: tüm cari uçları kimlik + tenant üyeliği + modül hakkı ister.
 * Sıra: authenticate → tenantContext → requireEntitlement (SPEC §5.1/§8.5). */
router.use(authenticate, tenantContext, requireEntitlement('contacts'));

/** İçe aktarma isteği (SPEC §23.1: dry-run → onay → commit) */
const importRequestSchema = z.object({
  csv: z.string().min(1, 'CSV içeriği gerekli').max(2_000_000, 'CSV boyutu 2 MB sınırını aşıyor'),
  mapping: z.record(z.string().nullable()).optional(),
  commit: z.boolean().default(false),
});

/** Cari dışa aktarma (CSV, UTF-8 BOM) — /:id'den ÖNCE tanımlanmalı */
router.get('/export', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const csv = await importService.exportCsv();
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cari-listesi-${today}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/** Cari içe aktarma (dry-run: rapor; commit: aktarım) — /:id'den ÖNCE */
router.post(
  '/import',
  requirePermission('contacts.contact.create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = importRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const messages = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new AppError('VALIDATION_ERROR', messages);
      }
      const { csv, mapping, commit } = parsed.data;
      if (commit) {
        const result = await importService.commit(csv, mapping);
        res.json(result);
      } else {
        const result = await importService.dryRun(csv, mapping);
        res.json(result);
      }
    } catch (error) {
      next(error);
    }
  },
);

/** Cari listesi özet sayaçları — /:id'den ÖNCE tanımlanmalı */
router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await service.getContactsStats());
  } catch (error) {
    next(error);
  }
});

/** Bakiye dahil cari listesi — /:id'den ÖNCE tanımlanmalı */
router.get('/with-balances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, sort, order, type, is_active, q, only_with_balance } = req.query as Record<
      string,
      string
    >;
    const result = await service.listContactsWithBalances({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sort,
      order: order as 'asc' | 'desc' | undefined,
      type,
      is_active: is_active !== undefined ? is_active === 'true' : undefined,
      q,
      onlyWithBalance: only_with_balance === 'true',
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Cari listele */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, sort, order, type, is_active, q } = req.query as Record<string, string>;
    const result = await service.listContacts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sort: sort as 'code' | 'name' | 'created_at' | 'updated_at' | 'type',
      order: order as 'asc' | 'desc',
      type: type as 'customer' | 'supplier' | undefined,
      is_active: is_active !== undefined ? is_active === 'true' : undefined,
      q: q,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Cari oluştur */
router.post(
  '/',
  requirePermission('contacts.contact.create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.createContact(req.body, (req as AuthenticatedRequest).user?.sub);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Cari ID'ye göre getir */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.getContact(req.params.id);
    if (!result) {
      throw new AppError('NOT_FOUND', 'Cari bulunamadı');
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Cari güncelle */
router.patch(
  '/:id',
  requirePermission('contacts.contact.update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.updateContact(
        req.params.id,
        req.body,
        (req as AuthenticatedRequest).user?.sub,
      );
      if (!result) {
        throw new AppError('NOT_FOUND', 'Cari bulunamadı');
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Cari güncelle (PUT alias for frontend) */
router.put(
  '/:id',
  requirePermission('contacts.contact.update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.updateContact(
        req.params.id,
        req.body,
        (req as AuthenticatedRequest).user?.sub,
      );
      if (!result) {
        throw new AppError('NOT_FOUND', 'Cari bulunamadı');
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Cari sil — yalnızca `contacts.contact.delete` izni veya owner (P0). */
router.delete(
  '/:id',
  requirePermission('contacts.contact.delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await service.deleteContact(
        req.params.id,
        (req as AuthenticatedRequest).user?.sub,
      );
      if (!deleted) {
        throw new AppError('NOT_FOUND', 'Cari bulunamadı');
      }
      res.json({ message: 'Cari başarıyla silindi' });
    } catch (error) {
      next(error);
    }
  },
);

/** Cari detay paketi — bakiye, risk, açık belgeler, yaşlandırma */
router.get('/:id/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await service.getContactSummary(req.params.id));
  } catch (error) {
    next(error);
  }
});

/** Cari ledger/ekstre */
router.get('/:id/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, type, date_from, date_to } = req.query as Record<string, string>;
    const result = await service.listContactLedger(req.params.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type: type as 'receivable' | 'payable' | undefined,
      dateFrom: date_from,
      dateTo: date_to,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Cari tipi güncelle (müşteri/satıcı) */
router.patch(
  '/:id/type',
  requirePermission('contacts.contact.update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.setContactType(
        req.params.id,
        req.body.type as 'customer' | 'supplier',
      );
      if (!result) {
        throw new AppError('NOT_FOUND', 'Cari bulunamadı');
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
