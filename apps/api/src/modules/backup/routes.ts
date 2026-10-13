import { Router, type NextFunction, type Request, type Response } from 'express';
import { createReadStream } from 'node:fs';
import type { Logger } from 'pino';
import { AppError } from '@kuleplus/shared';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { requirePlatformUser } from '../../middleware/platform.js';
import { validate } from '../../middleware/validate.js';
import { getBackupService } from './service.js';
import { backupParamsSchema, updateBackupSettingsSchema } from './schemas.js';

const router = Router();

// DİKKAT sıralama: `/status` ve `/settings` gibi sabit rotalar, parametrik
// rotalardan (`/:id`, `/:id/download`) ÖNCE tanımlanmalıdır.
//
// Güvenlik (P0): Yedek dosyası TÜM DATABASE'in RLS'siz dump'ıdır (DATABASE_MIGRATOR_URL
// ile üretilir) ve `backup_jobs` tenant bağımsızdır (SPEC §7.0 istisna tabloları).
// Bu yüzden ROUTE BAZINDA tenant kimlikli her kullanıcıya açılamaz — yalnızca
// PLATFORM kullanıcıları görebilir. Aksi halde herhangi bir tenant üyesi tüm
// kiracıların verisini indirebilirdi (P0 güvenlik açığı, audit #3).
router.use(authenticate, requirePlatformUser());

/** Panel durumu: ayarlar + son çalışma + canlı geri sayım için `now`. */
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getBackupService().status());
  } catch (error) {
    next(error);
  }
});

/** Yedek geçmişi (en yeni `limit` kayıt). */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.trunc(limitRaw))) : 50;
    res.json(await getBackupService().list(limit));
  } catch (error) {
    next(error);
  }
});

/** "Şimdi Yedekle" — yedek arka planda üretilir, `running` kaydı döner. */
router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const logger = (req as unknown as { log?: Logger }).log;
    const result = await getBackupService().runNow(req.user?.sub, logger);
    res.status(result.alreadyRunning ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

/** Yedek ayarlarını güncelle: açık/kapalı, sıklık (dk), saklama adedi. */
router.put(
  '/settings',
  validate(updateBackupSettingsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getBackupService().updateSettings(req.body));
    } catch (error) {
      next(error);
    }
  },
);

/** Yedeği sil (dosya + kayıt). */
router.delete(
  '/:id',
  validate(backupParamsSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await getBackupService().remove(req.params.id);
      res.json({ message: 'Yedek silindi' });
    } catch (error) {
      next(error);
    }
  },
);

/** Yedeği indir — `.sql.gz` dosyasını akışla gönderir. */
router.get(
  '/:id/download',
  validate(backupParamsSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = await getBackupService().getFile(req.params.id);
      if (!file) throw new AppError('NOT_FOUND', 'Yedek dosyası bulunamadı');
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      if (file.size) res.setHeader('Content-Length', String(file.size));
      const stream = createReadStream(file.path);
      stream.on('error', next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
