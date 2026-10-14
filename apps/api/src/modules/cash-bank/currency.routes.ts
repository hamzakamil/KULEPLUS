import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { validate } from '../../middleware/validate.js';
import {
  listRates,
  latestRates,
  importRates,
  revalueForeignBalances,
  type ExchangeRateListQuery,
} from './currency.service';

/**
 * Döviz Kuru Uçları — Faz 6.2 (ROADMAP Faz 6, SPEC §9.1/§9.2).
 * Mevcut kasa/banka uçları gibi `cashbank` entitlement'ına bağlıdır.
 */

const router = Router();

router.use(authenticate, tenantContext, requireEntitlement('cashbank'));

const ExchangeRateListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  currency: z.string().length(3).optional(),
  baseCurrency: z.string().length(3).default('TRY'),
  source: z.string().max(20).optional(),
});

const ImportRatesSchema = z.object({
  rateDate: z.string().date().optional(),
});

const RevalueSchema = z.object({
  valuationDate: z.string().date().optional(),
});

const todayIso = (): string => new Date().toISOString().slice(0, 10);

// ============ Exchange Rates ============

router.get(
  '/',
  validate(ExchangeRateListQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await listRates(
        (req as TenantRequest).tenantId,
        req.query as unknown as ExchangeRateListQuery,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get('/latest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await latestRates((req as TenantRequest).tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/import',
  validate(ImportRatesSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await importRates(
        (req as TenantRequest).tenantId,
        (req as TenantRequest).user!.sub,
        req.body.rateDate,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/revalue',
  validate(RevalueSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await revalueForeignBalances(
        (req as TenantRequest).tenantId,
        req.body.valuationDate ?? todayIso(),
        (req as TenantRequest).user!.sub,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export { router as currencyRoutes };
