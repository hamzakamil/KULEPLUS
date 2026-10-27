import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { newId } from '@kuleplus/shared';
import { z } from 'zod';
import {
  allocateEntryNo,
  isAccountingActive,
  openPeriodFor,
  round2,
  toKurus,
  toIsoDate,
  todayIso,
} from '../accounting/ledger.js';
import { ensureChartOfAccountsOn } from '../accounting/chart.js';
import {
  cashBankLedgerAccount,
  creditCardLedgerAccount,
  expenseCategoryLedgerAccount,
} from '../accounting/subledger.js';
import { accountingService } from '../accounting/service.js';
import { assertNoDuplicateDocument } from '../trade/duplicate-document.js';

/** Gider kategorisi grup anahtarları — web tarafındaki EXPENSE_GROUPS ile eşleşir. */
export const EXPENSE_CATEGORY_GROUPS = [
  'kira',
  'kamu-hizmetleri',
  'isletme',
  'personel',
  'mevzuat',
  'finansal',
] as const;

export const createExpenseCategorySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Görsel gruplama anahtarı (boş bırakılabilir → grupsuz). */
  grup: z.enum(EXPENSE_CATEGORY_GROUPS).nullish(),
  /** Öne çıkan (hızlı girişte kutucuk olarak gösterilir). */
  is_favorite: z.boolean().default(false),
  status: z.enum(['active', 'inactive']).default('active'),
  /**
   * Kategorinin muhasebe hesabı (Faz 7-2). Boşsa ilk fişte 770 altında alt hesap açılır;
   * kullanıcı 760.xx / 740.xx gibi başka bir 6xx/7xx detay hesabına bağlayabilir.
   */
  account_id: z.string().uuid().nullish(),
});

export const updateExpenseCategorySchema = createExpenseCategorySchema.partial();

/** Gider belgesinin türü — e-Defter belge tipine eşlenir (fatura yerine geçen belgeler "other"). */
export const EXPENSE_DOCUMENT_KINDS = [
  'invoice',
  'e_invoice',
  'e_archive',
  'smm',
  'e_smm',
  'expense_voucher',
  'producer_receipt',
  'retail_receipt',
  'ticket',
  'bank_receipt',
  'other',
] as const;

