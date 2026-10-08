import { Router, type Request, type Response, type NextFunction } from 'express';
import { CompanyService } from './service.js';
import { validate } from '../../middleware/validate.js';
import {
  companyApplicationSchema,
  companySettingsSchema,
  companyStatusSchema,
  companyApprovalSchema,
  companySwitchSchema,
} from './schemas.js';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { AppError } from '@kuleplus/shared';

const router = Router();
const service = new CompanyService();

/** Public: Şirket başvurusu oluştur */
router.post(
  '/apply',
  validate(companyApplicationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.createApplication(req.body);
      res.status(201).json({
        message: 'Şirket başvurunuz alındı. İnceleme sonucunda size dönüş yapılacaktır.',
        ...result,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Public: Başvuru durumu sorgula */
router.get('/application/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerEmail = req.query.email as string;
    if (!ownerEmail) {
      throw new AppError('VALIDATION_ERROR', 'email query parametresi zorunlu');
    }
    const application = await service.getApplicationStatus(ownerEmail);
    if (!application) {
      throw new AppError('NOT_FOUND', 'Başvuru bulunamadı');
    }
    res.json(application);
  } catch (error) {
    next(error);
  }
});

/** Korumalı rotalar (auth gerekli) */
router.use(authenticate);

/** Şirket ayarlarını getir */
router.get('/settings', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
    }
    const settings = await service.getSettings(tenantId);
    if (!settings) {
      throw new AppError('NOT_FOUND', 'Şirket bulunamadı');
    }
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

/** Şirket ayarlarını güncelle */
router.patch(
  '/settings',
  validate(companySettingsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        throw new AppError('UNAUTHENTICATED', 'Tenant context yok');
      }
      const updated = await service.updateSettings(tenantId, req.body);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

/** Kullanıcının şirketlerini listele */
router.get(
  '/my-companies',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new AppError('UNAUTHENTICATED', 'Kullanıcı kimliği yok');
      }
      const companies = await service.listUserCompanies(userId);
      res.json(companies);
    } catch (error) {
      next(error);
    }
  },
);

/** Şirket değiştir (tenant context switching) */
router.post(
  '/switch',
  validate(companySwitchSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new AppError('UNAUTHENTICATED', 'Kullanıcı kimliği yok');
      }
      const result = await service.switchCompany(userId, req.body.tenantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Platform admin rotaları */
const isPlatformAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // TODO: Platform admin kontrolü (platform_owner rolü veya support_access_grants)
  // Şimdilik basit bir kontrol
  const userId = req.user?.sub;
  if (!userId) {
    throw new AppError('UNAUTHENTICATED', 'Kullanıcı kimliği yok');
  }
  // Platform admin kontrolü burada yapılacak
  next();
};

router.use('/admin', isPlatformAdmin);

/** Bekleyen başvuruları listele */
router.get('/admin/applications', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const applications = await service.listPendingApplications();
    res.json(applications);
  } catch (error) {
    next(error);
  }
});

/** Başvuruyu onayla/reddet */
router.post(
  '/admin/applications/:id/process',
  validate(companyApprovalSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const reviewerId = req.user?.sub;
      const result = await service.processApplication(req.params.id, {
        ...req.body,
        reviewerId,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Şirket durumunu güncelle (platform admin) */
router.patch(
  '/admin/:tenantId/status',
  validate(companyStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await service.updateStatus(req.params.tenantId, req.body.status);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
