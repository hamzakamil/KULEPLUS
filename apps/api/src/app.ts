import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { createRequire } from 'node:module';
// helmet v8 sertleştirmesi: paketin `exports` alanında `types` koşulu yok.
// Bazı TS çözümleyiciler (Vercel/Node10) default importu namespace tipine düşürüp
// TS2349 ("has no call signatures") veriyor. Statik import tipine hiç bel
// bağlamamak için createRequire ile yüklenir → `require` dönüşü `any`
// olduğundan tip hatası imkânsız; runtime'da hem CJS fonksiyon hem
// `{ default }` namespace formu desteklenir.
const _require = createRequire(import.meta.url);
type HelmetCallable = (options?: Record<string, unknown>) => RequestHandler;
const _helmetMod = _require('helmet') as unknown as HelmetCallable | { default: HelmetCallable };
const helmet: HelmetCallable = typeof _helmetMod === 'function' ? _helmetMod : _helmetMod.default;
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
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
import { tradeRoutes } from './modules/trade/routes';
import stockRoutes from './modules/stock/routes';
import invoiceRoutes from './modules/trade/invoice/routes';
import { cashBankRoutes } from './modules/cash-bank/routes';
import { cashBankMovementRoutes as cashBankMovementsRoutes } from './modules/cash-bank/movement.routes';
import { bankExtrasRoutes } from './modules/cash-bank/bank-extras.routes';
import { currencyRoutes } from './modules/cash-bank/currency.routes';
import { expenseRoutes } from './modules/expense/routes';
import { reportRoutes } from './modules/reports_plus/routes';
import backupRoutes from './modules/backup/routes';
import { accountingRoutes } from './modules/accounting/routes';
import { chequeRoutes } from './modules/cheque/routes';
import { subscriptionRoutes } from './modules/subscription/routes';
import { einvoiceRoutes } from './modules/einvoice/routes';
import { managementRoutes } from './modules/management/routes';
import coreRoutes from './modules/core/routes';
import publicRoutes from './modules/public/routes';
import { integrationsRoutes } from './modules/integrations/routes';

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
  // Raw gövde, ödeme sağlayıcı webhook imza doğrulaması için saklanır
  // (Faz 4 K-08): ayrıştırılmış `req.body` değişmeden kalır, yalnızca ham metin
  // eklenir. İmza her zaman HAM gövde üzerinden hesaplanır.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    }),
  );

  // ---- API rotaları ----
  app.use('/api/v1/auth', identityRoutes);
  app.use('/api/v1/company', companyRoutes);
  app.use('/api/v1/entitlements', entitlementRoutes);
  app.use('/api/v1/authorization', authorizationRoutes);
  app.use('/api/v1/platform', platformRoutes);
  app.use('/api/v1', auditRoutes);
  app.use('/api/v1/contacts', contactsRoutes);
  app.use('/api/v1/trade', tradeRoutes);
  app.use('/api/v1/stock', stockRoutes);
  app.use('/api/v1/invoices', invoiceRoutes);
  // DİKKAT sıralama: `/movements` ve `/bank` alt rotaları, parametrik `/:id`
  // rotasından ÖNCE mount edilmelidir (aksi halde cashBankRoutes `/:id`
  // "movements"/"bank"ı id olarak yutar → uuid 500'ü).
  app.use('/api/v1/cash-bank/movements', cashBankMovementsRoutes);
  app.use('/api/v1/cash-bank/bank', bankExtrasRoutes);
  // Döviz kuru uçları — `/:id` parametrik rotadan ÖNCE (özel yol önceliği).
  app.use('/api/v1/cash-bank/exchange-rates', currencyRoutes);
  app.use('/api/v1/cash-bank', cashBankRoutes);
  app.use('/api/v1/expenses', expenseRoutes);
  app.use('/api/v1/reports', reportRoutes);
  app.use('/api/v1/accounting', accountingRoutes);
  app.use('/api/v1/cheques', chequeRoutes);
  // Abonelik & faturalama (Faz 4 Hat B) — yalnızca kimlik + tenant + entitlement uçları.
  // Checkout ve faturalama API tarafı: packages/shared/src/integrations/{payment,mock-payment}.
  app.use('/api/v1/subscription', subscriptionRoutes);
  // Yedekleme: platform düzeyi uçlar (tam DB dump'ı) — koruma zinciri rotanın
  // içinde (`authenticate` + `requirePlatformUser`), buraya tenant kapısı konmaz.
  app.use('/api/v1/backups', backupRoutes);
  app.use('/api/v1/einvoice', einvoiceRoutes);
  app.use('/api/v1/management', managementRoutes);
  app.use('/api/v1/core', coreRoutes);
  // Public (girişsiz) uçlar — pazarlama sitesi iletişim formu (ROADMAP Faz 2).
  app.use('/api/v1/public', publicRoutes);
  // Entegrasyonlar (Faz 8 — webhook altyapısı, SPEC §20).
  app.use('/api/v1/integrations', integrationsRoutes);

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
    app.get('/_test/pg-invalid-uuid', (_req, _res, next) => {
      // pg uuid `22P02` simülasyonu — örn. `/entries` `/:id`'ye düşerse
      next(
        Object.assign(new Error('invalid input syntax for type uuid: "movements"'), {
          code: '22P02',
        }),
      );
    });
  }

  // ---- 404: sözleşme dışı istekler de hata formatında döner ----
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new AppError('NOT_FOUND', `Rota bulunamadı: ${req.method} ${req.path}`));
  });

  // ---- Merkezi hata middleware'i (SPEC §22.1) ----
  // pg `22P02` (uuid/enum sayısal sözdizimi): ör. tanımsız statik yol `/:id`'ye düşerse
  // (`/entries` → `id="entries"`). Böyle bir id ile kayıt var olamayacağı için 404'tür.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const pgCode = (err as { code?: string } | null)?.code;
    if (pgCode === '22P02') {
      const notFound = new AppError('NOT_FOUND', 'Kayıt bulunamadı');
      req.log?.warn({ code: notFound.code, pgCode }, 'pg 22P02 → 404');
      res.status(notFound.httpStatus).json(notFound.toJSON());
      return;
    }
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
