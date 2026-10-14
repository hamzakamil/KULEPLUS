import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

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

// ==================== Şemalar ====================

export const createBankLoanSchema = z.object({
  bankAccountId: z.string().uuid(),
  loanNumber: z.string().optional(),
  loanType: z.enum(['term', 'revolving', 'overdraft', 'mortgage']).default('term'),
  principal: z.number().positive(),
  interestRate: z.number().nonnegative().default(0),
  totalInstallments: z.number().int().positive().default(1),
  installmentAmount: z.number().nonnegative().default(0),
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
  currency: z.string().length(3).default('TRY'),
  description: z.string().optional(),
});
export const updateBankLoanSchema = createBankLoanSchema.partial();

export const createCreditCardSchema = z.object({
  bankAccountId: z.string().uuid(),
  cardLabel: z.string().min(1),
  cardNumberLast4: z.string().max(4).optional(),
  cardNetwork: z.enum(['visa', 'mastercard', 'troy', 'amex', 'other']).optional(),
  creditLimit: z.number().nonnegative().default(0),
  currentDebt: z.number().nonnegative().default(0),
  statementDay: z.number().int().min(1).max(31).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  currency: z.string().length(3).default('TRY'),
  description: z.string().optional(),
});
export const updateCreditCardSchema = createCreditCardSchema.partial();

export const createPosAccountSchema = z.object({
  bankAccountId: z.string().uuid(),
  posLabel: z.string().min(1),
  terminalId: z.string().optional(),
  merchantNumber: z.string().optional(),
  commissionRate: z.number().nonnegative().default(0),
  installmentSupported: z.boolean().default(true),
  currency: z.string().length(3).default('TRY'),
  description: z.string().optional(),
});
export const updatePosAccountSchema = createPosAccountSchema.partial();

export type CreateBankLoanInput = z.infer<typeof createBankLoanSchema>;
export type CreateCreditCardInput = z.infer<typeof createCreditCardSchema>;
export type CreatePosAccountInput = z.infer<typeof createPosAccountSchema>;

// ==================== Banka Kredileri ====================

export async function listBankLoans(tenantId?: string, bankAccountId?: string) {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [];
    let where = 't.tenant_id = app.current_tenant_id()';
    if (bankAccountId) {
      params.push(bankAccountId);
      where += ` AND t.bank_account_id = $${params.length}`;
    }
    const result = await client.query(
      `SELECT t.*, a.account_name AS bank_account_name
       FROM bank_loans t
       LEFT JOIN cash_bank_accounts a ON a.id = t.bank_account_id
       WHERE ${where}
       ORDER BY t.created_at DESC`,
      params,
    );
    return {
      items: result.rows.map((r) => ({
        ...r,
        principal: Number(r.principal),
        interestRate: Number(r.interest_rate),
        installmentAmount: Number(r.installment_amount),
        remainingBalance: Number(r.remaining_balance),
        totalInstallments: Number(r.total_installments),
        paidInstallments: Number(r.paid_installments),
        bankAccountName: r.bank_account_name,
        loanType: r.loan_type,
        loanNumber: r.loan_number,
        startDate: r.start_date,
        endDate: r.end_date,
      })),
    };
  });
}

export async function createBankLoan(
  input: CreateBankLoanInput,
  userId: string,
  tenantId?: string,
) {
  return withTenant(tenantId, async (client) => {
    const id = newId();
    const result = await client.query(
      `INSERT INTO bank_loans (id, tenant_id, bank_account_id, loan_number, loan_type, principal, interest_rate, total_installments, paid_installments, installment_amount, remaining_balance, start_date, end_date, currency, status, description, created_by, updated_by)
       VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, 0, $8, $5, $9, $10, $11, 'active', $12, $13, $13)
       RETURNING *`,
      [
        id,
        input.bankAccountId,
        input.loanNumber ?? null,
        input.loanType,
        input.principal,
        input.interestRate,
        input.totalInstallments,
        input.installmentAmount,
        input.startDate,
        input.endDate ?? null,
        input.currency,
        input.description ?? null,
        userId,
      ],
    );
    return result.rows[0];
  });
}

