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

export type GrantSupportAccessInput = z.infer<typeof grantSupportAccessSchema>;
export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>;
