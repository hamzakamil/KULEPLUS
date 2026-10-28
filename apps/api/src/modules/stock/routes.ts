import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { StockService } from './service.js';
import { ProductImportService } from './import.service.js';
import { OpeningStockImportService } from './opening-stock.import.service.js';
import { authenticate } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { categoryBodySchema, createUnitSchema, mergeCategorySchema } from './schemas.js';
import { AppError } from '@kuleplus/shared';

const router = Router();
const service = new StockService();
const productImport = new ProductImportService();
const openingStockImport = new OpeningStockImportService();

// Kritik: tüm stok uçları kimlik + tenant üyeliği + modül hakkı ister.
// Sıra: authenticate → tenantContext → requireEntitlement (SPEC §5.1/§8.5).
router.use(authenticate, tenantContext, requireEntitlement('stock'));

// RBAC (SPEC §6.3): stok mutasyonları yalnızca ilgili izne sahip kullanıcılar.
// Okuma, kimliği doğrulanmış her tenant üyesine açıktır; owner middleware içinde otomatik geçer.
const canCreate = requirePermission('stock.product.create');
const canUpdate = requirePermission('stock.product.update');
const canDelete = requirePermission('stock.product.delete');

/** Ürün dışa aktarma (CSV, UTF-8 BOM) — `/:id`'den ÖNCE tanımlanmalı (SPEC §23.2) */
router.get('/export', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const csv = await service.exportCsv();
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="urun-listesi-${today}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/**
 * İçe aktarma uçları (SPEC §23.1: şablon → kolon eşleştirme → dry-run → onay).
 * Kritik: `/:id` rota kalıbını gölgelememek için tanımlar `/:id`'den ÖNCE olmalı.
 */
const importRequestSchema = z.object({
  csv: z.string().min(1, 'CSV içeriği gerekli').max(2_000_000, 'CSV boyutu 2 MB sınırını aşıyor'),
  mapping: z.record(z.string().nullable()).optional(),
  commit: z.boolean().default(false),
});

function parseImportRequest(req: Request): {
  csv: string;
  mapping?: Record<string, string | null>;
  commit: boolean;
} {
  const parsed = importRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError('VALIDATION_ERROR', messages);
  }
  // DİKKAT: doğrudan `parsed.data` döndürülmez. Zod `.default()` alanları
  // strictNullChecks kapalı derlemede (Vercel build) optional infer edilir ve
  // TS2322 üretir. Şema csv'yi zorunlu kılar, commit'e default(false) verir;
  // `??` yedekleri runtime'da ölü koddur, tip daraltmak içindir.
  return {
    csv: parsed.data.csv ?? '',
    mapping: parsed.data.mapping,
    commit: parsed.data.commit ?? false,
  };
}

/** UTF-8 BOM'lu CSV şablonu indir (Excel uyumu — SPEC §3) */
function sendCsv(res: Response, csv: string, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

/** Ürün içe aktarma şablonu */
router.get('/import/template', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendCsv(res, productImport.templateCsv(), 'urun-ice-aktarma-sablonu.csv');
  } catch (error) {
    next(error);
  }
});

/** Ürün içe aktarma (dry-run: rapor; commit: aktarım) */
router.post('/import', canCreate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv, mapping, commit } = parseImportRequest(req);
    const result = commit
      ? await productImport.commit(csv, mapping)
      : await productImport.dryRun(csv, mapping);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Açılış stoğu içe aktarma şablonu */
router.get(
  '/opening-stock/import/template',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      sendCsv(res, openingStockImport.templateCsv(), 'acilis-stogu-sablonu.csv');
    } catch (error) {
      next(error);
    }
  },
);

/** Açılış stoğu içe aktarma (dry-run: rapor; commit: stok hareketi) */
router.post(
  '/opening-stock/import',
  requirePermission('stock.movement.post'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { csv, mapping, commit } = parseImportRequest(req);
      const result = commit
        ? await openingStockImport.commit(csv, mapping)
        : await openingStockImport.dryRun(csv, mapping);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Stok bakiyesi listele */
router.get('/balances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.listBalances(req.query as Record<string, string>);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Stok hareketleri listele */
router.get('/movements/:product_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.listMovements(
      req.params.product_id,
      req.query as Record<string, string>,
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Stok girişi (stok artışı) */
router.post('/in', canCreate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.stockIn(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/** Stok çıkışı (stok azalımı) */
router.post('/out', canCreate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.stockOut(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/** Depoları listele */
router.get('/warehouses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.listWarehouses();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Ürünleri listele */
router.get('/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.listProducts(req.query as Record<string, string>);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Barkod ekle */
router.post('/barcodes', canCreate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.addBarcode(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/** Birim oluştur */
router.post(
  '/units',
  canCreate,
  validate(createUnitSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.createUnit(req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Birimleri listele */
router.get('/units', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.listUnits();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Ürün kategorileri. Kritik: `/:id` rota kalıbını gölgelememek için `/:id`'den ÖNCE.
 * Kategori yönetimi ürün kartını düzenlemekle aynı izne bağlıdır (create/update/delete).
 */
const categoryIdParams = z.object({ id: z.string().uuid() });

router.get('/categories', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await service.listCategories());
  } catch (error) {
    next(error);
  }
});

router.post(
  '/categories',
  canCreate,
  validate(categoryBodySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await service.createCategory(req.body));
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/categories/:id',
  canUpdate,
  validate(categoryIdParams, 'params'),
  validate(categoryBodySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service.renameCategory(req.params.id, req.body));
    } catch (error) {
      next(error);
    }
  },
);

/** Kategoriyi başka bir kategoriyle birleştir (ürünler hedefe taşınır, bu kategori silinir) */
router.post(
  '/categories/:id/merge',
  canUpdate,
  canDelete,
  validate(categoryIdParams, 'params'),
  validate(mergeCategorySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service.mergeCategories(req.params.id, req.body.target_id));
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/categories/:id',
  canDelete,
  validate(categoryIdParams, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await service.deleteCategory(req.params.id);
      res.json({ message: 'Kategori silindi' });
    } catch (error) {
      next(error);
    }
  },
);

/** Frontend uyumluluk: /stock endpointleri → ürün CRUD */
/** Ürünleri listele (alias for /products) */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.listProducts(req.query as Record<string, string>);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Ürün oluştur */
router.post('/', canCreate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.createProduct(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/** Ürün ID'ye göre getir */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.getProduct(req.params.id);
    if (!result) {
      throw new AppError('NOT_FOUND', 'Ürün bulunamadı');
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Ürün güncelle */
router.patch('/:id', canUpdate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.updateProduct(req.params.id, req.body);
    if (!result) {
      throw new AppError('NOT_FOUND', 'Ürün bulunamadı');
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Ürün sil */
router.delete('/:id', canDelete, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await service.deleteProduct(req.params.id);
    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Ürün bulunamadı');
    }
    res.json({ message: 'Ürün başarıyla silindi' });
  } catch (error) {
    next(error);
  }
});

export default router;