export async function updateBankLoan(
  id: string,
  input: Partial<CreateBankLoanInput> & {
    status?: string;
    paidInstallments?: number;
    remainingBalance?: number;
  },
  userId: string,
  tenantId?: string,
) {
  return withTenant(tenantId, async (client) => {
    const map: Record<string, string> = {
      bankAccountId: 'bank_account_id',
      loanNumber: 'loan_number',
      loanType: 'loan_type',
      principal: 'principal',
      interestRate: 'interest_rate',
      totalInstallments: 'total_installments',
      installmentAmount: 'installment_amount',
      startDate: 'start_date',
      endDate: 'end_date',
      currency: 'currency',
      description: 'description',
      status: 'status',
      paidInstallments: 'paid_installments',
      remainingBalance: 'remaining_balance',
    };
    const fields: string[] = [];
    const values: unknown[] = [id, userId];
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && map[k]) {
        values.push(v);
        fields.push(`${map[k]} = $${values.length}`);
      }
    }
    if (!fields.length) return null;
    fields.push('updated_by = $2', 'updated_at = now()', 'version = version + 1');
    const result = await client.query(
      `UPDATE bank_loans SET ${fields.join(', ')} WHERE id = $1 AND tenant_id = app.current_tenant_id() RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  });
}

export async function deleteBankLoan(id: string, tenantId?: string) {
  return withTenant(tenantId, async (client) => {
    const r = await client.query(
      `DELETE FROM bank_loans WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
      [id],
    );
    if (r.rowCount === 0) throw new AppError('NOT_FOUND', 'Kredi bulunamadı');
    return { success: true };
  });
}

// ==================== Kredi Kartları ====================

export async function listCreditCards(tenantId?: string, bankAccountId?: string) {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [];
    let where = 't.tenant_id = app.current_tenant_id()';
    if (bankAccountId) {
      params.push(bankAccountId);
      where += ` AND t.bank_account_id = $${params.length}`;
    }
    const result = await client.query(
      `SELECT t.*, a.account_name AS bank_account_name
       FROM credit_cards t
       LEFT JOIN cash_bank_accounts a ON a.id = t.bank_account_id
       WHERE ${where}
       ORDER BY t.created_at DESC`,
      params,
    );
    return {
      items: result.rows.map((r) => ({
        ...r,
        creditLimit: Number(r.credit_limit),
        currentDebt: Number(r.current_debt),
        availableLimit: Number(r.available_limit),
        cardLabel: r.card_label,
        cardNumberLast4: r.card_number_last4,
        cardNetwork: r.card_network,
        statementDay: r.statement_day,
        dueDay: r.due_day,
        bankAccountName: r.bank_account_name,
      })),
    };
  });
}

export async function createCreditCard(
  input: CreateCreditCardInput,
  userId: string,
  tenantId?: string,
) {
  return withTenant(tenantId, async (client) => {
    const id = newId();
    const available = input.creditLimit - input.currentDebt;
    const result = await client.query(
      `INSERT INTO credit_cards (id, tenant_id, bank_account_id, card_label, card_number_last4, card_network, credit_limit, current_debt, available_limit, statement_day, due_day, currency, status, description, created_by, updated_by)
       VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12, $13, $13)
       RETURNING *`,
      [
        id,
        input.bankAccountId,
        input.cardLabel,
        input.cardNumberLast4 ?? null,
        input.cardNetwork ?? null,
        input.creditLimit,
        input.currentDebt,
        available,
        input.statementDay ?? null,
        input.dueDay ?? null,
        input.currency,
        input.description ?? null,
        userId,
      ],
    );
    return result.rows[0];
  });
}

