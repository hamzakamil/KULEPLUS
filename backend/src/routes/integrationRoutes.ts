import { Router } from 'express';
import { IntegrationController } from '../controllers/IntegrationController';

const router = Router();

/**
 * @swagger
 * /api/integrations/supported:
 *   get:
 *     summary: Desteklenen fatura programlarını listele
 *     tags: [Entegrasyonlar]
 */
router.get('/supported', IntegrationController.getSupportedIntegrations);

/**
 * @swagger
 * /api/integrations:
 *   get:
 *     summary: Konfigüre edilmiş entegrasyonları listele
 *     tags: [Entegrasyonlar]
 */
router.get('/', IntegrationController.getConfiguredIntegrations);

/**
 * @swagger
 * /api/integrations/{programAdi}/config:
 *   put:
 *     summary: Entegrasyon konfigürasyonu oluştur/güncelle
 *     tags: [Entegrasyonlar]
 */
router.put('/:programAdi/config', IntegrationController.upsertConfig);

/**
 * @swagger
 * /api/integrations/{programAdi}/test:
 *   post:
 *     summary: Bağlantı testi
 *     tags: [Entegrasyonlar]
 */
router.post('/:programAdi/test', IntegrationController.testConnection);

/**
 * @swagger
 * /api/integrations/{programAdi}/sync:
 *   post:
 *     summary: Senkronizasyon başlat
 *     tags: [Entegrasyonlar]
 */
router.post('/:programAdi/sync', IntegrationController.senkronize);

/**
 * @swagger
 * /api/integrations/sync-all:
 *   post:
 *     summary: Tüm aktif entegrasyonları senkronize et
 *     tags: [Entegrasyonlar]
 */
router.post('/sync-all', IntegrationController.senkronizeTumu);

/**
 * @swagger
 * /api/integrations/{programAdi}/account-mapping:
 *   put:
 *     summary: Hesap eşleştirmelerini güncelle
 *     tags: [Entegrasyonlar]
 */
router.put(
  '/:programAdi/account-mapping',
  IntegrationController.updateHesapEslestirmeleri
);

export default router;
