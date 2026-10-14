import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '@kuleplus/shared';
import { RESOURCES, type ResourceDef } from './resources';
import {
  listQuerySchema,
  schemaMap,
  checkoutSchema,
  webhookSchema,
  refundSchema,
  allocationSchema,
  manualConfirmSchema,
  type CheckoutInput,
  type ListQueryInput,
  type RefundInput,
  type AllocationInput,
  type ManualConfirmInput,
} from './schemas';
import { SubscriptionService, type ResourceSelector } from './service';
import { createPaymentProvider } from '@kuleplus/shared';

const router = Router();

// İmzalı kamu webhook'u (Faz 4 K-08) — AUTH'SUZ. iyzico JWT göndermez; yetkilendirme
// HAM gövde + X-IYZ-SIGNATURE-V3 imzasıyla yapılır. `router.use(authenticate)` satırından
// ÖNCE bağlanmalıdır (aksi halde tüm alt route'lar kimlik ister). `service` aşağıda
// tanımlıdır; handler yalnızca istek anında çalıştığı için erişim güvenlidir.
router.post(
  '/webhooks/public/:provider',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? '';
      const signature = req.get('x-iyzi-signature-v3') ?? undefined;
      const data = await service.handleProviderWebhook({
        provider: (req.params as Record<string, string>).provider,
        rawBody,
        signature,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  },
);

// Tüm abonelik uçları: kimlik + tenant + entitlement.
// Modül kodu GOVERNANCE §2'ye göre 'subscription' (Faz 4 Hat B).
router.use(authenticate, tenantContext, requireEntitlement('subscription'));

// Ödeme sağlayıcı seçimi (Faz 4 K-08): PAYMENT_PROVIDER=mock|iyzico|manual.
// Fail-fast: 'iyzico' seçiliyse anahtarlar yoksa import anında hata (Faz 1).
const service = new SubscriptionService({ paymentProvider: createPaymentProvider() });

// RBAC kapıları (SPEC §6.3) — izin kataloğu shared/permissions.ts'ten senkron olur.
const canCreate = requirePermission('subscription.subscription.create');
const canUpdate = requirePermission('subscription.subscription.update');
const canDelete = requirePermission('subscription.subscription.delete');
const canManage = requirePermission('subscription.subscription.manage');

// Kaynak tanımlarından ÜRETİLEN şemalar (resources.ts ↔ schemas.ts aynı kaynaktan).
const CREATE_SCHEMAS = schemaMap(RESOURCES, 'create');
const UPDATE_SCHEMAS = schemaMap(RESOURCES, 'update');

/** Async sarmalayıcı — merkezi hata sözleşmesine (SPEC §22.1) devreder. */
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

/** Yol parametresi (uuid) şeması. */
const paramId = (name: string) => z.object({ [name]: z.string().uuid() });

/** Kaynak tanımından rota seçicisi üretir (parent parametresini bağlar). */
function selectorOf(def: ResourceDef, req: Request, parentParam?: string): ResourceSelector {
  return {
    table: def.table,
    columns: def.columns,
    global: def.global,
    tenantId: (req as TenantRequest).tenantId,
    parentColumn: def.parentColumn,
    parentId: parentParam ? (req.params as Record<string, string>)[parentParam] : undefined,
  };
}

/** CRUD kapsamı: 'full' hepsi · 'create' liste+oluşturma · 'read' yalnızca okuma. */
type CrudMode = 'full' | 'create' | 'read';

/**
 * Bir RESOURCES tanımını standart REST uçlarına bağlar:
 *   GET  {base}           → liste (sayfalı)
 *   POST {base}           → oluştur (201)
 *   GET  {base}/:id       → tek kayıt
 *   PATCH {base}/:id      → güncelle
 *   DELETE {base}/:id     → sil
 * Alt kaynaklarda üst kayıt kimliği `base` içindeki `:param`'dan gider.
 */
function mountResource(
  defKey: string,
  base: string,
  opts: { idParam?: string; parentParam?: string; mode?: CrudMode } = {},
): void {
  const def = RESOURCES[defKey];
  if (!def) throw new Error(`Bilinmeyen kaynak: ${defKey}`);
  const idParam = opts.idParam ?? 'id';
  const mode = opts.mode ?? 'full';
  const detail = `${base}/:${idParam}`;
  // Alt kaynakta üst kayıt kimliği yol parametresinden alınır (gövdeden kabul edilmez).
  const injectParent = (req: Request): Record<string, unknown> =>
    def.parentColumn && opts.parentParam
      ? { [def.parentColumn]: (req.params as Record<string, string>)[opts.parentParam] }
      : {};

  router.get(
    base,
    validate(listQuerySchema, 'query'),
    h(async (req) =>
      service.listResource(
        selectorOf(def, req, opts.parentParam),
        req.query as unknown as ListQueryInput,
      ),
    ),
  );

  if (mode !== 'read') {
    router.post(
      base,
      canCreate,
      validate(CREATE_SCHEMAS[def.key]),
      h(
        async (req) =>
          service.createResource({
            ...selectorOf(def, req, opts.parentParam),
            data: { ...(req.body as Record<string, unknown>), ...injectParent(req) },
            userId: (req as TenantRequest).user?.sub,
          }),
        201,
      ),
    );
  }

  router.get(
    detail,
    validate(paramId(idParam), 'params'),
    h(async (req) => {
      const row = await service.getResource({
        ...selectorOf(def, req, opts.parentParam),
        id: (req.params as Record<string, string>)[idParam],
      });
      if (!row) throw new AppError('NOT_FOUND', 'Kayıt bulunamadı');
      return row;
    }),
  );

  if (mode === 'full') {
    router.patch(
      detail,
      canUpdate,
      validate(UPDATE_SCHEMAS[def.key]),
      h(async (req) =>
        service.updateResource({
          ...selectorOf(def, req, opts.parentParam),
          data: req.body as Record<string, unknown>,
          id: (req.params as Record<string, string>)[idParam],
          userId: (req as TenantRequest).user?.sub,
        }),
      ),
    );
    router.delete(
      detail,
      canDelete,
      h(async (req) =>
        service.deleteResource({
          ...selectorOf(def, req, opts.parentParam),
          id: (req.params as Record<string, string>)[idParam],
          userId: (req as TenantRequest).user?.sub,
        }),
      ),
    );
  }
}

// ============ Kaynak bağlaması ============
// DİKKAT sıra: Express ilk eşleşen kuralı kullanır → statik üst yollar (`/orders`,
// `/invoices` …) kök kaynağın `/:id` kalıbından ÖNCE bağlanır.

// Alt kaynaklar (üst kayıt kimliği yol parametresinden gelir, gövdeden alınmaz):
mountResource('subscriptionItems', '/subscriptions/:subscriptionId/items', {
  idParam: 'itemId',
  parentParam: 'subscriptionId',
});
mountResource('subscriptionChanges', '/subscriptions/:subscriptionId/changes', {
  idParam: 'changeId',
  parentParam: 'subscriptionId',
  mode: 'create',
});
// Havale/EFT manuel onay (SPEC §8.5) — statik alt desen; `/orders` kök `/:id`
// kalıbından ÖNCE bağlanır (Express ilk eşleşen kuralı).
router.post(
  '/orders/:orderId/manual-confirm',
  canManage,
  validate(manualConfirmSchema),
  h(async (req) => {
    const input = req.body as unknown as ManualConfirmInput;
    return service.confirmManualPayment({
      orderId: (req.params as Record<string, string>).orderId,
      reference: input.reference,
      note: input.note,
      userId: (req as TenantRequest).user!.sub,
      tenantId: (req as TenantRequest).tenantId!,
    });
  }, 201),
);
mountResource('commercialOrderItems', '/orders/:orderId/items', {
  idParam: 'itemId',
  parentParam: 'orderId',
});
mountResource('billingInvoiceLines', '/invoices/:invoiceId/lines', {
  idParam: 'lineId',
  parentParam: 'invoiceId',
});
mountResource('couponRedemptions', '/coupons/:couponId/redemptions', {
  idParam: 'redemptionId',
  parentParam: 'couponId',
  mode: 'create',
});
mountResource('partnerReferrals', '/partners/:partnerId/referrals', {
  idParam: 'referralId',
  parentParam: 'partnerId',
  mode: 'create',
});
mountResource('partnerCommissions', '/partners/:partnerId/commissions', {
  idParam: 'commissionId',
  parentParam: 'partnerId',
  mode: 'create',
});
// İade + alacak eşleştirme kayıtları (ödeme altında, salt okunur — yazma uçları aşağıda):
mountResource('billingRefunds', '/payments/:paymentId/refunds', {
  idParam: 'refundId',
  parentParam: 'paymentId',
  mode: 'read',
});
mountResource('billingAllocations', '/payments/:paymentId/allocations', {
  idParam: 'allocationId',
  parentParam: 'paymentId',
  mode: 'read',
});

// Üst kaynaklar:
mountResource('commercialOrders', '/orders');
mountResource('paymentAttempts', '/payment-attempts');
mountResource('billingPayments', '/payments', { mode: 'create' }); // asıl kaydı checkout üretir
mountResource('billingInvoices', '/invoices');
mountResource('coupons', '/coupons');
mountResource('partners', '/partners');
mountResource('subscriptions', '/subscriptions');

// ============ İade ve fatura/alacak eşleştirme ============
router.post(
  '/payments/:paymentId/refunds',
  canManage,
  validate(refundSchema),
  h(async (req) => {
    const input = req.body as unknown as RefundInput;
    return service.refundPayment({
      paymentId: (req.params as Record<string, string>).paymentId,
      amount: input.amount,
      reason: input.reason,
      userId: (req as TenantRequest).user!.sub,
      tenantId: (req as TenantRequest).tenantId!,
    });
  }),
);

// Fatura ↔ ödeme eşleştirme (alacak) — `POST /subscription/payments/:paymentId/allocations`
router.post(
  '/payments/:paymentId/allocations',
  canManage,
  validate(allocationSchema),
  h(async (req) => {
    const input = req.body as unknown as AllocationInput;
    return service.allocatePayment({
      paymentId: (req.params as Record<string, string>).paymentId,
      invoiceId: input.invoice_id,
      amount: input.amount,
      userId: (req as TenantRequest).user!.sub,
      tenantId: (req as TenantRequest).tenantId!,
    });
  }),
);

// ============ Checkout (sipariş → tahsilat → fatura → abonelik) ============
router.post(
  '/checkout',
  canManage,
  validate(checkoutSchema),
  h(async (req) => {
    const input = req.body as unknown as CheckoutInput;
    return service.checkout({
      orderId: input.order_id,
      provider: input.provider,
      providerCustomerRef: input.provider_customer_ref,
      userId: (req as TenantRequest).user!.sub,
      tenantId: (req as TenantRequest).tenantId!,
    });
  }, 201),
);

// ============ Sağlayıcı webhook (elle replay; K-08 ile imzalı kamu ucu olur) ============
router.post(
  '/webhooks/:provider',
  canManage,
  h(async (req) => {
    const input = webhookSchema.parse(req.body);
    return service.handleWebhook(
      {
        provider: (req.params as Record<string, string>).provider,
        eventId: input.event_id,
        type: input.type,
        providerRef: input.provider_ref,
        raw: input,
      },
      (req as TenantRequest).tenantId,
    );
  }),
);

export { router as subscriptionRoutes };
