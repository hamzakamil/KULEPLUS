import { z } from 'zod';

/** Şirket başvuru isteği (public) */
export const companyApplicationSchema = z.object({
  /** Şirket adı (ünvan) */
  name: z.string().min(2).max(200),
  /** Ticari unvan (farklı olabilir) */
  tradeName: z.string().max(200).optional(),
  /** Vergi dairesi */
  taxOffice: z.string().max(100).optional(),
  /** Vergi numarası (VKN) veya TCKN */
  taxNumber: z.string().max(20).optional(),
  /** Para birimi (ISO 4217) */
  currency: z.string().length(3).default('TRY'),
  /** Mali yıl başlangıç ayı (1-12) */
  fiscalYearStart: z.number().int().min(1).max(12).default(1),
  /** Saat dilimi (IANA) */
  timezone: z.string().default('Europe/Istanbul'),
  /** Başvuru sahibi e-posta (kayıtlı kullanıcı) */
  ownerEmail: z.string().email(),
  /** Başlangıç modülü */
  startingModule: z.enum(['contacts', 'stock']).optional(),
});

/** Şirket ayarları güncelleme (korumalı - owner/admin) */
export const companySettingsSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  tradeName: z.string().max(200).optional().nullable(),
  taxOffice: z.string().max(100).optional().nullable(),
  taxNumber: z.string().max(20).optional().nullable(),
  currency: z.string().length(3).optional(),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
  timezone: z.string().optional(),
  settings: z.record(z.unknown()).optional(), // JSONB genişletilebilir ayarlar
});

/** Şirket durumu güncelleme (platform admin) */
export const companyStatusSchema = z.object({
  status: z.enum(['pending', 'active', 'suspended', 'closed', 'archived']),
});

/** Şirket onayı (platform admin) */
export const companyApprovalSchema = z.object({
  /** Onaylanıyorsa true, reddediliyorsa false */
  approve: z.boolean(),
  /** Red sebebi (approve=false ise zorunlu) */
  rejectionReason: z.string().max(500).optional(),
});

/** Şirket değiştirme (tenant context switching) */
export const companySwitchSchema = z.object({
  tenantId: z.string().uuid(),
});

export type CompanyApplicationInput = z.infer<typeof companyApplicationSchema>;
export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;
export type CompanyStatusInput = z.infer<typeof companyStatusSchema>;
export type CompanyApprovalInput = z.infer<typeof companyApprovalSchema>;
export type CompanySwitchInput = z.infer<typeof companySwitchSchema>;
