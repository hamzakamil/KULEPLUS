import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { z } from 'zod';
import { IntegrationService } from './service.js';

const router = Router();
router.use(authenticate, tenantContext, requireEntitlement('integrations'));

const service = new IntegrationService();

const canRead = requirePermission('integrations.integration.read');
const canManage = requirePermission('integrations.integration.manage');

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await fn(req, res);
      res.status(status).json(data);
    } catch (error) {
      next(error);
    }
  };

const createIntegrationSchema = z.object({
  provider: z.string().min(1).max(80),
  display_name: z.string().min(1).max(200),
});

router.get(
  '/integrations',
  canRead,
  h(async (req) => {
    const tenantId = (req as TenantRequest).tenantId;
    return service.listIntegrations(tenantId);
  }),
);

router.post(
  '/integrations',
  canManage,
  validate(createIntegrationSchema),
  h(async (req) => {
    const tenantId = (req as TenantRequest).tenantId;
    const { provider, display_name } = req.body as { provider: string; display_name: string };
    return service.createIntegration(tenantId, provider, display_name);
  }, 201),
);

const paramId = z.object({ id: z.string().uuid() });

router.get(
  '/integrations/:id',
  canRead,
  validate(paramId, 'params'),
  h(async (req) => {
    const tenantId = (req as TenantRequest).tenantId;
    const integration = await service.getIntegration(tenantId, req.params.id);
    if (!integration) throw Object.assign(new Error('Integration bulunamadı'), { statusCode: 404 });
    return integration;
  }),
);

router.post(
  '/integrations/:id/deactivate',
  canManage,
  validate(paramId, 'params'),
  h(async (req) => {
    const tenantId = (req as TenantRequest).tenantId;
    const integration = await service.deactivateIntegration(tenantId, req.params.id);
    if (!integration) throw Object.assign(new Error('Integration bulunamadı'), { statusCode: 404 });
    return integration;
  }),
);

router.get(
  '/integrations/:id/events',
  canRead,
  validate(paramId, 'params'),
  h(async (req) => {
    const tenantId = (req as TenantRequest).tenantId;
    const integration = await service.getIntegration(tenantId, req.params.id);
    if (!integration) throw Object.assign(new Error('Integration bulunamadı'), { statusCode: 404 });
    return service.listWebhookEvents(tenantId, req.params.id);
  }),
);

export { router as integrationsRoutes };
