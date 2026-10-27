import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { buildLoanSchedule } from './loan-schedule';

/** Tenant bağlamlı işlem yardımcısı (RLS `app.current_tenant_id()` okur). */
async function withTenant<T>(
  tenantId: string | undefined,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool: Pool = getPool('app');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenantId) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const num = (value: unknown): number => Number(value ?? 0);
const money = (value: number): number => Math.round(value * 100) / 100;
const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * pg `date` alanlarını JS Date olarak döndürür (yerel gece yarısı). `String(...)`
 * doğrudan kesilince "Mon Oct 01" gibi geçersiz ISO üretiyordu; yerel bileşenlerden
 * YYYY-MM-DD üretiyoruz.
 */
export function isoDate(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  return String(value ?? '').slice(0, 10);
}

// ==================== Şemalar ====================

export const cardTransactionTypeSchema = z.enum([
  'purchase',
  'payment',
  'refund',
  'fee',
  'interest',
]);

export const createCardTransactionSchema = z.object({
  transactionDate: z.string().date(),
  transactionType: cardTransactionTypeSchema,
  description: z.string().min(1),
  amount: z.number().positive(),
  installmentCount: z.number().int().min(1).max(36).default(1),
  reference: z.string().optional(),
});

export const payLoanInstallmentSchema = z.object({
  paidDate: z.string().date().optional(),
});

export const cardTransactionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  transactionType: cardTransactionTypeSchema.optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

export type CreateCardTransactionInput = z.infer<typeof createCardTransactionSchema>;
export type PayLoanInstallmentInput = z.infer<typeof payLoanInstallmentSchema>;
export type CardTransactionListQuery = z.infer<typeof cardTransactionListQuerySchema>;

// ==================== Yardımcılar ====================

/** Harcama türlerinde borç artar, ödeme/iade türlerinde azalır. */
export function cardDebtEffect(
  type: z.infer<typeof cardTransactionTypeSchema>,
  amount: number,
): number {
  return type === 'purchase' || type === 'fee' || type === 'interest' ? amount : -amount;
}

type Row = Record<string, unknown>;

function mapCardTransaction(row: Row) {
  return {
    id: row.id,
    creditCardId: row.credit_card_id,
    transactionDate: isoDate(row.transaction_date),
    transactionType: row.transaction_type,
    description: row.description,
    amount: num(row.amount),
    installmentCount: num(row.installment_count),
    reference: row.reference,
    createdAt: row.created_at,
  };
}

function mapInstallment(row: Row, today = todayIso()) {
  const dueDate = isoDate(row.due_date);
  const paid = row.status === 'paid';
  return {
    id: row.id,
    bankLoanId: row.bank_loan_id,
    installmentNo: num(row.installment_no),
    dueDate,
    amount: num(row.amount),
    principalAmount: num(row.principal_amount),
    interestAmount: num(row.interest_amount),
    paidAmount: num(row.paid_amount),
    paidAt: row.paid_at ? isoDate(row.paid_at) : null,
    status: paid ? 'paid' : dueDate < today ? 'overdue' : 'pending',
  };
}

async function readInstallments(client: PoolClient, loanId: string) {
  const result = await client.query(
    `SELECT * FROM bank_loan_installments
      WHERE bank_loan_id = $1 AND tenant_id = app.current_tenant_id()
      ORDER BY installment_no`,
    [loanId],
  );
  const today = todayIso();
  const items = result.rows.map((row) => mapInstallment(row, today));

  const paid = items.filter((i) => i.status === 'paid');
  const pending = items.filter((i) => i.status !== 'paid');
  return {
    items,
    summary: {
      total: items.length,
      paidCount: paid.length,
      pendingCount: pending.length,
      overdueCount: pending.filter((i) => i.status === 'overdue').length,
      paidAmount: money(paid.reduce((sum, i) => sum + i.paidAmount, 0)),
      remainingAmount: money(pending.reduce((sum, i) => sum + i.amount, 0)),
      nextDueDate: pending
        .map((i) => i.dueDate)
        .sort((a, b) => a.localeCompare(b))[0] ?? null,
    },
  };
}

