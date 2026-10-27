import { z } from 'zod';

export const contactTypeSchema = z.enum(['customer', 'supplier']);
export const contactAddressTypeSchema = z.enum(['default', 'billing', 'shipping', 'other']);
export const contactPhoneTypeSchema = z.enum(['mobile', 'fax', 'work', 'home']);
export const contactEmailTypeSchema = z.enum(['default', 'notifications', 'marketing']);
export const contactRelationTypeSchema = z.enum([
  'parent',
  'child',
  'partner',
  'reference',
  'other',
]);

/** Adres veri yapısı */
export const contactAddressSchema = z.object({
  is_primary: z.boolean().default(false),
  type: contactAddressTypeSchema,
  province: z.string().optional(),
  district: z.string().optional(),
  neighborhood: z.string().optional(),
  street: z.string().optional(),
  building: z.string().optional(),
  apartment: z.string().optional(),
  zip_code: z.string().optional(),
  parsed: z.record(z.unknown()).default({}),
});

/** Telefon veri yapısı */
export const contactPhoneSchema = z.object({
  is_primary: z.boolean().default(false),
  type: contactPhoneTypeSchema,
  number: z.string().min(1, 'Telefon gerekli'),
  formatted: z.string().optional(),
  parsed: z.record(z.unknown()).default({}),
});

/** E-posta veri yapısı */
export const contactEmailSchema = z.object({
  is_primary: z.boolean().default(false),
  type: contactEmailTypeSchema,
  email: z.string().email(),
  validated: z.boolean().default(false),
});

/** İlişki veri yapısı */
export const contactRelationSchema = z.object({
  related_contact_id: z.string().uuid(),
  relation_type: contactRelationTypeSchema,
  notes: z.string().optional(),
});

/** Cari kayıt/veri yapısı */
export const createContactSchema = z.object({
  code: z.string().min(1, 'Kod gerekli'),
  name: z.string().min(1, 'Ad gerekli').max(200),
  trade_name: z.string().max(200).optional(),
  type: contactTypeSchema,
  tax_number: z.string().max(50).optional().nullable(),
  tax_office: z.string().max(100).optional().nullable(),
  /** Pasif kart yeni işlemde seçilemez; eksik gönderilirse aktif açılır. */
  is_active: z.boolean().optional(),
  settings: z.record(z.unknown()).default({}),
  addresses: z.array(contactAddressSchema).default([]),
  phones: z.array(contactPhoneSchema).default([]),
  emails: z.array(contactEmailSchema).default([]),
  relations: z.array(contactRelationSchema).default([]),
});

export const updateContactSchema = createContactSchema.partial();
export const contactIdSchema = z.object({ id: z.string().uuid() });

export const listContactsSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sort: z.enum(['code', 'name', 'created_at', 'updated_at', 'type']).default('code'),
    order: z.enum(['asc', 'desc']).default('asc'),
    type: contactTypeSchema.optional(),
    is_active: z.boolean().optional(),
    q: z.string().min(1).optional(),
  })
  .transform((v) => ({
    ...v,
    offset: (v.page - 1) * v.limit,
    cursor: null,
  }));

export const ledgerEntrySchema = z.object({
  type: z.enum(['receivable', 'payable']),
  document_type: z.string().max(50),
  document_number: z.string().max(50),
  posted_at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Geçersiz tarih'),
  amount: z.number().positive(),
  currency: z.string().default('TRY'),
  exchange_rate: z.number().positive().default(1),
  description: z.string().optional(),
});

export const listLedgerSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    type: z.enum(['receivable', 'payable']).optional(),
  })
  .transform((v) => ({
    ...v,
    offset: (v.page - 1) * v.limit,
    cursor: null,
  }));

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ContactId = z.infer<typeof contactIdSchema>;
export type ListContactsInput = z.infer<typeof listContactsSchema>;
export type LedgerEntryInput = z.infer<typeof ledgerEntrySchema>;
export type ListLedgerInput = z.infer<typeof listLedgerSchema>;

export type ContactAddress = z.infer<typeof contactAddressSchema>;
export type ContactPhone = z.infer<typeof contactPhoneSchema>;
export type ContactEmail = z.infer<typeof contactEmailSchema>;
export type ContactRelation = z.infer<typeof contactRelationSchema>;
