import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { newId } from '@kuleplus/shared';
import { z } from 'zod';

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
});

export const updateExpenseCategorySchema = createExpenseCategorySchema.partial();

export const createExpenseSchema = z.object({
  invoice_number: z.string().optional(),
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
  amount: z.number().nonnegative(),
  currency: z.string().length(3).default('TRY'),
  exchange_rate: z.number().positive().default(1),
  payment_status: z.enum(['unpaid', 'partial', 'paid']).default('unpaid'),
  status: z.enum(['draft', 'posted', 'cancelled']).default('draft'),
  notes: z.string().optional(),
  receipt_file_url: z.string().url().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

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
  amount: z.number().nonnegative(),
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
    const pool = this.getPoolInstance();
    const expenseId = newId();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO expenses (id, tenant_id, invoice_number, invoice_date, expense_date, category_id, contact_id, description, amount, currency, exchange_rate, payment_status, status, notes, receipt_file_url, created_by, updated_by, version, created_at, updated_at)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, 1, now(), now())`,
        [
          expenseId,
          input.invoice_number,
          input.invoice_date,
          // `expense_date` DB'de NOT NULL; API'de optional → verilmezse bugünün tarihi (Europe/Istanbul).
          input.expense_date ?? this.todayIso(),
          input.category_id,
          input.contact_id,
          input.description,
          input.amount,
          input.currency,
          input.exchange_rate,
          input.payment_status,
          input.status,
          input.notes,
          input.receipt_file_url,
          userId,
        ],
      );

      await this.writeAudit(client, {
        userId,
        action: 'create',
        entityId: expenseId,
        newValues: {
          invoice_number: input.invoice_number,
          amount: input.amount,
          status: input.status,
        },
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

  async updateExpense(id: string, input: UpdateExpenseInput, userId: string) {
    const pool = this.getPoolInstance();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE expenses
         SET invoice_number = COALESCE($1, invoice_number),
             invoice_date = COALESCE($2, invoice_date),
             expense_date = COALESCE($3, expense_date),
             category_id = COALESCE($4, category_id),
             contact_id = COALESCE($5, contact_id),
             description = COALESCE($6, description),
             amount = COALESCE($7, amount),
             currency = COALESCE($8, currency),
             exchange_rate = COALESCE($9, exchange_rate),
             payment_status = COALESCE($10, payment_status),
             status = COALESCE($11, status),
             notes = COALESCE($12, notes),
             receipt_file_url = COALESCE($13, receipt_file_url),
             updated_by = $14, updated_at = now()
         WHERE id = $15 AND tenant_id = current_tenant_id()`,
        [
          input.invoice_number,
          input.invoice_date,
          input.expense_date,
          input.category_id,
          input.contact_id,
          input.description,
          input.amount,
          input.currency,
          input.exchange_rate,
          input.payment_status,
          input.status,
          input.notes,
          input.receipt_file_url,
          userId,
          id,
        ],
      );

      await this.writeAudit(client, {
        userId,
        action: 'update',
        entityId: id,
        newValues: {
          amount: input.amount,
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

  async deleteExpense(id: string, userId: string) {
    const pool = this.getPoolInstance();
    const expense = await pool.query(
      `SELECT * FROM expenses WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    if (expense.rows.length === 0) throw new AppError('NOT_FOUND', 'Gider bulunamadı');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE expenses SET status = 'cancelled', updated_at = now() WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [id],
      );

      await this.writeAudit(client, {
        userId,
        action: 'delete',
        entityId: id,
        oldValues: { amount: expense.rows[0].amount, status: expense.rows[0].status },
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
}

export const expenseService = new ExpenseService();

export async function createExpenseCategory(input: CreateExpenseCategoryInput, userId?: string) {
  const pool = getPool('app');
  const categoryId = newId();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_by, updated_by, created_at, updated_at)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8, now(), now())`,
      [
        categoryId,
        input.code.trim().toUpperCase(),
        input.name.trim(),
        input.description?.trim() || null,
        input.grup ?? null,
        input.is_favorite ?? false,
        input.status,
        userId || null,
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
    `SELECT * FROM expense_categories WHERE id = $1 AND tenant_id = current_tenant_id()`,
    [id],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

export async function listExpenseCategories(query?: { category_id?: string; status?: string }) {
  const pool = getPool('app');
  const { category_id, status } = query || {};
  const conditions: string[] = ['tenant_id = current_tenant_id()'];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (category_id) {
    conditions.push(`id = $${paramIdx}`);
    values.push(category_id);
    paramIdx++;
  }
  if (status) {
    conditions.push(`status = $${paramIdx}`);
    values.push(status);
  }

  const result = await pool.query(
    `SELECT * FROM expense_categories WHERE ${conditions.join(' AND ')}`,
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
  userId?: string,
) {
  const pool = getPool('app');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const expense = await pool.query(
      `SELECT * FROM expenses WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [expenseId],
    );
    if (expense.rows.length === 0) throw new AppError('NOT_FOUND', 'Gider bulunamadı');

    const movementId = newId();
    // Referans bir kasa/banka hesabına işaret ediyorsa varlığını doğrula.
    await pool.query(
      `SELECT 1 FROM cash_bank_accounts WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [input.reference || null],
    );

    let accountId: string;
    if (input.payment_method === 'cash') {
      // Find cash account
      const cashAcct = await pool.query(
        `SELECT * FROM cash_bank_accounts WHERE account_type = 'cash' AND tenant_id = current_tenant_id()`,
        [],
      );
      accountId = cashAcct.rows[0]?.id || '';
    } else {
      accountId = input.reference || '';
    }

    // Calculate balance changes
    // Mevcut ödemeler toplamı ileride bakiye hesabı için kullanılacak.
    await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expense_payments WHERE expense_id = $1`,
      [expenseId],
    );

    await client.query(
      `INSERT INTO expense_payments (id, tenant_id, expense_id, account_id, movement_type, amount, currency, transaction_date, payment_date, reference, description, balance_before, balance_after, created_by, updated_by)
       VALUES ($1, current_tenant_id(), $2, $3, 'withdrawal', $4, $5, now(), $6, $7, $8, 0, 0, $9, $9)`,
      [
        movementId,
        expenseId,
        accountId,
        input.amount,
        input.currency,
        input.payment_date,
        input.reference || null,
        input.notes || null,
        userId || null,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { success: true };
}
