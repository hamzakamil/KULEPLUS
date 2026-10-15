import { Router, type Request, type Response, type NextFunction } from 'express';
import type { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { AuditService } from './service.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { AppError } from '@kuleplus/shared';
import { auditListQuerySchema, auditParamsSchema } from './schemas.js';

const router = Router();
const service = new AuditService();

/**
 * Express ParsedQs'u şemaya göre doğrula ve tipleyerek dışa aktar.
 *
 * DİKKAT: iki overload. Birinci overload strict AÇIK derlemede çağrı
 * noktasına hassas `{ query: ... }` tipini verir (orijinal davranış).
 * strictNullChecks KAPALI derlemede (Vercel build) Zod'un `_output`'u
 * optional-infer edildiği için birinci overload tutmaz; ikinci overload
 * (`any`) devreye girer ve TS2345/TS2698/TS2339 engellenir.
 * Runtime davranışı iki modda da aynıdır (safeParse + query iadesi).
 */
function parseQuery<T>(schema: z.ZodSchema<{ query: T }>, req: Request): T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseQuery(schema: ZodTypeAny, req: Request): any;
function parseQuery(schema: ZodTypeAny, req: Request): unknown {
  const parsed = schema.safeParse({ query: req.query });
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AppError('VALIDATION_ERROR', messages);
  }

  return (parsed.data as { query: unknown }).query;
}

router.get(
  '/audit-logs',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');

      const query = parseQuery(auditListQuerySchema, req) as z.infer<
        typeof auditListQuerySchema
      >['query'] & {
        after?: Date;
        before?: Date;
      };
      const { logs, total } = await service.list(tenantId, query);

      res.json({ logs, total, page: query.page, limit: query.limit });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/audit-logs/:id',
  authenticate,
  validate(auditParamsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');

      const log = await service.get(tenantId, req.params.id);
      if (!log) throw new AppError('NOT_FOUND', 'Denetim kaydı bulunamadı');

      res.json(log);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
