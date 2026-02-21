import { Router } from 'express';
import { AccountController } from '../controllers/AccountController';

const router = Router();

/**
 * @swagger
 * /api/accounts:
 *   get:
 *     summary: Tüm hesapları listele
 *     tags: [Hesaplar]
 *     parameters:
 *       - in: query
 *         name: sinif
 *         schema: { type: integer, minimum: 1, maximum: 9 }
 *       - in: query
 *         name: aktif
 *         schema: { type: boolean }
 *       - in: query
 *         name: dovizKodu
 *         schema: { type: string }
 */
router.get('/', AccountController.getAll);

/**
 * @swagger
 * /api/accounts/tree:
 *   get:
 *     summary: Hesap ağacını getir (hiyerarşik)
 *     tags: [Hesaplar]
 */
router.get('/tree', AccountController.getTree);

/**
 * @swagger
 * /api/accounts/search:
 *   get:
 *     summary: Hesap arama
 *     tags: [Hesaplar]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 */
router.get('/search', AccountController.search);

/**
 * @swagger
 * /api/accounts/{kod}:
 *   get:
 *     summary: Hesap koduna göre getir
 *     tags: [Hesaplar]
 *     parameters:
 *       - in: path
 *         name: kod
 *         required: true
 *         schema: { type: string }
 */
router.get('/:kod', AccountController.getByKod);

/**
 * @swagger
 * /api/accounts:
 *   post:
 *     summary: Yeni hesap oluştur
 *     tags: [Hesaplar]
 */
router.post('/', AccountController.create);

/**
 * @swagger
 * /api/accounts/{kod}:
 *   put:
 *     summary: Hesap güncelle
 *     tags: [Hesaplar]
 */
router.put('/:kod', AccountController.update);

/**
 * @swagger
 * /api/accounts/{kod}:
 *   delete:
 *     summary: Hesap sil (pasifleştir)
 *     tags: [Hesaplar]
 */
router.delete('/:kod', AccountController.delete);

export default router;
