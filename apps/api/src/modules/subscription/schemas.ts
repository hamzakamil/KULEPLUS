import { z } from 'zod';
import type { ColumnSpec, ResourceDef } from './resources';

/**
 * Subscription şemaları — `resources.ts` kolon tanımlarından ÜRETİLİR.
 *
 * Böylece API gövdesi ile tablo sütun listesi asla ayrışmaz; yeni sütun eklemek
 * tek satırlık bir değişiklik olur (SPEC §29.2 Open/Closed).
 */

/** ISO tarih veya tarih+saat (DB `timestamptz`'e doğrudan bağlanır). */
const timestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    'ISO tarih/saat bekleniyor',
  );

function fieldSchema(spec: ColumnSpec): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  if (spec.enum) {
    base = z.enum(spec.enum as [string, ...string[]]);
  } else {
    switch (spec.kind) {
      case 'uuid':
        base = z.string().uuid();
        break;
      case 'numeric':
        base = z.coerce.number().min(0).max(9999999999.99);
        break;
      case 'boolean':
        base = z.boolean();
        break;
      case 'timestamptz':
        base = timestampSchema;
        break;
      default:
        base = z
          .string()
          .min(1)
          .max(spec.maxLength ?? 255);
    }
  }
  return spec.required ? base : base.optional();
}

function shapeFor(def: ResourceDef, mode: 'create' | 'update'): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const spec of def.writable) {
    // Alt kaynakta üst kayıt kimliği gövdeden DEĞİL yol parametresinden alınır.
    if (def.parentColumn && spec.name === def.parentColumn) continue;
    shape[spec.name] = mode === 'update' ? fieldSchema(spec).optional() : fieldSchema(spec);
  }
  return shape;
}

/** POST gövdesi şeması (zorunlu alanlar zorunlu). */
export function createSchemaFor(def: ResourceDef): z.ZodObject<Record<string, z.ZodTypeAny>> {
  return z.object(shapeFor(def, 'create'));
}

/** PATCH gövdesi şeması (her alan opsiyonel; boş gövde serviste reddedilir). */
export function updateSchemaFor(def: ResourceDef): z.ZodObject<Record<string, z.ZodTypeAny>> {
  return z.object(shapeFor(def, 'update'));
}

/** Sayfalama sorgusu (tüm liste uçlarında ortak). */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQueryInput = z.infer<typeof listQuerySchema>;

/** Yol parametresi (uuid) — `:id` ve alt kaynak parametreleri. */
export const idParamSchema = z.object({ id: z.string().uuid() });

/**
 * Checkout gövdesi — sipariş → tahsilat → fatura → abonelik zinciri.
 * `provider_customer_ref` K-08 kararı gelene dek serbest metindir (mock kabul eder).
 */
export const checkoutSchema = z.object({
  order_id: z.string().uuid(),
  provider: z.string().min(1).max(40).default('mock'),
  provider_customer_ref: z.string().min(1).max(120),
  card_token: z.string().min(1).max(120).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Sağlayıcı webhook gövdesi (imza başlıktan okunur). */
export const webhookSchema = z.object({
  provider: z.string().min(1).max(40),
  event_id: z.string().min(1).max(160),
  type: z.enum(['payment.succeeded', 'payment.failed', 'refund.succeeded']),
  provider_ref: z.string().min(1).max(120),
  amount: z.coerce.number().min(0).optional(),
});
export type WebhookInput = z.infer<typeof webhookSchema>;

/**
 * İade gövdesi — `POST /subscription/payments/:paymentId/refund`.
 * `amount` verilmezse iade edilebilir TAM tutar kullanılır (kısmi iade için yazılır).
 * Para SPEC §0.3 gereği ondalık METİN (float değil).
 */
export const refundSchema = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Ondalık para metni bekleniyor (örn. 149.90)')
    .optional(),
  reason: z.string().min(3).max(500).optional(),
});
export type RefundInput = z.infer<typeof refundSchema>;

/**
 * Fatura ↔ ödeme eşleştirme gövdesi — `POST /subscription/payments/:paymentId/allocations`.
 * `amount` verilmezse faturanın eşleştirilebilir bakiyesi kullanılır.
 * Para SPEC §0.3 gereği ondalık METİN (float değil).
 */
export const allocationSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Ondalık para metni bekleniyor (örn. 149.90)')
    .optional(),
});
export type AllocationInput = z.infer<typeof allocationSchema>;

/** Her kaynak için hazırlanmış şema haritası (rota katmanı kullanır). */
export function schemaMap(
  defs: Record<string, ResourceDef>,
  mode: 'create' | 'update',
): Record<string, z.ZodObject<Record<string, z.ZodTypeAny>>> {
  const resolver = mode === 'create' ? createSchemaFor : updateSchemaFor;
  const map: Record<string, z.ZodObject<Record<string, z.ZodTypeAny>>> = {};
  for (const [key, def] of Object.entries(defs)) map[key] = resolver(def);
  return map;
}
