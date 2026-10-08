import { Router, type Response, type NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import {
  requirePlatformUser,
  requirePlatformOwner,
  requirePlatformRole,
  type PlatformRequest,
} from '../../middleware/platform';
import { validate } from '../../middleware/validate';
import { PlatformService } from './service';
import { grantSupportAccessSchema, updateTenantStatusSchema } from './schemas';
import { CompanyService } from '../company/service';
import { AppError } from '@kuleplus/shared';

/**
 * Platform paneli rotaları v0 — SPEC §28.1, ROADMAP Faz 1.
 * Tümü platform kullanıcısı gerektirir; başvuru onayı/plan kataloğu yalnızca platform_owner.
 * Çapraz tenant verisi YALNIZCA support_access_grants ile okunur (SPEC §5.1).
 */
const router = Router();
const platformService = new PlatformService();
const companyService = new CompanyService();

// Bu router'daki tüm rotalar kimlik doğrulama + platform üyeliği ister
router.use(authenticate, requirePlatformUser());

// ===== Ben =====
/** Giriş yapan platform kullanıcısının kendi bilgisi. */
router.get('/me', (req: PlatformRequest, res: Response) => {
  res.json({ platformUser: req.platformUser });
});

// ===== Şirket Başvuruları (platform_owner) =====
/** Bekleyen başvuruları listele. */
router.get(
  '/applications',
  requirePlatformOwner(),
  async (_req, res: Response, next: NextFunction) => {
    try {
      const applications = await companyService.listPendingApplications();
      res.json({ applications });
    } catch (error) {
      next(error);
    }
  },
);

/** Başvuruyu onayla/reddet — tek kilitli transaction (SPEC §4.3). */
router.post(
  '/applications/:id/process',
  requirePlatformOwner(),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const approve = req.body?.approve;
      if (typeof approve !== 'boolean') {
        throw new AppError('VALIDATION_ERROR', 'approve (boolean) zorunludur');
      }
      const result = await companyService.processApplication(req.params.id, {
        approve,
        rejectionReason: req.body?.rejectionReason,
        reviewerId: req.platformUser!.userId,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ===== Şirketler (tenant) =====
/** Tenant listesi (durum filtresiyle). */
router.get('/tenants', async (req, res: Response, next: NextFunction) => {
  try {
    const { listTenants } = await import('./service');
    const tenants = await listTenants({
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      page: Number(req.query.page ?? 1),
      limit: Math.min(Number(req.query.limit ?? 20), 100),
    });
    res.json(tenants);
  } catch (error) {
    next(error);
  }
});

/** Tek tenant detayı. */
router.get('/tenants/:tenantId', async (req, res: Response, next: NextFunction) => {
  try {
    const { getTenantDetail } = await import('./service');
    const tenant = await getTenantDetail(req.params.tenantId);
    if (!tenant) throw new AppError('NOT_FOUND', 'Tenant bulunamadı');
    res.json(tenant);
  } catch (error) {
    next(error);
  }
});

/** Tenant durumunu değiştir (askıya al/aç/kapat) — platform_owner. */
router.patch(
  '/tenants/:tenantId/status',
  requirePlatformOwner(),
  validate(updateTenantStatusSchema),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const { updateTenantStatus } = await import('./service');
      await updateTenantStatus(req.params.tenantId, req.body.status, req.platformUser!.userId);
      res.json({ message: 'Durum güncellendi' });
    } catch (error) {
      next(error);
    }
  },
);

// ===== Destek Erişim Grantları (platform_support veya owner) =====
/** Grant listesi (aktif + geçmiş). */
router.get('/support-grants', async (req, res: Response, next: NextFunction) => {
  try {
    const { listSupportGrants } = await import('./service');
    const grants = await listSupportGrants(
      typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined,
    );
    res.json({ grants });
  } catch (error) {
    next(error);
  }
});

/** Yeni grant aç — gerekçe + süre zorunlu, audit'li (SPEC §5.1). */
router.post(
  '/support-grants',
  requirePlatformRole('platform_support'),
  validate(grantSupportAccessSchema),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const result = await platformService.grantSupportAccess({
        ...req.body,
        grantedBy: req.platformUser!.id,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Grant'ı iptal et. */
router.post(
  '/support-grants/:id/revoke',
  requirePlatformRole('platform_support'),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      await platformService.revokeGrant(req.params.id, req.platformUser!.id);
      res.json({ message: 'Grant iptal edildi' });
    } catch (error) {
      next(error);
    }
  },
);

// ===== Denetim (platform) =====
/** Platform düzeyinde denetim kayıtları (cursor — ADR-0014). */
router.get('/audit-logs', async (req, res: Response, next: NextFunction) => {
  try {
    const { listPlatformAudit } = await import('./service');
    const result = await listPlatformAudit({
      tenantId: typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined,
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
      limit: Math.min(Number(req.query.limit ?? 50), 200),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
