import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import {
  requirePlatformUser,
  requirePlatformOwner,
  requirePlatformRole,
  type PlatformRequest,
} from '../../middleware/platform';
import { validate } from '../../middleware/validate';
import { PlatformService } from './service';
import {
  addReferralSchema,
  commissionStatusSchema,
  createPartnerSchema,
  grantSupportAccessSchema,
  updatePartnerSchema,
  updateTenantStatusSchema,
} from './schemas';
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

// ===== Gelir Paneli (Faz 4 / SPEC §8.9) =====

/**
 * Canlı gelir metrikleri (MRR/ARR, plan dağılımı, yeni/ayrılan abonelik) +
 * günlük snapshot serisi. Kapı: `platform_finance` rolü veya platform_owner.
 */
router.get(
  '/metrics',
  requirePlatformRole('platform_finance'),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const raw = Number(req.query.days ?? 30);
      const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.trunc(raw))) : 30;
      const { getMetricsSummary } = await import('./metrics.service');
      res.json(await getMetricsSummary(days));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Günlük snapshot'ı hesaplar ve `platform_metrics_daily`'ye yazar (idempotent).
 * Worker günlük işi eklendiğinde bu uç yeniden hesaplama/doğrulama için kalır.
 */
router.post(
  '/metrics/snapshot',
  requirePlatformOwner(),
  async (_req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const { computeDailySnapshot } = await import('./metrics.service');
      res.status(201).json(await computeDailySnapshot());
    } catch (error) {
      next(error);
    }
  },
);

// ===== Ortak (SMMM) programı: ortaklar, atıflar, komisyon hakedişi =====
// Kapı: `platform_finance` rolü veya platform_owner. Çapraz tenant toplamları
// `partners.service` içinde `migrator` havuzuyla okunur (bkz. dosya başlığı).

/** Yol parametresi uuid değilse Postgres 22P02 (500) yerine açık 400 döner. */
function uuidParam(value: string, label: string): string {
  if (!z.string().uuid().safeParse(value).success) {
    throw new AppError('VALIDATION_ERROR', `Geçersiz ${label}`);
  }
  return value;
}

router.get(
  '/partners',
  requirePlatformRole('platform_finance'),
  async (_req, res: Response, next: NextFunction) => {
    try {
      const { listPartners } = await import('./partners.service');
      res.json({ partners: await listPartners() });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/partners',
  requirePlatformRole('platform_finance'),
  validate(createPartnerSchema),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const { createPartner } = await import('./partners.service');
      res.status(201).json(await createPartner(req.body));
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/partners/:partnerId',
  requirePlatformRole('platform_finance'),
  validate(updatePartnerSchema),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const { updatePartner } = await import('./partners.service');
      await updatePartner(uuidParam(req.params.partnerId, 'ortak kimliği'), req.body);
      res.json({ message: 'Ortak güncellendi' });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/partners/:partnerId/referrals',
  requirePlatformRole('platform_finance'),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const { listReferrals } = await import('./partners.service');
      res.json({
        referrals: await listReferrals(uuidParam(req.params.partnerId, 'ortak kimliği')),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Platform, bir şirketi ortağa elle atfeder (kayıt linki gelene dek tek giriş yolu). */
router.post(
  '/partners/:partnerId/referrals',
  requirePlatformRole('platform_finance'),
  validate(addReferralSchema),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const { addReferral } = await import('./partners.service');
      const result = await addReferral(
        uuidParam(req.params.partnerId, 'ortak kimliği'),
        req.body.tenantId,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/partners/:partnerId/commissions',
  requirePlatformRole('platform_finance'),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const { listCommissions, COMMISSION_STATUSES } = await import('./partners.service');
      const raw = typeof req.query.status === 'string' ? req.query.status : undefined;
      if (raw && !(COMMISSION_STATUSES as readonly string[]).includes(raw)) {
        throw new AppError('VALIDATION_ERROR', 'Geçersiz durum filtresi');
      }
      const commissions = await listCommissions(
        uuidParam(req.params.partnerId, 'ortak kimliği'),
        raw as (typeof COMMISSION_STATUSES)[number] | undefined,
      );
      res.json({ commissions });
    } catch (error) {
      next(error);
    }
  },
);

/** Komisyon durumu: pending → approved → paid, pending/approved → cancelled. */
router.patch(
  '/commissions/:commissionId/status',
  requirePlatformRole('platform_finance'),
  validate(commissionStatusSchema),
  async (req: PlatformRequest, res: Response, next: NextFunction) => {
    try {
      const { setCommissionStatus } = await import('./partners.service');
      await setCommissionStatus(
        uuidParam(req.params.commissionId, 'komisyon kimliği'),
        req.body.status,
        req.platformUser!.userId,
      );
      res.json({ message: 'Komisyon durumu güncellendi' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
