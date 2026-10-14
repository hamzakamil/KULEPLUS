import { z } from 'zod';

/**
 * Modül zorunlu kılma isteği.
 * NOT: `tenantId` body'den ALINMAZ — tenant bağlamı JWT'den (`req.user.tenantId`)
 * ve RLS'ten gelir (SPEC §5.1/§7); body'de istemek tenant sızıntısı riski taşır.
 */
export const requireModuleSchema = z.object({
  moduleCode: z.string().min(1),
});

/** Limit kontrol isteği (tenant bağlamı JWT'den gelir) */
export const checkLimitSchema = z.object({
  limitKey: z.string().min(1),
});

/** Kullanım artırma isteği (tenant bağlamı JWT'den gelir) */
export const incrementUsageSchema = z.object({
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