export async function updateCreditCard(
  id: string,
  input: Partial<CreateCreditCardInput> & { status?: string },
  userId: string,
  tenantId?: string,
) {
  return withTenant(tenantId, async (client) => {
    const map: Record<string, string> = {
      bankAccountId: 'bank_account_id',
      cardLabel: 'card_label',
      cardNumberLast4: 'card_number_last4',
      cardNetwork: 'card_network',
      creditLimit: 'credit_limit',
      currentDebt: 'current_debt',
      statementDay: 'statement_day',
      dueDay: 'due_day',
      currency: 'currency',
      description: 'description',
      status: 'status',
    };
    const fields: string[] = [];
    const values: unknown[] = [id, userId];
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && map[k]) {
        values.push(v);
        fields.push(`${map[k]} = $${values.length}`);
      }
    }
    if (!fields.length) return null;
    // Kullanılabilir limit, limit ve borç değişince yeniden hesaplanır.
    fields.push('available_limit = credit_limit - current_debt');
    fields.push('updated_by = $2', 'updated_at = now()', 'version = version + 1');
    const result = await client.query(
      `UPDATE credit_cards SET ${fields.join(', ')} WHERE id = $1 AND tenant_id = app.current_tenant_id() RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  });
}

export async function deleteCreditCard(id: string, tenantId?: string) {
  return withTenant(tenantId, async (client) => {
    const r = await client.query(
      `DELETE FROM credit_cards WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
      [id],
    );
    if (r.rowCount === 0) throw new AppError('NOT_FOUND', 'Kredi kartı bulunamadı');
    return { success: true };
  });
}

// ==================== POS Hesapları ====================

export async function listPosAccounts(tenantId?: string, bankAccountId?: string) {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [];
    let where = 't.tenant_id = app.current_tenant_id()';
    if (bankAccountId) {
      params.push(bankAccountId);
      where += ` AND t.bank_account_id = $${params.length}`;
    }
    const result = await client.query(
      `SELECT t.*, a.account_name AS bank_account_name
       FROM pos_accounts t
       LEFT JOIN cash_bank_accounts a ON a.id = t.bank_account_id
       WHERE ${where}
       ORDER BY t.created_at DESC`,
      params,
    );
    return {
      items: result.rows.map((r) => ({
        ...r,
        commissionRate: Number(r.commission_rate),
        installmentSupported: r.installment_supported,
        posLabel: r.pos_label,
        terminalId: r.terminal_id,
        merchantNumber: r.merchant_number,
        bankAccountName: r.bank_account_name,
      })),
    };
  });
}

export async function createPosAccount(
  input: CreatePosAccountInput,
  userId: string,
  tenantId?: string,
) {
  return withTenant(tenantId, async (client) => {
    const id = newId();
    const result = await client.query(
      `INSERT INTO pos_accounts (id, tenant_id, bank_account_id, pos_label, terminal_id, merchant_number, commission_rate, installment_supported, currency, status, description, created_by, updated_by)
       VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $10)
       RETURNING *`,
      [
        id,
        input.bankAccountId,
        input.posLabel,
        input.terminalId ?? null,
        input.merchantNumber ?? null,
        input.commissionRate,
        input.installmentSupported,
        input.currency,
        input.description ?? null,
        userId,
      ],
    );
    return result.rows[0];
  });
}

export async function updatePosAccount(
  id: string,
  input: Partial<CreatePosAccountInput> & { status?: string },
  userId: string,
  tenantId?: string,
) {
  return withTenant(tenantId, async (client) => {
    const map: Record<string, string> = {
      bankAccountId: 'bank_account_id',
      posLabel: 'pos_label',
      terminalId: 'terminal_id',
      merchantNumber: 'merchant_number',
      commissionRate: 'commission_rate',
      installmentSupported: 'installment_supported',
      currency: 'currency',
      description: 'description',
      status: 'status',
    };
    const fields: string[] = [];
    const values: unknown[] = [id, userId];
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && map[k]) {
        values.push(v);
        fields.push(`${map[k]} = $${values.length}`);
      }
    }
    if (!fields.length) return null;
    fields.push('updated_by = $2', 'updated_at = now()', 'version = version + 1');
    const result = await client.query(
      `UPDATE pos_accounts SET ${fields.join(', ')} WHERE id = $1 AND tenant_id = app.current_tenant_id() RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  });
}

export async function deletePosAccount(id: string, tenantId?: string) {
  return withTenant(tenantId, async (client) => {
    const r = await client.query(
      `DELETE FROM pos_accounts WHERE id = $1 AND tenant_id = app.current_tenant_id()`,
      [id],
    );
    if (r.rowCount === 0) throw new AppError('NOT_FOUND', 'POS hesabı bulunamadı');
    return { success: true };
  });
}