async function recalcLoanFromInstallments(client: PoolClient, loanId: string) {
  const result = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
       COUNT(*) FILTER (WHERE status <> 'paid' AND due_date < CURRENT_DATE) AS overdue_count,
       COALESCE(SUM(amount) FILTER (WHERE status <> 'paid'), 0) AS remaining
     FROM bank_loan_installments
     WHERE bank_loan_id = $1 AND tenant_id = app.current_tenant_id()`,
    [loanId],
  );
  const row = result.rows[0] ?? {};
  const paidCount = num(row.paid_count);
  const overdueCount = num(row.overdue_count);
  const remaining = money(num(row.remaining));
  const status = remaining <= 0 ? 'closed' : overdueCount > 0 ? 'overdue' : 'active';

  await client.query(
    `UPDATE bank_loans
        SET paid_installments = $2,
            remaining_balance = $3,
            status = $4,
            updated_at = now(),
            version = version + 1
      WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
    [loanId, paidCount, remaining, status],
  );
}

// ==================== Kredi Kartı Hareketleri ====================

export async function listCardTransactions(
  tenantId: string | undefined,
  cardId: string,
  query: CardTransactionListQuery,
) {
  return withTenant(tenantId, async (client) => {
    const card = await client.query(
      `SELECT id FROM credit_cards WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
      [cardId],
    );
    if (!card.rowCount) throw new AppError('NOT_FOUND', 'Kredi kartı bulunamadı');

    const params: unknown[] = [cardId];
    const where = ['tenant_id = app.current_tenant_id()', 'credit_card_id = $1'];
    if (query.transactionType) {
      params.push(query.transactionType);
      where.push(`transaction_type = $${params.length}`);
    }
    if (query.dateFrom) {
      params.push(query.dateFrom);
      where.push(`transaction_date >= $${params.length}`);
    }
    if (query.dateTo) {
      params.push(query.dateTo);
      where.push(`transaction_date <= $${params.length}`);
    }
    const whereSql = where.join(' AND ');

    const countResult = await client.query(
      `SELECT COUNT(*) AS total FROM credit_card_transactions WHERE ${whereSql}`,
      params,
    );
    const total = num(countResult.rows[0]?.total);
    const offset = (query.page - 1) * query.limit;
    const listParams = [...params, query.limit, offset];
    const rows = await client.query(
      `SELECT * FROM credit_card_transactions
        WHERE ${whereSql}
        ORDER BY transaction_date DESC, created_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    const totals = await client.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE transaction_type IN ('purchase','fee','interest')), 0) AS debit,
         COALESCE(SUM(amount) FILTER (WHERE transaction_type IN ('payment','refund')), 0) AS credit
       FROM credit_card_transactions
       WHERE ${whereSql}`,
      params,
    );

    return {
      items: rows.rows.map(mapCardTransaction),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      totals: {
        debit: money(num(totals.rows[0]?.debit)),
        credit: money(num(totals.rows[0]?.credit)),
      },
    };
  });
}

export async function createCardTransaction(
  tenantId: string | undefined,
  cardId: string,
  input: CreateCardTransactionInput,
  userId: string,
) {
  return withTenant(tenantId, async (client) => {
    const cardResult = await client.query(
      `SELECT * FROM credit_cards
        WHERE id = $1 AND tenant_id = app.current_tenant_id()
        FOR UPDATE`,
      [cardId],
    );
    const card = cardResult.rows[0];
    if (!card) throw new AppError('NOT_FOUND', 'Kredi kartı bulunamadı');

    const debt = num(card.current_debt);
    const effect = cardDebtEffect(input.transactionType, input.amount);
    if (debt + effect < 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Ödeme/iade tutarı güncel kart borcunu aşamaz',
      );
    }

    const id = newId();
    const inserted = await client.query(
      `INSERT INTO credit_card_transactions
         (id, tenant_id, credit_card_id, transaction_date, transaction_type, description,
          amount, installment_count, reference, created_by, updated_by)
       VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        id,
        cardId,
        input.transactionDate,
        input.transactionType,
        input.description,
        input.amount,
        input.installmentCount,
        input.reference ?? null,
        userId,
      ],
    );

    const newDebt = money(debt + effect);
    await client.query(
      `UPDATE credit_cards
          SET current_debt = $2,
              available_limit = credit_limit - $2,
              updated_by = $3,
              updated_at = now(),
              version = version + 1
        WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
      [cardId, newDebt, userId],
    );

    return mapCardTransaction(inserted.rows[0]);
  });
}

export async function deleteCardTransaction(
  tenantId: string | undefined,
  cardId: string,
  transactionId: string,
  userId: string,
) {
  return withTenant(tenantId, async (client) => {
    const cardResult = await client.query(
      `SELECT * FROM credit_cards
        WHERE id = $1 AND tenant_id = app.current_tenant_id()
        FOR UPDATE`,
      [cardId],
    );
    const card = cardResult.rows[0];
    if (!card) throw new AppError('NOT_FOUND', 'Kredi kartı bulunamadı');

    const txResult = await client.query(
      `SELECT * FROM credit_card_transactions
        WHERE id = $1 AND credit_card_id = $2 AND tenant_id = app.current_tenant_id()
        FOR UPDATE`,
      [transactionId, cardId],
    );
    const tx = txResult.rows[0];
    if (!tx) throw new AppError('NOT_FOUND', 'Kart hareketi bulunamadı');

    const reverse = -cardDebtEffect(tx.transaction_type, num(tx.amount));
    const newDebt = Math.max(0, money(num(card.current_debt) + reverse));

    await client.query(
      `DELETE FROM credit_card_transactions
        WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
      [transactionId],
    );
    await client.query(
      `UPDATE credit_cards
          SET current_debt = $2,
              available_limit = credit_limit - $2,
              updated_by = $3,
              updated_at = now(),
              version = version + 1
        WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
      [cardId, newDebt, userId],
    );

    return { success: true };
  });
}

// ==================== Kredi Taksit Planı ====================

/** Mevcut planı siler ve kredi alanlarından yeniden üretir (ödeme yokken). */
export async function replaceLoanSchedule(client: PoolClient, loan: Row): Promise<void> {
  const loanId = String(loan.id);
  const rows = buildLoanSchedule({
    principal: num(loan.principal),
    interestRate: num(loan.interest_rate),
    totalInstallments: num(loan.total_installments),
    installmentAmount: num(loan.installment_amount),
    startDate: isoDate(loan.start_date),
  });

  await client.query(
    `DELETE FROM bank_loan_installments
      WHERE bank_loan_id = $1 AND tenant_id = app.current_tenant_id()`,
    [loanId],
  );

  for (const row of rows) {
    await client.query(
      `INSERT INTO bank_loan_installments
         (id, tenant_id, bank_loan_id, installment_no, due_date, amount,
          principal_amount, interest_amount, status)
       VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, 'pending')`,
      [
        newId(),
        loanId,
        row.installmentNo,
        row.dueDate,
        row.amount,
        row.principalAmount,
        row.interestAmount,
      ],
    );
  }

  const totalAmount = money(rows.reduce((sum, row) => sum + row.amount, 0));
  const lastDueDate = rows[rows.length - 1]?.dueDate ?? null;
  await client.query(
    `UPDATE bank_loans
        SET installment_amount = $2,
            remaining_balance = $3,
            paid_installments = 0,
            end_date = COALESCE($4, end_date),
            status = CASE WHEN status = 'closed' THEN 'active' ELSE status END,
            updated_at = now(),
            version = version + 1
      WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
    [loanId, rows[0]?.amount ?? 0, totalAmount, lastDueDate],
  );
}

