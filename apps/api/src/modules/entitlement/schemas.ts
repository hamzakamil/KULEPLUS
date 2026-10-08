import { z } from 'zod';

/** Modül zorunlu kılma isteği */
export const requireModuleSchema = z.object({
  tenantId: z.string().uuid(),
  moduleCode: z.string().min(1),
});

/** Limit kontrol isteği */
export const checkLimitSchema = z.object({
  tenantId: z.string().uuid(),
  limitKey: z.string().min(1),
});

/** Kullanım artırma isteği */
export const incrementUsageSchema = z.object({
  tenantId: z.string().uuid(),
  limitKey: z.string().min(1),
  periodStart: z.string().datetime().optional(),
});

/** Entitlement durum yanıtı */
export type EntitlementStatus = {
  moduleCode: string;
  status: 'active' | 'expired' | 'revoked';
  grantedAt: Date;
  expiresAt: Date | null;
};

/** Kontrol sonucu */
export type CheckResult = {
  allowed: boolean;
  limitKey: string;
  current: number;
  limit: number | null;
  remaining: number | null;
  resetAt: Date;
};
