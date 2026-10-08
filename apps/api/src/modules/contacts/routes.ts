import { Router, type Request, type Response, type NextFunction } from 'express';
import { ContactService } from './service.js';
import { AppError } from '@kuleplus/shared';

const router = Router();
const service = new ContactService();

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
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.createContact(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

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
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.updateContact(req.params.id, req.body);
    if (!result) {
      throw new AppError('NOT_FOUND', 'Cari bulunamadı');
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Cari sil */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await service.deleteContact(req.params.id);
    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Cari bulunamadı');
    }
    res.json({ message: 'Cari başarıyla silindi' });
  } catch (error) {
    next(error);
  }
});

/** Cari ledger/ekstre */
router.get('/:id/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, type } = req.query as Record<string, string>;
    const result = await service.listContactLedger(req.params.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type: type as 'receivable' | 'payable',
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Cari tipi güncelle (müşteri/satıcı) */
router.patch('/:id/type', async (req: Request, res: Response, next: NextFunction) => {
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
});

export default router;
