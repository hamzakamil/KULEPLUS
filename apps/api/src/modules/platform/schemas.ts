import { z } from 'zod';

/**
 * Platform rotalarının Zod şemaları — tek doğruluk kaynağı (SPEC §29.6).
 * Not: mevcut `validate()` yalnızca `req.body` doğrular; params/query rotada ele alınır.
 */

export const grantSupportAccessSchema = z.object({
  tenantId: z.string().uuid(),
  platformUserId: z.string().uuid(),
  reason: z.string().min(10, 'Gerekçe en az 10 karakter olmalıdır'),
  scope: z.enum(['read_only', 'read_write']).default('read_only'),
  expiresInHours: z.number().int().positive().max(720).default(24),
});

export const updateTenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'closed', 'archived']),
  reason: z.string().max(500).optional(),
});

// ===== Ortak (SMMM) programı =====

const commissionRate = z.number().min(0, 'Oran 0–100 arasında olmalıdır').max(100);

export const createPartnerSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Za-z0-9_-]+$/, 'Kod yalnızca harf, rakam, "-" ve "_" içerebilir'),
  name: z.string().trim().min(2).max(255),
  /** Yüzde (örn. 20 = %20). 0 ise komisyon üretilmez. */
  commissionRate: commissionRate.default(0),
});

export const updatePartnerSchema = z
  .object({
    name: z.string().trim().min(2).max(255).optional(),
    commissionRate: commissionRate.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Güncellenecek alan yok');

export const commissionStatusSchema = z.object({
  status: z.enum(['approved', 'paid', 'cancelled']),
});

export const addReferralSchema = z.object({ tenantId: z.string().uuid() });

export type GrantSupportAccessInput = z.infer<typeof grantSupportAccessSchema>;
export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>;