export async function listLoanInstallments(tenantId: string | undefined, loanId: string) {
  return withTenant(tenantId, async (client) => {
    const loan = await client.query(
      `SELECT id FROM bank_loans WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
      [loanId],
    );
    if (!loan.rowCount) throw new AppError('NOT_FOUND', 'Kredi bulunamadı');
    return readInstallments(client, loanId);
  });
}

/** Taksit planı yoksa/ödeme yoksa yeniden üretir ve planı döndürür. */
export async function generateLoanInstallments(tenantId: string | undefined, loanId: string) {
  return withTenant(tenantId, async (client) => {
    const loanResult = await client.query(
      `SELECT * FROM bank_loans
        WHERE id = $1 AND tenant_id = app.current_tenant_id()
        FOR UPDATE`,
      [loanId],
    );
    const loan = loanResult.rows[0];
    if (!loan) throw new AppError('NOT_FOUND', 'Kredi bulunamadı');

    const paid = await client.query(
      `SELECT COUNT(*) AS paid FROM bank_loan_installments
        WHERE bank_loan_id = $1 AND tenant_id = app.current_tenant_id() AND status = 'paid'`,
      [loanId],
    );
    if (num(paid.rows[0]?.paid) > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Ödenmiş taksit varken plan yeniden oluşturulamaz',
      );
    }

    await replaceLoanSchedule(client, loan);
    return readInstallments(client, loanId);
  });
}

export async function payLoanInstallment(
  tenantId: string | undefined,
  loanId: string,
  installmentId: string,
  input: PayLoanInstallmentInput,
) {
  return withTenant(tenantId, async (client) => {
    const loan = await client.query(
      `SELECT id FROM bank_loans
        WHERE id = $1 AND tenant_id = app.current_tenant_id()
        FOR UPDATE`,
      [loanId],
    );
    if (!loan.rowCount) throw new AppError('NOT_FOUND', 'Kredi bulunamadı');

    const installment = await client.query(
      `SELECT * FROM bank_loan_installments
        WHERE id = $1 AND bank_loan_id = $2 AND tenant_id = app.current_tenant_id()
        FOR UPDATE`,
      [installmentId, loanId],
    );
    const row = installment.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'Taksit bulunamadı');

    if (row.status !== 'paid') {
      await client.query(
        `UPDATE bank_loan_installments
            SET status = 'paid',
                paid_amount = amount,
                paid_at = $2,
                updated_at = now()
          WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
        [installmentId, input.paidDate ?? todayIso()],
      );
      await recalcLoanFromInstallments(client, loanId);
    }

    return readInstallments(client, loanId);
  });
}

export async function unpayLoanInstallment(
  tenantId: string | undefined,
  loanId: string,
  installmentId: string,
) {
  return withTenant(tenantId, async (client) => {
    const loan = await client.query(
      `SELECT id FROM bank_loans
        WHERE id = $1 AND tenant_id = app.current_tenant_id()
        FOR UPDATE`,
      [loanId],
    );
    if (!loan.rowCount) throw new AppError('NOT_FOUND', 'Kredi bulunamadı');

    const installment = await client.query(
      `SELECT * FROM bank_loan_installments
        WHERE id = $1 AND bank_loan_id = $2 AND tenant_id = app.current_tenant_id()
        FOR UPDATE`,
      [installmentId, loanId],
    );
    if (!installment.rowCount) throw new AppError('NOT_FOUND', 'Taksit bulunamadı');

    await client.query(
      `UPDATE bank_loan_installments
          SET status = 'pending',
              paid_amount = 0,
              paid_at = NULL,
              updated_at = now()
        WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
      [installmentId],
    );
    await recalcLoanFromInstallments(client, loanId);

    return readInstallments(client, loanId);
  });
}

