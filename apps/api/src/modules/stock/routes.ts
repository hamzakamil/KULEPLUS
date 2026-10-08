import { Router, type Request, type Response, type NextFunction } from 'express';
import { StockService } from './service.js';

const router = Router();
const service = new StockService();

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
router.post('/in', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.stockIn(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/** Stok çıkışı (stok azalımı) */
router.post('/out', async (req: Request, res: Response, next: NextFunction) => {
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
router.post('/barcodes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.addBarcode(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/** Birim oluştur */
router.post('/units', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.createUnit(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/** Birimleri listele */
router.get('/units', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.listUnits();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
