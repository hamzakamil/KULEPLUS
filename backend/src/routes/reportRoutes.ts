import { Router } from 'express';
import { ReportController } from '../controllers/ReportController';

const router = Router();

/**
 * @swagger
 * /api/reports/balance/{hesapKodu}:
 *   get:
 *     summary: Hesap bakiyesini getir
 *     tags: [Raporlar]
 */
router.get('/balance/:hesapKodu', ReportController.getHesapBakiye);

/**
 * @swagger
 * /api/reports/trial-balance:
 *   get:
 *     summary: Mizan raporu
 *     tags: [Raporlar]
 *     parameters:
 *       - in: query
 *         name: tarihBaslangic
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: tarihBitis
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: sinif
 *         schema: { type: integer }
 */
router.get('/trial-balance', ReportController.getMizan);

/**
 * @swagger
 * /api/reports/balance-sheet:
 *   get:
 *     summary: Bilanço raporu
 *     tags: [Raporlar]
 */
router.get('/balance-sheet', ReportController.getBilanco);

/**
 * @swagger
 * /api/reports/income-statement:
 *   get:
 *     summary: Gelir tablosu
 *     tags: [Raporlar]
 */
router.get('/income-statement', ReportController.getGelirTablosu);

/**
 * @swagger
 * /api/reports/account-statement/{hesapKodu}:
 *   get:
 *     summary: Hesap ekstresi
 *     tags: [Raporlar]
 */
router.get('/account-statement/:hesapKodu', ReportController.getHesapEkstresi);

export default router;
