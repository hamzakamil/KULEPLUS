import { z } from 'zod';

/** Ortak sabitler — SPEC §15. */
export const ACCOUNT_TYPES = ['group', 'detail'] as const;
export const ENTRY_TYPES = [
  'mahsup',
  'tahsil',
  'tediye',
  'acilis',
  'duzeltme',
  'ters',
  'donem_sonu',
  'kapanis',
] as const;
export const ENTRY_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export const PERIOD_STATUSES = ['open', 'closed'] as const;
export const MAPPING_DIRECTIONS = ['debit', 'credit'] as const;
export const MAPPING_SOURCE_TYPES = [
  'sales',
  'purchase',
  'vat_output',
  'vat_input',
  'cash',
  'bank',
  'stock_cost',
] as const;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD formatı gerekli');

// ======================= Hesap Planı =======================
export const createAccountSchema = z.object({
  code: z.string().min(1).max(20, 'TDHP kodu en fazla 20 karakter olmalı'),
  name: z.string().min(1),
  type: z.enum(ACCOUNT_TYPES).default('detail'),
  parent_id: z.string().uuid().nullish(),
  is_tdphp: z.boolean().default(false),
  is_active: z.boolean().default(true),
  opening_debit: z.number().nonnegative().default(0),
  opening_credit: z.number().nonnegative().default(0),
});

export const updateAccountSchema = createAccountSchema.partial();

export const accountListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  q: z.string().optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  is_active: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  is_tdphp: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  only_posting: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  sortBy: z.enum(['code', 'name', 'type', 'createdAt']).default('code'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

// ======================= Malî Dönem =======================
export const createPeriodSchema = z.object({
  label: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  start_date: dateString,
  end_date: dateString,
  status: z.enum(PERIOD_STATUSES).default('open'),
});

export const updatePeriodSchema = createPeriodSchema.partial();

export const periodListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().optional(),
  year: z.coerce.number().int().optional(),
  status: z.enum(PERIOD_STATUSES).optional(),
  sortBy: z.enum(['year', 'label', 'createdAt']).default('year'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ======================= Dönem Kilidi =======================
export const createPeriodLockSchema = z.object({
  period_id: z.string().uuid(),
  lock_date: dateString,
  reason: z.string().max(500).optional(),
});

export const updatePeriodLockSchema = createPeriodLockSchema.partial();

export const periodLockListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  period_id: z.string().uuid().optional(),
  sortBy: z.enum(['lock_date', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ======================= Yevmiye Fişi =======================
/** GİB e-Defter belge tipleri (Yevmiye Defteri Kılavuzu §2.1.1.10.14). */
export const GIB_DOCUMENT_TYPES = [
  'invoice',
  'check',
  'voucher',
  'receipt',
  'shipment',
  'order-customer',
  'order-vendor',
  'other',
] as const;

/** Yevmiye maddesinin dayandığı belge — başlıkta girilir, satırda ezilebilir (boş = belgesiz). */
const documentFields = {
  document_type: z.enum(GIB_DOCUMENT_TYPES).optional().nullable(),
  document_type_description: z.string().trim().max(120).optional().nullable(),
  document_number: z.string().trim().max(60).optional().nullable(),
  document_date: dateString.optional().nullable(),
  payment_method: z.string().trim().max(40).optional().nullable(),
};

export const journalLineInputSchema = z.object({
  entry_id: z.string().uuid().optional(),
  line_no: z.number().int().positive().optional(),
  account_id: z.string().uuid(),
  description: z.string().max(500).optional(),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
  ...documentFields,
});

/** Satır PATCH'i: varsayılan YOK — verilmeyen alan (ör. debit) 0'a ezilmez. */
export const updateJournalLineSchema = z.object({
  line_no: z.number().int().positive().optional(),
  account_id: z.string().uuid().optional(),
  description: z.string().max(500).optional(),
  debit: z.number().nonnegative().optional(),
  credit: z.number().nonnegative().optional(),
});

export const reverseEntrySchema = z
  .object({
    /** Ters fiş tarihi; verilmezse bugün (açık dönemde olmalı). */
    entry_date: dateString.optional(),
  })
  .optional();

export const createJournalEntrySchema = z.object({
  entry_date: dateString,
  period_id: z.string().uuid().optional().nullable(),
  entry_type: z.enum(ENTRY_TYPES).default('mahsup'),
  description: z.string().min(1),
  status: z.enum(ENTRY_STATUSES).default('draft'),
  source_type: z.string().max(60).optional().nullable(),
  source_id: z.string().uuid().optional().nullable(),
  ...documentFields,
  lines: z.array(journalLineInputSchema).min(1, 'En az bir satır gerekli'),
});

export const updateJournalEntrySchema = createJournalEntrySchema.partial();

export const journalEntryListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().optional(),
  entry_no: z.coerce.number().int().positive().optional(),
  entry_date_from: dateString.optional(),
  entry_date_to: dateString.optional(),
  entry_type: z.enum(ENTRY_TYPES).optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  period_id: z.string().uuid().optional(),
  source_type: z.string().optional(),
  source_id: z.string().uuid().optional(),
  sortBy: z
    .enum(['entry_no', 'entry_date', 'entry_type', 'status', 'createdAt'])
    .default('entry_no'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ======================= Posting Kuralları ve Hesap Eşleme =======================
export const createPostingRuleSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  is_active: z.boolean().default(true),
});

export const updatePostingRuleSchema = createPostingRuleSchema.partial();

export const postingRuleListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().optional(),
  is_active: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  sortBy: z.enum(['code', 'name', 'createdAt']).default('code'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const createAccountMappingSchema = z.object({
  source_type: z.enum(MAPPING_SOURCE_TYPES),
  account_id: z.string().uuid(),
  direction: z.enum(MAPPING_DIRECTIONS).default('debit'),
});

export const updateAccountMappingSchema = createAccountMappingSchema.partial();

export const accountMappingListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  source_type: z.enum(MAPPING_SOURCE_TYPES).optional(),
  direction: z.enum(MAPPING_DIRECTIONS).optional(),
  sortBy: z.enum(['source_type', 'direction', 'createdAt']).default('source_type'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

// ======================= Muhasebe Raporları (Faz 5) =======================
export const reportRangeQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

export const balanceSheetQuerySchema = z.object({
  as_of: dateString.optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;
export type UpdatePeriodInput = z.infer<typeof updatePeriodSchema>;
export type CreatePeriodLockInput = z.infer<typeof createPeriodLockSchema>;
export type UpdatePeriodLockInput = z.infer<typeof updatePeriodLockSchema>;
export type JournalLineInput = z.infer<typeof journalLineInputSchema>;
export type UpdateJournalLineInput = z.infer<typeof updateJournalLineSchema>;
export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>;
export type UpdateJournalEntryInput = z.infer<typeof updateJournalEntrySchema>;
export type CreatePostingRuleInput = z.infer<typeof createPostingRuleSchema>;
export type UpdatePostingRuleInput = z.infer<typeof updatePostingRuleSchema>;
export type CreateAccountMappingInput = z.infer<typeof createAccountMappingSchema>;
export type UpdateAccountMappingInput = z.infer<typeof updateAccountMappingSchema>;