export const createExpenseSchema = z.object({
  invoice_number: z.string().optional(),
  document_kind: z.enum(EXPENSE_DOCUMENT_KINDS).optional(),
  /** "Diğer" türde belgenin adı (ör. Kira Sözleşmesi). */
  document_kind_description: z.string().trim().max(120).optional(),
  invoice_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  expense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  category_id: z.string().uuid(),
  contact_id: z.string().uuid().optional(),
  description: z.string().min(1),
  /** KDV dahil toplam. `net_amount` verilirse sunucu matrah + KDV'den hesaplar. */
  amount: z.number().nonnegative().optional(),
  /** Matrah (KDV hariç) — Faz 7-5. */
  net_amount: z.number().nonnegative().optional(),
  /** KDV oranı (%): 0, 1, 10, 20 … */
  tax_rate: z.number().min(0).max(100).optional(),
  /** Carisiz (peşin) gider: satıcı unvanı + isteğe bağlı VKN/TCKN — kesinleşmede zorunlu. */
  counterparty_name: z.string().trim().max(255).optional(),
  counterparty_tax_number: z.string().trim().max(20).optional(),
  /** Carisiz (peşin) gider: ödemenin yapıldığı kasa/banka kartı veya şirket kredi kartı. */
  payment_source_type: z.enum(['cash_bank', 'credit_card']).optional(),
  payment_source_id: z.string().uuid().optional(),
  currency: z.string().length(3).default('TRY'),
  exchange_rate: z.number().positive().default(1),
  payment_status: z.enum(['unpaid', 'partial', 'paid']).default('unpaid'),
  status: z.enum(['draft', 'posted', 'cancelled']).default('draft'),
  notes: z.string().optional(),
  receipt_file_url: z.string().url().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

/** Matrah/KDV/toplam: `net_amount` öncelikli; yalnız `amount` verilirse KDV dahil sayılır. */
function computeExpenseAmounts(input: {
  amount?: number;
  net_amount?: number;
  tax_rate?: number;
}): { net: number; taxRate: number; tax: number; gross: number } {
  const taxRate = Number(input.tax_rate ?? 0);
  if (input.net_amount !== undefined) {
    const net = round2(input.net_amount);
    const tax = round2((net * taxRate) / 100);
    return { net, taxRate, tax, gross: (toKurus(net) + toKurus(tax)) / 100 };
  }
  const gross = round2(input.amount ?? 0);
  const net = round2(gross / (1 + taxRate / 100));
  return { net, taxRate, tax: (toKurus(gross) - toKurus(net)) / 100, gross };
}

export const expenseListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  category_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'posted', 'cancelled']).optional(),
  payment_status: z.enum(['unpaid', 'partial', 'paid']).optional(),
  invoice_number: z.string().optional(),
  /** Serbest metin arama: açıklama, fatura no veya kategori adı. */
  q: z.string().optional(),
  expense_date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  expense_date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sortBy: z
    .enum(['date', 'invoice_number', 'expense_date', 'amount', 'status', 'createdAt'])
    .default('expense_date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const expensePaymentSchema = z.object({
  amount: z.number().positive(),
  /** Ödemenin çıktığı kasa/banka kartı (fiş bu kartın 100.xx/102.xx alt hesabına). */
  cash_bank_account_id: z.string().uuid(),
  payment_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  payment_method: z
    .enum(['cash', 'bank_transfer', 'check', 'credit_card', 'other'])
    .default('bank_transfer'),
  currency: z.string().length(3).default('TRY'),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
export type ExpensePaymentInput = z.infer<typeof expensePaymentSchema>;

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive';
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Expense {
  id: string;
  invoice_number?: string;
  invoice_date?: string;
  expense_date: Date;
  category_id: string;
  contact_id?: string;
  description: string;
  amount: number;
  currency: string;
  exchange_rate: number;
  base_amount: number;
  payment_status: 'unpaid' | 'partial' | 'paid';
  status: 'draft' | 'posted' | 'cancelled';
  notes?: string;
  receipt_file_url?: string;
  category?: ExpenseCategory;
  contact_name?: string;
  createdBy?: string;
  updatedBy?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class ExpenseService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;

  constructor(pool?: Pool) {
    this.providedPool = pool ?? null;
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  async listExpenses(query: ExpenseListQuery) {
    const pool = this.getPoolInstance();
    const {
      page,
      limit,
      category_id,
      status,
      payment_status,
      invoice_number,
      q,
      expense_date_from,
      expense_date_to,
      sortBy,
      sortOrder,
    } = query;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['t.tenant_id = current_tenant_id()'];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (category_id) {
      conditions.push(`t.category_id = $${paramIdx}`);
      values.push(category_id);
      paramIdx++;
    }
    if (status) {
      conditions.push(`t.status = $${paramIdx}`);
      values.push(status);
      paramIdx++;
    }
    if (payment_status) {
      conditions.push(`t.payment_status = $${paramIdx}`);
      values.push(payment_status);
      paramIdx++;
    }
    if (invoice_number) {
      conditions.push(`t.invoice_number ILIKE $${paramIdx}`);
      values.push(`%${invoice_number}%`);
      paramIdx++;
    }
    if (q) {
      conditions.push(
        `(t.description ILIKE $${paramIdx} OR t.invoice_number ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`,
      );
      values.push(`%${q}%`);
      paramIdx++;
    }
    if (expense_date_from) {
      conditions.push(`t.expense_date >= $${paramIdx}`);
      values.push(expense_date_from);
      paramIdx++;
    }
    if (expense_date_to) {
      conditions.push(`t.expense_date <= $${paramIdx}`);
      values.push(expense_date_to);
      paramIdx++;
    }

    const col =
      {
        date: 't.expense_date',
        invoice_number: 't.invoice_number',
        expense_date: 't.expense_date',
        amount: 't.amount',
        status: 't.status',
        createdAt: 't.created_at',
      }[sortBy] || 't.expense_date';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [expensesResult, countResult] = await Promise.all([
      pool.query(
        `SELECT t.*,
         c.code as category_code, c.name as category_name,
         co.name as contact_name
         FROM expenses t
         LEFT JOIN expense_categories c ON c.id = t.category_id AND c.tenant_id = t.tenant_id
         LEFT JOIN contacts co ON co.id = t.contact_id AND co.tenant_id = t.tenant_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${col} ${order}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...values, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM expenses t
         LEFT JOIN expense_categories c ON c.id = t.category_id AND c.tenant_id = t.tenant_id
         WHERE ${conditions.join(' AND ')}`,
        values,
      ),
    ]);

    return {
      items: expensesResult.rows.map((r: Record<string, unknown>) => ({
        ...r,
        amount: Number(r.amount),
        base_amount: Number(r.base_amount),
        exchange_rate: Number(r.exchange_rate),
        payment_status: r.payment_status as 'unpaid' | 'partial' | 'paid',
        status: r.status as 'draft' | 'posted' | 'cancelled',
        createdAt: new Date(r.created_at as string | Date),
        updatedAt: new Date(r.updated_at as string | Date),
      })),
      page,
      limit,
      total: Number(countResult.rows[0].total),
      totalPages: Math.ceil(Number(countResult.rows[0].total) / limit),
    };
  }

  async getExpenseById(id: string) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT t.*,
         c.code as category_code, c.name as category_name,
         co.name as contact_name
         FROM expenses t
         LEFT JOIN expense_categories c ON c.id = t.category_id AND c.tenant_id = t.tenant_id
         LEFT JOIN contacts co ON co.id = t.contact_id AND co.tenant_id = t.tenant_id
         WHERE t.id = $1 AND t.tenant_id = current_tenant_id()`,
      [id],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      amount: Number(row.amount),
      base_amount: Number(row.base_amount),
      exchange_rate: Number(row.exchange_rate),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Denetim kaydı — yazma işlemiyle AYNI transaction'da (ADR-0016, SPEC §27.3).
   * tenant_id sunucu tarafında `current_tenant_id()` ile bağlanır (body'den gelmez);
   * GUC tanımsızsa (bağımsız test çağrısı) NULL yazılır (kolon nullable).
   */
  private async writeAudit(
    client: PoolClient,
    entry: {
      userId?: string;
      action: string;
      entityId: string;
      oldValues?: Record<string, unknown> | null;
      newValues?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
       VALUES ($1, current_tenant_id(), $2, $3, 'expenses', $4, $5, $6, now())`,
      [
        newId(),
        entry.userId ?? null,
        `expenses.${entry.action}`,
        entry.entityId,
        entry.oldValues ? JSON.stringify(entry.oldValues) : null,
        entry.newValues ? JSON.stringify(entry.newValues) : null,
      ],
    );
  }

  /** Bugünün tarihi (Europe/Istanbul) — `expense_date` NOT NULL için fallback (SPEC T-7.3). */
  private todayIso(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  }

  async createExpense(input: CreateExpenseInput, userId: string) {
    if (input.amount === undefined && input.net_amount === undefined) {
      throw new AppError('VALIDATION_ERROR', 'Tutar (amount) veya matrah (net_amount) zorunludur.');
    }
    const pool = this.getPoolInstance();
    const expenseId = newId();
    const amounts = computeExpenseAmounts(input);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO expenses (id, tenant_id, invoice_number, invoice_date, expense_date, category_id, contact_id, description,
                               amount, net_amount, tax_rate, tax_amount, counterparty_name, counterparty_tax_number,
                               payment_source_type, payment_source_id, currency, exchange_rate, payment_status, status,
                               notes, receipt_file_url, created_by, updated_by, version, created_at, updated_at,
                               document_kind, document_kind_description)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                 'draft', $19, $20, $21, $21, 1, now(), now(), $22, $23)`,
        [
          expenseId,
          input.invoice_number || null,
          input.invoice_date ?? null,
          // `expense_date` DB'de NOT NULL; API'de optional → verilmezse bugünün tarihi (Europe/Istanbul).
          input.expense_date ?? this.todayIso(),
          input.category_id,
          input.contact_id ?? null,
          input.description,
          amounts.gross,
          amounts.net,
          amounts.taxRate,
          amounts.tax,
          input.counterparty_name || null,
          input.counterparty_tax_number || null,
          input.payment_source_type ?? null,
          input.payment_source_id ?? null,
          input.currency,
          input.exchange_rate,
          input.payment_status,
          input.notes ?? null,
          input.receipt_file_url ?? null,
          userId,
          input.document_kind ?? 'invoice',
          input.document_kind_description || null,
        ],
      );

      await this.writeAudit(client, {
        userId,
        action: 'create',
        entityId: expenseId,
        newValues: {
          invoice_number: input.invoice_number,
          amount: amounts.gross,
          net_amount: amounts.net,
          tax_amount: amounts.tax,
          status: input.status,
        },
      });

      if (input.status === 'posted') await this.postExpenseOn(client, expenseId, userId);
      if (input.status === 'cancelled') {
        await client.query(
          `UPDATE expenses SET status = 'cancelled' WHERE id = $1 AND tenant_id = current_tenant_id()`,
          [expenseId],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getExpenseById(expenseId);
  }

  /**
   * Gider güncelleme. Kesinleşmiş (posted) gider değişmez (SPEC §10.1): yalnızca not
   * güncellenir veya iptal edilir (fiş ters kayıtla düzeltilir). Taslakta `status: 'posted'`
   * kesinleştirir (fiş + mükerrer kontrolü).
   */
  async updateExpense(id: string, input: UpdateExpenseInput, userId: string) {
    const pool = this.getPoolInstance();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT * FROM expenses WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE`,
        [id],
      );
      const cur = found.rows[0];
      if (!cur) throw new AppError('NOT_FOUND', 'Gider bulunamadı');
      if (cur.status === 'cancelled') {
        throw new AppError('FORBIDDEN', 'İptal edilmiş gider değiştirilemez.');
      }
      if (cur.status === 'posted') {
        // Kesinleşmiş giderde tutar/hesap değişmez; belge bilgisi (e-Defter) ve not düzeltilebilir.
        const documentFields = [
          'invoice_number',
          'invoice_date',
          'document_kind',
          'document_kind_description',
        ];
        const changed = Object.entries(input).filter(
          ([k, v]) => v !== undefined && !['notes', 'status', ...documentFields].includes(k),
        );
        if (changed.length > 0 || (input.status !== undefined && input.status !== 'cancelled')) {
          throw new AppError(
            'FORBIDDEN',
            'Kesinleşmiş gider değiştirilemez; yalnızca not ve belge bilgisi güncellenir veya gider iptal edilir.',
          );
        }
        if (
          input.notes !== undefined ||
          documentFields.some((k) => input[k as keyof typeof input] !== undefined)
        ) {
          await client.query(
            `UPDATE expenses SET notes = COALESCE($1, notes),
                    invoice_number = COALESCE($4, invoice_number), invoice_date = COALESCE($5, invoice_date),
                    document_kind = COALESCE($6, document_kind),
                    document_kind_description = COALESCE($7, document_kind_description),
                    updated_by = $2, updated_at = now()
              WHERE id = $3 AND tenant_id = current_tenant_id()`,
            [
              input.notes ?? null,
              userId,
              id,
              input.invoice_number || null,
              input.invoice_date ?? null,
              input.document_kind ?? null,
              input.document_kind_description || null,
            ],
          );
        }
        if (input.status === 'cancelled') await this.cancelExpenseOn(client, cur, userId);
      } else {
        const amountsChanged =
          input.amount !== undefined ||
          input.net_amount !== undefined ||
          input.tax_rate !== undefined;
        const amounts = amountsChanged
          ? computeExpenseAmounts({
              amount: input.amount,
              net_amount:
                input.net_amount ??
                (input.amount === undefined ? Number(cur.net_amount ?? cur.amount) : undefined),
              tax_rate: input.tax_rate ?? Number(cur.tax_rate ?? 0),
            })
          : null;
        await client.query(
          `UPDATE expenses
           SET invoice_number = COALESCE($1, invoice_number),
               invoice_date = COALESCE($2, invoice_date),
               expense_date = COALESCE($3, expense_date),
               category_id = COALESCE($4, category_id),
               contact_id = COALESCE($5, contact_id),
               description = COALESCE($6, description),
               amount = COALESCE($7, amount),
               net_amount = COALESCE($8, net_amount),
               tax_rate = COALESCE($9, tax_rate),
               tax_amount = COALESCE($10, tax_amount),
               counterparty_name = COALESCE($11, counterparty_name),
               counterparty_tax_number = COALESCE($12, counterparty_tax_number),
               payment_source_type = COALESCE($13, payment_source_type),
               payment_source_id = COALESCE($14, payment_source_id),
               currency = COALESCE($15, currency),
               exchange_rate = COALESCE($16, exchange_rate),
               payment_status = COALESCE($17, payment_status),
               notes = COALESCE($18, notes),
               receipt_file_url = COALESCE($19, receipt_file_url),
               document_kind = COALESCE($22, document_kind),
               document_kind_description = COALESCE($23, document_kind_description),
               updated_by = $20, updated_at = now()
           WHERE id = $21 AND tenant_id = current_tenant_id()`,
          [
            input.invoice_number ?? null,
            input.invoice_date ?? null,
            input.expense_date ?? null,
            input.category_id ?? null,
            input.contact_id ?? null,
            input.description ?? null,
            amounts?.gross ?? null,
            amounts?.net ?? null,
            amounts?.taxRate ?? null,
            amounts?.tax ?? null,
            input.counterparty_name ?? null,
            input.counterparty_tax_number ?? null,
            input.payment_source_type ?? null,
            input.payment_source_id ?? null,
            input.currency ?? null,
            input.exchange_rate ?? null,
            input.payment_status ?? null,
            input.notes ?? null,
            input.receipt_file_url ?? null,
            userId,
            id,
            input.document_kind ?? null,
            input.document_kind_description || null,
          ],
        );
        if (input.status === 'posted') await this.postExpenseOn(client, id, userId);
        if (input.status === 'cancelled') await this.cancelExpenseOn(client, cur, userId);
      }

      await this.writeAudit(client, {
        userId,
        action: 'update',
        entityId: id,
        oldValues: { amount: cur.amount, status: cur.status },
        newValues: {
          amount: input.amount,
          net_amount: input.net_amount,
          status: input.status,
          payment_status: input.payment_status,
        },
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getExpenseById(id);
  }

  /** Silme = iptal (finansal kayıt fiziksel silinmez); kesinleşmişse fiş ters kayıtla düzeltilir. */
  async deleteExpense(id: string, userId: string) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT * FROM expenses WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE`,
        [id],
      );
      const cur = found.rows[0];
      if (!cur) throw new AppError('NOT_FOUND', 'Gider bulunamadı');
      if (cur.status !== 'cancelled') await this.cancelExpenseOn(client, cur, userId);
      await this.writeAudit(client, {
        userId,
        action: 'delete',
        entityId: id,
        oldValues: { amount: cur.amount, status: cur.status },
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { success: true };
  }

  /**
   * Gideri kesinleştirir (Faz 7-5):
   *  - carisiz gider peşindir: belge no + satıcı unvanı + ödeme kaynağı (kasa/banka/kredi kartı) zorunlu,
   *  - mükerrer belge engeli (aynı cari/VKN + aynı belge no — gider veya alış faturası),
   *  - muhasebe aktifse fiş: 7xx (kategori hesabı, matrah) + 191 (KDV) B /
   *    320 (cari) veya 100.xx/102.xx/309.xx (peşin) A.
   */
  private async postExpenseOn(client: PoolClient, id: string, userId: string): Promise<void> {
    const r = await client.query(
      `SELECT e.*, ec.name AS category_name, co.name AS contact_name
         FROM expenses e
         LEFT JOIN expense_categories ec ON ec.id = e.category_id
         LEFT JOIN contacts co ON co.id = e.contact_id
        WHERE e.id = $1 AND e.tenant_id = current_tenant_id()`,
      [id],
    );
    const e = r.rows[0];
    if (!e) throw new AppError('NOT_FOUND', 'Gider bulunamadı');
    if (e.status !== 'draft')
      throw new AppError('FORBIDDEN', 'Yalnızca taslak gider kesinleştirilebilir.');
    if (!e.category_id) throw new AppError('VALIDATION_ERROR', 'Gider kategorisi zorunludur.');

    const cash = !e.contact_id;
    if (cash) {
      const missing: string[] = [];
      if (!String(e.invoice_number ?? '').trim()) missing.push('belge no');
      if (!String(e.counterparty_name ?? '').trim()) missing.push('satıcı unvanı');
      if (!e.payment_source_type || !e.payment_source_id) {
        missing.push('ödeme kaynağı (kasa/banka/kredi kartı)');
      }
      if (missing.length > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Cari seçilmeyen gider peşin sayılır; zorunlu alanlar: ${missing.join(', ')}.`,
        );
      }
    }
    await assertNoDuplicateDocument(client, {
      documentNo: e.invoice_number,
      contactId: e.contact_id,
      taxNumber: e.counterparty_tax_number,
      excludeExpenseId: id,
    });

    let journalEntryId: string | null = null;
    if (await isAccountingActive(client)) {
      await ensureChartOfAccountsOn(client);
      const rate = Number(e.exchange_rate) || 1;
      const total = round2(Number(e.amount) * rate);
      const vat = round2(Number(e.tax_amount ?? 0) * rate);
      const net = (toKurus(total) - toKurus(vat)) / 100;
      const expenseAccount = await expenseCategoryLedgerAccount(client, String(e.category_id));
      const vatAccount = await this.accountByCode(client, '191');
      let creditAccount: string | null;
      if (cash) {
        creditAccount =
          e.payment_source_type === 'credit_card'
            ? await creditCardLedgerAccount(client, String(e.payment_source_id))
            : await cashBankLedgerAccount(client, String(e.payment_source_id));
        if (!creditAccount)
          throw new AppError('NOT_FOUND', 'Ödeme kaynağı (kasa/banka/kart) bulunamadı.');
      } else {
        creditAccount = await this.accountByCode(client, '320');
      }
      if (!expenseAccount || !creditAccount) {
        throw new AppError('VALIDATION_ERROR', 'Muhasebe hesabı çözülemedi (gider/cari hesabı).');
      }
      const party = cash ? String(e.counterparty_name) : String(e.contact_name ?? '');
      const description = [e.invoice_number, party, e.description].filter(Boolean).join(' – ');
      const entryDate = toIsoDate(e.expense_date);
      const lines = [
        { accountId: expenseAccount, debit: net, credit: 0 },
        ...(vat > 0 && vatAccount ? [{ accountId: vatAccount, debit: vat, credit: 0 }] : []),
        { accountId: creditAccount, debit: 0, credit: total },
      ];
      journalEntryId = await this.writeJournal(client, {
        entryDate,
        description,
        sourceType: 'expense',
        sourceId: id,
        entryType: cash ? 'tediye' : 'mahsup',
        lines,
        userId,
      });
    }

    await client.query(
      `UPDATE expenses SET status = 'posted', posted_at = now(),
              payment_status = CASE WHEN contact_id IS NULL THEN 'paid' ELSE payment_status END,
              updated_by = $2, updated_at = now()
        WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id, userId],
    );
    await this.writeAudit(client, {
      userId,
      action: 'post',
      entityId: id,
      newValues: { status: 'posted', journal_entry_id: journalEntryId },
    });
  }

  /** Gideri iptal eder; kesinleşmişse fişi ters kayıtla düzeltir. Ödemesi olan carili gider iptal edilemez. */
  private async cancelExpenseOn(
    client: PoolClient,
    cur: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    if (cur.status === 'posted') {
      const paid = await client.query(
        `SELECT 1 FROM expense_payments WHERE expense_id = $1 AND tenant_id = current_tenant_id() LIMIT 1`,
        [cur.id],
      );
      if ((paid.rowCount ?? 0) > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Ödemesi olan gider iptal edilemez; önce ödeme kayıtlarını düzeltin.',
        );
      }
      const entries = await client.query(
        `SELECT je.id FROM journal_entries je
          WHERE je.tenant_id = current_tenant_id() AND je.source_type = 'expense' AND je.source_id = $1
            AND je.status = 'posted' AND je.entry_type <> 'ters'
            AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = je.id)`,
        [cur.id],
      );
      for (const row of entries.rows) {
        await accountingService.reverseEntryOn(client, String(row.id), userId, undefined, {
          allowSource: true,
        });
      }
    }
    await client.query(
      `UPDATE expenses SET status = 'cancelled', updated_by = $2, updated_at = now()
        WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [cur.id, userId],
    );
  }

  /** Carili giderin ödemesi: 320 B / kasa-banka (kartın alt hesabı) A + ödeme durumu. */
  async createPayment(expenseId: string, input: ExpensePaymentInput, userId: string) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    const paymentId = newId();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT * FROM expenses WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE`,
        [expenseId],
      );
      const e = found.rows[0];
      if (!e) throw new AppError('NOT_FOUND', 'Gider bulunamadı');
      if (e.status === 'cancelled')
        throw new AppError('VALIDATION_ERROR', 'İptal edilmiş gidere ödeme girilemez.');
      if (!e.contact_id) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Carisiz gider peşin ödenmiş sayılır; ayrıca ödeme girilmez.',
        );
      }
      const accountingActive = await isAccountingActive(client);
      if (accountingActive && e.status !== 'posted') {
        throw new AppError(
          'VALIDATION_ERROR',
          'Muhasebe aktifken ödeme yalnızca kesinleşmiş gidere girilebilir.',
        );
      }
      const paidSoFar = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM expense_payments
          WHERE expense_id = $1 AND tenant_id = current_tenant_id()`,
        [expenseId],
      );
      const remainingK = toKurus(e.amount) - toKurus(paidSoFar.rows[0].total);
      if (toKurus(input.amount) > remainingK) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Ödeme tutarı kalan borcu (${remainingK / 100}) aşamaz.`,
        );
      }
      const account = await client.query(
        `SELECT 1 FROM cash_bank_accounts WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [input.cash_bank_account_id],
      );
      if ((account.rowCount ?? 0) === 0)
        throw new AppError('NOT_FOUND', 'Kasa/banka hesabı bulunamadı');
      const paymentDate = input.payment_date ?? todayIso();

      await client.query(
        `INSERT INTO expense_payments (id, tenant_id, expense_id, account_id, movement_type, amount, currency,
                                       transaction_date, payment_date, reference, description,
                                       balance_before, balance_after, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, 'withdrawal', $4, $5, $6, $6, $7, $8, 0, 0, $9, $9)`,
        [
          paymentId,
          expenseId,
          input.cash_bank_account_id,
          input.amount,
          input.currency,
          paymentDate,
          input.reference || null,
          input.notes || null,
          userId,
        ],
      );

      if (accountingActive) {
        const rate = Number(e.exchange_rate) || 1;
        const amount = round2(input.amount * rate);
        const payable = await this.accountByCode(client, '320');
        const cash = await cashBankLedgerAccount(client, input.cash_bank_account_id);
        if (!payable || !cash)
          throw new AppError('VALIDATION_ERROR', 'Muhasebe hesabı çözülemedi (320/kasa-banka).');
        await this.writeJournal(client, {
          entryDate: paymentDate,
          description: `Gider ödemesi ${[e.invoice_number, e.description].filter(Boolean).join(' – ')}`,
          sourceType: 'expense_payment',
          sourceId: paymentId,
          entryType: 'tediye',
          lines: [
            { accountId: payable, debit: amount, credit: 0 },
            { accountId: cash, debit: 0, credit: amount },
          ],
          userId,
        });
      }

      const left = remainingK - toKurus(input.amount);
      await client.query(
        `UPDATE expenses SET payment_status = $2, updated_by = $3, updated_at = now()
          WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [expenseId, left <= 0 ? 'paid' : 'partial', userId],
      );
      await this.writeAudit(client, {
        userId,
        action: 'payment',
        entityId: expenseId,
        newValues: { payment_id: paymentId, amount: input.amount },
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getExpenseById(expenseId);
  }

  private async accountByCode(client: PoolClient, code: string): Promise<string | null> {
    const r = await client.query(
      'SELECT id FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1 LIMIT 1',
      [code],
    );
    return r.rows[0]?.id ?? null;
  }

  /** Onaylı fiş yazar (dönem kapısı + gap-free numara; denge DB'de de zorlanır). */
  private async writeJournal(
    client: PoolClient,
    input: {
      entryDate: string;
      description: string;
      sourceType: string;
      sourceId: string;
      entryType: 'mahsup' | 'tediye';
      lines: Array<{ accountId: string; debit: number; credit: number }>;
      userId: string;
    },
  ): Promise<string> {
    const periodId = await openPeriodFor(client, input.entryDate);
    const entryNo = await allocateEntryNo(client, periodId);
    const entryId = newId();
    const debit = input.lines.reduce((sum, l) => sum + toKurus(l.debit), 0) / 100;
    const credit = input.lines.reduce((sum, l) => sum + toKurus(l.credit), 0) / 100;
    await client.query(
      `INSERT INTO journal_entries
         (id, tenant_id, entry_no, entry_date, period_id, entry_type, status, description,
          source_type, source_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, 'posted', $6, $7, $8, $9, $10, $11, now(), $11, $11)`,
      [
        entryId,
        entryNo,
        input.entryDate,
        periodId,
        input.entryType,
        input.description,
        input.sourceType,
        input.sourceId,
        debit,
        credit,
        input.userId,
      ],
    );
    let lineNo = 1;
    for (const l of input.lines) {
      await client.query(
        `INSERT INTO journal_lines
           (id, tenant_id, entry_id, line_no, account_id, description, debit, credit, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8)`,
        [newId(), entryId, lineNo, l.accountId, input.description, l.debit, l.credit, input.userId],
      );
      lineNo++;
    }
    return entryId;
  }
}

export const expenseService = new ExpenseService();

/** Gider kategorisine bağlanacak hesap: tenant planında, 6xx/7xx gelir tablosu hesabı. */
async function assertExpenseAccount(accountId: string | null | undefined) {
  if (!accountId) return;
  const r = await getPool('app').query(
    `SELECT code FROM accounting_accounts WHERE id = $1 AND tenant_id = current_tenant_id()`,
    [accountId],
  );
  const code = String(r.rows[0]?.code ?? '');
  if (!code) throw new AppError('NOT_FOUND', 'Muhasebe hesabı bulunamadı');
  if (!/^[67]/.test(code)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Gider kategorisi yalnızca 6xx/7xx (gider/maliyet) hesabına bağlanabilir.',
    );
  }
}

export async function createExpenseCategory(input: CreateExpenseCategoryInput, userId?: string) {
  const pool = getPool('app');
  const categoryId = newId();
  await assertExpenseAccount(input.account_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_by, updated_by, created_at, updated_at, account_id)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8, now(), now(), $9)`,
      [
        categoryId,
        input.code.trim().toUpperCase(),
        input.name.trim(),
        input.description?.trim() || null,
        input.grup ?? null,
        input.is_favorite ?? false,
        input.status,
        userId || null,
        input.account_id ?? null,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getExpenseCategoryById(categoryId);
}

export async function updateExpenseCategory(
  id: string,
  input: UpdateExpenseCategoryInput,
  userId?: string,
) {
  const pool = getPool('app');
  const existing = await getExpenseCategoryById(id);
  if (!existing) throw new AppError('NOT_FOUND', 'Gider kategorisi bulunamadı');
  await assertExpenseAccount(input.account_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE expense_categories
       SET code = COALESCE($1, code),
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           grup = CASE WHEN $9::boolean THEN NULL WHEN $4 = '__KEEP__' THEN grup ELSE $4 END,
           is_favorite = COALESCE($5, is_favorite),
           status = COALESCE($6, status),
           account_id = CASE WHEN $10::boolean THEN $11::uuid ELSE account_id END,
           updated_by = $7, updated_at = now()
       WHERE id = $8 AND tenant_id = current_tenant_id()`,
      [
        input.code?.trim().toUpperCase() || null,
        input.name?.trim() || null,
        input.description !== undefined ? input.description?.trim() || null : null,
        input.grup !== undefined ? input.grup : '__KEEP__',
        input.is_favorite ?? null,
        input.status || null,
        userId || null,
        id,
        input.grup === null,
        input.account_id !== undefined,
        input.account_id ?? null,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getExpenseCategoryById(id);
}

/** Kategori silme — kullanılmış kategori silinemez (giderler SET NULL olacağı için
 *  önce kullanım kontrolü yapılır; kullanıcıya açık mesaj verilir). */
export async function deleteExpenseCategory(id: string) {
  const pool = getPool('app');
  const existing = await getExpenseCategoryById(id);
  if (!existing) throw new AppError('NOT_FOUND', 'Gider kategorisi bulunamadı');
  const used = await pool.query(
    `SELECT 1 FROM expenses WHERE category_id = $1 AND tenant_id = current_tenant_id() LIMIT 1`,
    [id],
  );
  if ((used.rowCount ?? 0) > 0) {
    throw new AppError(
      'CONFLICT',
      'Bu kategori giderlerde kullanılıyor. Önce pasife alın; silmek için bağlı giderleri başka kategoriye taşıyın.',
    );
  }
  await pool.query(
    `DELETE FROM expense_categories WHERE id = $1 AND tenant_id = current_tenant_id()`,
    [id],
  );
  return { success: true };
}

export async function getExpenseCategoryById(id: string) {
  const pool = getPool('app');
  const result = await pool.query(
    `SELECT ec.*, aa.code AS account_code, aa.name AS account_name
       FROM expense_categories ec
       LEFT JOIN accounting_accounts aa ON aa.id = ec.account_id
      WHERE ec.id = $1 AND ec.tenant_id = current_tenant_id()`,
    [id],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

export async function listExpenseCategories(query?: { category_id?: string; status?: string }) {
  const pool = getPool('app');
  const { category_id, status } = query || {};
  const conditions: string[] = ['ec.tenant_id = current_tenant_id()'];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (category_id) {
    conditions.push(`ec.id = $${paramIdx}`);
    values.push(category_id);
    paramIdx++;
  }
  if (status) {
    conditions.push(`ec.status = $${paramIdx}`);
    values.push(status);
  }

  // Muhasebe hesabı (kod/ad) da döner — kategori ekranında hesap eşlemesi gösterilir.
  const result = await pool.query(
    `SELECT ec.*, aa.code AS account_code, aa.name AS account_name
       FROM expense_categories ec
       LEFT JOIN accounting_accounts aa ON aa.id = ec.account_id
      WHERE ${conditions.join(' AND ')}`,
    values,
  );

  return result.rows;
}

export async function createExpense(input: CreateExpenseInput, userId: string) {
  return expenseService.createExpense(input, userId);
}

export async function getExpenseById(id: string) {
  return expenseService.getExpenseById(id);
}

export async function listExpenses(query?: ExpenseListQuery) {
  return expenseService.listExpenses(query || ({} as ExpenseListQuery));
}

export async function updateExpense(id: string, input: UpdateExpenseInput, userId: string) {
  return expenseService.updateExpense(id, input, userId);
}

export async function deleteExpense(id: string, userId: string) {
  return expenseService.deleteExpense(id, userId);
}

export async function createExpensePayment(
  expenseId: string,
  input: ExpensePaymentInput,
  userId: string,
) {
  return expenseService.createPayment(expenseId, input, userId);
}
