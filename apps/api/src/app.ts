import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import { AppError, newId } from '@kuleplus/shared';
import type { Env } from './config/env';
import identityRoutes from './modules/identity/routes';
import companyRoutes from './modules/company/routes';
import entitlementRoutes from './modules/entitlement/routes';
import auditRoutes from './modules/audit/routes';
import platformRoutes from './modules/platform/routes';
import authorizationRoutes from './modules/authorization/routes';
import contactsRoutes from './modules/contacts/routes';
import stockRoutes from './modules/stock/routes';

export interface CreateAppOptions {
  env: Env;
  logger: Logger;
  /** Test rotaları yalnızca test çağrısında açılır. */
  testRoutes?: boolean;
}

/**
 * Uygulama iskeleti (SPEC §22.1 hata sözleşmesi, §27.4 log):
 * request ID → pino → helmet/cors → rotlar → 404 → merkezi hata middleware'i.
 * İş katmanı (modüller) Faz 1'de `src/modules/<modül>/` altında eklenir.
 */
export function createApp({ env, logger, testRoutes = false }: CreateAppOptions): Express {
  const app = express();

  // Request ID: istemci verdiyse korunur, yoksa üretilir; yanıtta da döner.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.headers['x-request-id'];
    const id = typeof header === 'string' && header.length > 0 ? header : newId();
    res.locals.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const locals = (res as unknown as { locals?: { requestId?: string } }).locals;
        return locals?.requestId ?? newId();
      },
    }),
  );

  app.use(helmet());
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  // ---- API rotaları ----
  app.use('/api/v1/auth', identityRoutes);
  app.use('/api/v1/company', companyRoutes);
  app.use('/api/v1/entitlements', entitlementRoutes);
  app.use('/api/v1/authorization', authorizationRoutes);
  app.use('/api/v1/platform', platformRoutes);
  app.use('/api/v1', auditRoutes);
  app.use('/api/v1/contacts', contactsRoutes);
  app.use('/api/v1/stock', stockRoutes);

  // ---- Sağlık uçları (SPEC §30.7; readyz gerçek bağımlılık kontrolü Faz 1'de) ----
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/readyz', (_req, res) => {
    res.status(200).json({ status: 'ready' });
  });

  // ---- Test rotaları (yalnızca testRoutes) ----
  if (testRoutes) {
    app.get('/_test/forbidden', (_req, _res, next) => {
      next(new AppError('TENANT_FORBIDDEN'));
    });
    app.get('/_test/boom', (_req, _res, next) => {
      next(new Error('bilinmeyen hata — ayrıntı loga gider'));
    });
  }

  // ---- 404: sözleşme dışı istekler de hata formatında döner ----
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new AppError('NOT_FOUND', `Rota bulunamadı: ${req.method} ${req.path}`));
  });

  // ---- Merkezi hata middleware'i (SPEC §22.1) ----
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      req.log?.warn({ code: err.code }, err.message);
      res.status(err.httpStatus).json(err.toJSON());
      return;
    }
    req.log?.error({ err }, 'Beklenmeyen hata');
    const isProduction = env.NODE_ENV === 'production';
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction ? 'Beklenmeyen bir hata oluştu.' : String(err),
      },
    });
  });

  return app;
}
