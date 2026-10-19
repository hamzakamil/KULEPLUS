import { z } from 'zod';

/** Ortak sabitler — ROADMAP Faz 6 (çek/senet durum makinesi). */
export const CHEQUE_TYPES = ['cheque', 'promissory'] as const;
export const CHEQUE_DIRECTIONS = ['incoming', 'outgoing'] as const;
export const CHEQUE_STATUSES = [
  'portfolio',
  'endorsed',
  'collected',
  'bounced',
  'cancelled',
] as const;
/** own = portföyde, bank = tahsile verildi, pledged = teminata verildi (Faz 7-4). */
export const CHEQUE_HOLDERS = ['own', 'bank', 'pledged', 'customer', 'supplier'] as const;
export const CHEQUE_TRANSACTION_TYPES = [
  'created',
  'deposited',
  'pledged',
  'released',
  'endorsed',
  'collected',
  'bounced',
  'cancelled',
  'note',
] as const;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD formatı gerekli');

// ======================= Çek/Senet Kartı =======================
export const createChequeSchema = z
  .object({
    cheque_type: z.enum(CHEQUE_TYPES).default('cheque'),
    direction: z.enum(CHEQUE_DIRECTIONS),
    serial_no: z.string().max(50).optional(),
    cheque_no: z.string().min(1).max(50, 'Çek no zorunlu'),
    bank_name: z.string().max(100).optional(),
    branch: z.string().max(100).optional(),
    account_no: z.string().max(50).optional(),
    drawer_name: z.string().min(1).max(255, 'Keşideci adı zorunlu'),
    endorser_name: z.string().max(255).optional(),
    issue_date: dateString,
    due_date: dateString,
    amount: z.number().positive('Tutar sıfırdan büyük olmalı'),
    currency: z.string().length(3).default('TRY'),
    portfolio_holder: z.enum(CHEQUE_HOLDERS).default('own'),
    contact_id: z.string().uuid().nullish(),
    cash_bank_account_id: z.string().uuid().nullish(),
    description: z.string().max(1000).optional(),
  })
  .refine((v) => v.due_date >= v.issue_date, {
    message: 'Vade tarihi düzenleme tarihinden önce olamaz',
    path: ['due_date'],
  });

export const updateChequeSchema = z
  .object({
    drawer_name: z.string().min(1).max(255).optional(),
    endorser_name: z.string().max(255).optional(),
    bank_name: z.string().max(100).optional(),
    branch: z.string().max(100).optional(),
    account_no: z.string().max(50).optional(),
    due_date: dateString.optional(),
    description: z.string().max(1000).optional(),
    contact_id: z.string().uuid().nullish(),
    cash_bank_account_id: z.string().uuid().nullish(),
  })
  .partial();

export const chequeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  q: z.string().optional(),
  cheque_type: z.enum(CHEQUE_TYPES).optional(),
  direction: z.enum(CHEQUE_DIRECTIONS).optional(),
  status: z.enum(CHEQUE_STATUSES).optional(),
  portfolio_holder: z.enum(CHEQUE_HOLDERS).optional(),
  contact_id: z.string().uuid().optional(),
  due_from: dateString.optional(),
  due_to: dateString.optional(),
  sortBy: z.enum(['due_date', 'amount', 'createdAt', 'cheque_no']).default('due_date'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const endorseChequeSchema = z.object({
  to_holder: z.enum(CHEQUE_HOLDERS),
  party_name: z.string().min(1).max(255, 'Ciro edilen taraf zorunlu'),
  transaction_date: dateString,
  description: z.string().max(1000).optional(),
});

export const collectChequeSchema = z.object({
  cash_bank_account_id: z.string().uuid('Tahsilat hesabı zorunlu'),
  transaction_date: dateString,
  amount: z.number().positive().optional(),
  description: z.string().max(1000).optional(),
});

/** Tahsile verme: portföydeki alınan çek/senet bankaya tahsile verilir (Faz 7-4). */
export const depositChequeSchema = z.object({
  cash_bank_account_id: z.string().uuid('Tahsile verilen banka hesabı zorunlu'),
  transaction_date: dateString,
  description: z.string().max(1000).optional(),
});

/** Teminata verme: portföydeki alınan çek/senet teminat olarak verilir. */
export const pledgeChequeSchema = z.object({
  party_name: z.string().min(1).max(255, 'Teminat verilen taraf zorunlu'),
  transaction_date: dateString,
  description: z.string().max(1000).optional(),
});

/** Teminattan / tahsilden geri alma: çek/senet portföye geri döner. */
export const releaseChequeSchema = z.object({
  transaction_date: dateString,
  description: z.string().max(1000).optional(),
});

export const bounceChequeSchema = z.object({
  transaction_date: dateString,
  reason: z.string().min(1).max(500, 'Karşılıksız nedeni zorunlu'),
});

export const cancelChequeSchema = z.object({
  reason: z.string().min(1).max(500, 'İptal nedeni zorunlu'),
});

export const portfolioListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  holder: z.enum(CHEQUE_HOLDERS).optional(),
  active_only: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
});

export const transactionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  transaction_type: z.enum(CHEQUE_TRANSACTION_TYPES).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});

export type CreateChequeInput = z.infer<typeof createChequeSchema>;
export type UpdateChequeInput = z.infer<typeof updateChequeSchema>;
export type ChequeListQuery = z.infer<typeof chequeListQuerySchema>;
export type EndorseChequeInput = z.infer<typeof endorseChequeSchema>;
export type CollectChequeInput = z.infer<typeof collectChequeSchema>;
export type DepositChequeInput = z.infer<typeof depositChequeSchema>;
export type PledgeChequeInput = z.infer<typeof pledgeChequeSchema>;
export type ReleaseChequeInput = z.infer<typeof releaseChequeSchema>;
export type BounceChequeInput = z.infer<typeof bounceChequeSchema>;
export type CancelChequeInput = z.infer<typeof cancelChequeSchema>;
export type PortfolioListQuery = z.infer<typeof portfolioListQuerySchema>;
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;
