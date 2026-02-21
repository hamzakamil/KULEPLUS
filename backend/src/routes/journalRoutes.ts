import { Router } from 'express';
import { JournalController } from '../controllers/JournalController';

const router = Router();

/**
 * @swagger
 * /api/journal-entries:
 *   get:
 *     summary: Tüm yevmiye fişlerini listele
 *     tags: [Yevmiye Fişleri]
 *     parameters:
 *       - in: query
 *         name: tarihBaslangic
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: tarihBitis
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: fisTipi
 *         schema: { type: string, enum: [mahsup, tahsil, tediye, acilis, kapanis, diger] }
 *       - in: query
 *         name: durum
 *         schema: { type: string, enum: [taslak, onaylandi, iptal] }
 *       - in: query
 *         name: hesapKodu
 *         schema: { type: string }
 *       - in: query
 *         name: kaynakEntegrasyon
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 */
router.get('/', JournalController.getAll);

/**
 * @swagger
 * /api/journal-entries/{fisNo}:
 *   get:
 *     summary: Fiş numarasına göre getir
 *     tags: [Yevmiye Fişleri]
 */
router.get('/:fisNo', JournalController.getByFisNo);

/**
 * @swagger
 * /api/journal-entries:
 *   post:
 *     summary: Yeni yevmiye fişi oluştur
 *     tags: [Yevmiye Fişleri]
 */
router.post('/', JournalController.create);

/**
 * @swagger
 * /api/journal-entries/{fisNo}/approve:
 *   patch:
 *     summary: Fişi onayla
 *     tags: [Yevmiye Fişleri]
 */
router.patch('/:fisNo/approve', JournalController.approve);

/**
 * @swagger
 * /api/journal-entries/{fisNo}/cancel:
 *   patch:
 *     summary: Fişi iptal et
 *     tags: [Yevmiye Fişleri]
 */
router.patch('/:fisNo/cancel', JournalController.cancel);

/**
 * @swagger
 * /api/journal-entries/account/{hesapKodu}/movements:
 *   get:
 *     summary: Hesabın hareketlerini getir
 *     tags: [Yevmiye Fişleri]
 */
router.get('/account/:hesapKodu/movements', JournalController.getHesapHareketleri);

export default router;
