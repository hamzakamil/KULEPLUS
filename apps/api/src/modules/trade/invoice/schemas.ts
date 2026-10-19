import { z } from 'zod';

export const createInvoiceSchema = z.object({
  type: z.enum(['sales', 'purchase', 'proforma', 'credit_note', 'debit_note']).default('sales'),
  contact_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  issue_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  currency: z.string().length(3).default('TRY'),
  // Kur isteğe bağlıdır: verilmezse fatura servisi tarih bazlı kuru çözer (SPEC §9.2).
  exchange_rate: z.number().positive().optional(),
  // Kurun referans alındığı tarih (varsayılan: issue_date; TRY'de yok sayılır).
  rate_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: z.string().optional(),
  reference_type: z.string().optional(),
  reference_id: z.string().uuid().optional(),
  /** Alış faturası: tedarikçinin belge numarası (mükerrer kontrolü; muhasebe aktifken zorunlu). */
  supplier_document_no: z.string().trim().max(100).optional(),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid().optional(),
        description: z.string().min(1),
        quantity: z.number().positive().default(1),
        unit_id: z.string().uuid().optional(),
        unit_price: z.number().default(0),
        discount_percent: z.number().min(0).max(100).default(0),
        tax_rate_id: z.string().uuid().optional(),
        /** Alışta gider satırı: gider kategorisi (ürün yerine). Satır ya ürün ya kategori taşır. */
        expense_category_id: z.string().uuid().optional(),
        /** KDV tevkifatı türü (oran ve e-Fatura/KDV-2 kodları türden gelir). */
        withholding_type_id: z.string().uuid().optional(),
      }),
    )
    .min(1),
});

/**
 * Tek ekrandan fatura (Faz 8): kaydet → (isteğe bağlı) kesinleştir → (isteğe bağlı) peşin
 * ödeme/tahsilat. Hepsi TEK transaction'da çalışır; bir adım hata verirse hiçbiri kalıcı olmaz.
 *  - finalize: true → fatura kesinleştirilir (muhasebe aktifse yevmiye fişi),
 *  - payment: verilirse kesinleştirme de yapılır; `amount` boşsa faturanın ödenecek tutarı.
 */
export const quickInvoiceSchema = createInvoiceSchema.extend({
  finalize: z.boolean().default(false),
  payment: z
    .object({
      amount: z.number().positive().optional(),
      payment_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      payment_method: z.enum(['cash', 'bank_transfer', 'check', 'credit_card', 'other']),
      cash_bank_account_id: z.string().uuid().optional(),
      credit_card_id: z.string().uuid().optional(),
      reference: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
});
export type QuickInvoiceInput = z.infer<typeof quickInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  type: z.enum(['sales', 'purchase', 'proforma', 'credit_note', 'debit_note']).optional(),
  contact_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  issue_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  currency: z.string().length(3).optional(),
  exchange_rate: z.number().positive().optional(),
  rate_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z.enum(['draft', 'sent', 'paid', 'partial', 'cancelled', 'overdue']).optional(),
  notes: z.string().optional(),
  supplier_document_no: z.string().trim().max(100).optional(),
  reference_type: z.string().optional(),
  reference_id: z.string().uuid().optional(),
});

export const invoiceLineSchema = z.object({
  id: z.string().uuid().optional(),
  product_id: z.string().uuid().nullable().optional(),
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit_id: z.string().uuid().nullable().optional(),
  unit_price: z.number().default(0),
  discount_percent: z.number().min(0).max(100).default(0),
  tax_rate_id: z.string().uuid().nullable().optional(),
  /** Alışta gider satırı: gider kategorisi (ürün yerine). */
  expense_category_id: z.string().uuid().nullable().optional(),
  /** KDV tevkifatı türü (oran ve e-Fatura/KDV-2 kodları türden gelir). */
  withholding_type_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().default(0),
});

export const replaceInvoiceLinesSchema = z.object({
  lines: z.array(invoiceLineSchema).min(1),
});

export const paymentSchema = z.object({
  amount: z.number().positive(),
  payment_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  payment_method: z.enum(['cash', 'bank_transfer', 'check', 'credit_card', 'other']),
  /** Ödemenin geçtiği kasa/banka kartı (verilirse fiş o kartın 100.xx/102.xx alt hesabına). */
  cash_bank_account_id: z.string().uuid().optional(),
  /** Alışta şirket kredi kartıyla ödeme (verilirse fiş 309.xx alt hesabına). */
  credit_card_id: z.string().uuid().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z
    .enum(['number', 'issue_date', 'due_date', 'total', 'created_at', 'contact_id'])
    .default('issue_date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  type: z.enum(['sales', 'purchase', 'proforma', 'credit_note', 'debit_note']).optional(),
  status: z.enum(['draft', 'sent', 'paid', 'partial', 'cancelled', 'overdue']).optional(),
  contact_id: z.string().uuid().optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  q: z.string().optional(),
});

/** Tevkifat türü (yönetim ekranı). Oran yalnızca mevzuattaki paylar: 2,3,4,5,7,9,10 (/10). */
export const withholdingTypeSchema = z.object({
  name: z.string().min(1),
  einvoice_code: z.string().regex(/^\d{3}$/, 'e-Fatura tevkifat kodu 3 haneli olmalı'),
  kdv2_code: z.string().regex(/^\d{3}$/, 'KDV-2 kodu 3 haneli olmalı'),
  rate_numerator: z
    .number()
    .int()
    .refine(
      (n) => [2, 3, 4, 5, 7, 9, 10].includes(n),
      'Tevkifat oranı 2, 3, 4, 5, 7, 9 veya 10 (/10) olmalı',
    ),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  valid_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  is_active: z.boolean().default(true),
});
export const updateWithholdingTypeSchema = withholdingTypeSchema.partial();
export type WithholdingTypeInput = z.infer<typeof withholdingTypeSchema>;

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;
export type ReplaceInvoiceLinesInput = z.infer<typeof replaceInvoiceLinesSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
