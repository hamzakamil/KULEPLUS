import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { newId } from '@kuleplus/shared';
import { z } from 'zod';

export const depositSchema = z.object({
  accountId: z.string().uuid(),
  transactionDate: z.string().date(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).default('TRY'),
  exchangeRate: z.number().positive().default(1),
  reference: z.string().max(100).optional(),
  description: z.string().optional(),
  relatedDocumentType: z.string().max(50).optional(),
  relatedDocumentId: z.string().uuid().optional(),
});

export const withdrawalSchema = z.object({
  accountId: z.string().uuid(),
  transactionDate: z.string().date(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).default('TRY'),
  exchangeRate: z.number().positive().default(1),
  reference: z.string().max(100).optional(),
  description: z.string().optional(),
  relatedDocumentType: z.string().max(50).optional(),
  relatedDocumentId: z.string().uuid().optional(),
});

export const transferSchema = z.object({
  sourceAccountId: z.string().uuid(),
  targetAccountId: z.string().uuid(),
  transactionDate: z.string().date(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).default('TRY'),
  exchangeRate: z.number().positive().default(1),
  reference: z.string().max(100).optional(),
  description: z.string().optional(),
  relatedDocumentType: z.string().max(50).optional(),
  relatedDocumentId: z.string().uuid().optional(),
});

export const CashBankMovementListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  accountId: z.string().uuid().optional(),
  movementType: z.enum(['deposit', 'withdrawal', 'transfer']).optional(),
  currency: z.string().length(3).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['date', 'reference', 'amount', 'type', 'createdAt']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type DepositInput = z.infer<typeof depositSchema>;
export type WithdrawalInput = z.infer<typeof withdrawalSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type CashBankMovementListQuery = z.infer<typeof CashBankMovementListQuerySchema>;

export interface CashBankMovement {
  id: string;
  accountType: 'cash' | 'bank';
  accountName: string;
  movementType: 'deposit' | 'withdrawal' | 'transfer';
  transactionDate: Date;
  amount: number;
  currency: string;
  exchangeRate: number;
  baseAmount: number;
  reference?: string;
  description?: string;
  balanceBefore: number;
  balanceAfter: number;
  relatedDocumentType?: string;
  relatedDocumentId?: string;
  targetAccountId?: string;
  targetAccountName?: string;
  createdBy?: string;
  createdAt: Date;
}

class CashBankMovementService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;

  constructor(pool?: Pool) {
    this.providedPool = pool ?? null;
  }

  getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  private async calculateBalance(accountId: string, client?: Pool | PoolClient): Promise<number> {
    const executor = client ?? this.getPoolInstance();
    const result = await executor.query(
      `SELECT COALESCE(SUM(CASE WHEN m.movement_type = 'deposit' THEN m.base_amount ELSE 0 END), 0) as deposits,
              COALESCE(SUM(CASE WHEN m.movement_type = 'withdrawal' THEN m.base_amount ELSE 0 END), 0) as withdrawals
       FROM cash_bank_movements m
       WHERE m.account_id = $1 AND m.movement_type IN ('deposit', 'withdrawal')`,
      [accountId],
    );
    return Number(result.rows[0].deposits) - Number(result.rows[0].withdrawals);
  }

  async listMovements(query: CashBankMovementListQuery) {
    const pool = this.getPoolInstance();
    const {
      page,
      limit,
      accountId,
      movementType,
      currency,
      dateFrom,
      dateTo,
      search,
      sortBy,
      sortOrder,
    } = query;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['t.tenant_id = current_tenant_id()'];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (accountId) {
      conditions.push(`t.account_id = $${paramIdx}`);
      values.push(accountId);
      paramIdx++;
    }
    if (movementType) {
      conditions.push(`t.movement_type = $${paramIdx}`);
      values.push(movementType);
      paramIdx++;
    }
    if (currency) {
      conditions.push(`t.currency = $${paramIdx}`);
      values.push(currency);
      paramIdx++;
    }
    if (dateFrom) {
      conditions.push(`t.transaction_date >= $${paramIdx}`);
      values.push(dateFrom);
      paramIdx++;
    }
    if (dateTo) {
      conditions.push(`t.transaction_date <= $${paramIdx}`);
      values.push(dateTo);
      paramIdx++;
    }
    if (search) {
      conditions.push(`(t.description ILIKE $${paramIdx} OR t.reference ILIKE $${paramIdx})`);
      values.push(`%${search}%`);
      paramIdx++;
    }

    const col =
      {
        date: 't.transaction_date',
        createdAt: 't.created_at',
        amount: 't.amount',
        type: 't.movement_type',
        reference: 't.reference',
      }[sortBy] || 't.transaction_date';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [movementsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT t.*,
         s.account_name as source_account_name, s.account_type as source_account_type,
         t2.account_name as target_account_name, t2.account_type as target_account_type
         FROM cash_bank_movements t
         LEFT JOIN cash_bank_accounts s ON s.id = t.account_id AND s.tenant_id = t.tenant_id
         LEFT JOIN cash_bank_accounts t2 ON t2.id = t.target_account_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${col} ${order}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...values, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM cash_bank_movements t WHERE ${conditions.join(' AND ')}`,
        values,
      ),
    ]);

    return {
      items: movementsResult.rows.map((r: Record<string, unknown>) => ({
        ...r,
        amount: Number(r.amount),
        exchangeRate: Number(r.exchange_rate),
        baseAmount: Number(r.base_amount),
        balanceBefore: Number(r.balance_before),
        balanceAfter: Number(r.balance_after),
        targetAccountId: r.target_account_id || null,
        targetAccountName: r.target_account_name || null,
      })),
      page,
      limit,
      total: Number(countResult.rows[0].total),
      totalPages: Math.ceil(Number(countResult.rows[0].total) / limit),
    };
  }

  async getMovementById(id: string) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT m.*, s.account_name as account_name, s.account_type as account_type, t2.account_name as target_account_name
       FROM cash_bank_movements m
       LEFT JOIN cash_bank_accounts s ON s.id = m.account_id AND s.tenant_id = m.tenant_id
       LEFT JOIN cash_bank_accounts t2 ON t2.id = m.target_account_id
       WHERE m.id = $1 AND m.tenant_id = current_tenant_id()`,
      [id],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      amount: Number(row.amount),
      exchangeRate: Number(row.exchange_rate),
      baseAmount: Number(row.base_amount),
      balanceBefore: Number(row.balance_before),
      balanceAfter: Number(row.balance_after),
    };
  }

  private async getAccount(id: string, executor: Pool | PoolClient, accountHolder?: string) {
    const result = await executor.query(
      `SELECT * FROM cash_bank_accounts WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    if (result.rows.length === 0) {
      throw new AppError('NOT_FOUND', `${accountHolder} bulunamadı`);
    }
    const account = result.rows[0];
    if (account.status === 'deleted') {
      throw new AppError('FORBIDDEN', `Hesap artık kullanılamıyor: ${account.account_name}`);
    }
    return account;
  }

  async deposit(input: DepositInput, userId: string) {
    const pool = this.getPoolInstance();
    const depositId = newId();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Hesap varlığı/durumu doğrulanır (yoksa veya silinmişse hata fırlatır).
      await this.getAccount(input.accountId, client, 'Hesap');
      const balanceBefore = await this.calculateBalance(input.accountId, client);
      const baseAmount = input.amount * input.exchangeRate;

      await client.query(
        `INSERT INTO cash_bank_movements (id, tenant_id, account_id, movement_type, transaction_date, amount, currency, exchange_rate, reference, description, balance_before, balance_after, related_document_type, related_document_id, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, 'deposit', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          depositId,
          input.accountId,
          input.transactionDate,
          input.amount,
          input.currency,
          input.exchangeRate,
          input.reference || null,
          input.description || null,
          balanceBefore,
          balanceBefore + baseAmount,
          null,
          null,
          userId,
          userId,
        ],
      );

      // Update account balance atomically (base currency = TRY)
      await client.query(
        `UPDATE cash_bank_accounts SET balance = balance + $1, updated_by = $2, updated_at = now()
         WHERE id = $3 AND tenant_id = current_tenant_id()`,
        [baseAmount, userId, input.accountId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getMovementById(depositId);
  }

  async withdrawal(input: WithdrawalInput, userId: string) {
    const pool = this.getPoolInstance();
    const withdrawalId = newId();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Hesap varlığı/durumu doğrulanır (yoksa veya silinmişse hata fırlatır).
      await this.getAccount(input.accountId, client, 'Hesap');
      const balanceBefore = await this.calculateBalance(input.accountId, client);
      const baseAmount = input.amount * input.exchangeRate;

      if (balanceBefore < baseAmount) {
        throw new AppError('INSUFFICIENT_BALANCE', 'Yetersiz bakiye');
      }

      await client.query(
        `INSERT INTO cash_bank_movements (id, tenant_id, account_id, movement_type, transaction_date, amount, currency, exchange_rate, reference, description, balance_before, balance_after, related_document_type, related_document_id, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, 'withdrawal', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          withdrawalId,
          input.accountId,
          input.transactionDate,
          input.amount,
          input.currency,
          input.exchangeRate,
          input.reference || null,
          input.description || null,
          balanceBefore,
          balanceBefore - baseAmount,
          null,
          null,
          userId,
          userId,
        ],
      );

      await client.query(
        `UPDATE cash_bank_accounts SET balance = balance - $1, updated_by = $2, updated_at = now()
         WHERE id = $3 AND tenant_id = current_tenant_id()`,
        [baseAmount, userId, input.accountId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getMovementById(withdrawalId);
  }

  async transfer(input: TransferInput, userId: string) {
    const pool = this.getPoolInstance();
    const transferId = newId();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const sourceAccount = await this.getAccount(input.sourceAccountId, client, 'Kaynak hesap');
      const targetAccount = await this.getAccount(input.targetAccountId, client, 'Hedef hesap');

      if (sourceAccount.account_type === targetAccount.account_type) {
        if (sourceAccount.id === targetAccount.id) {
          throw new AppError('FORBIDDEN', 'Aynı hesaba transfer yapılamaz');
        }
      }

      const balanceBefore = await this.calculateBalance(input.sourceAccountId, client);
      const baseAmount = input.amount * input.exchangeRate;

      if (balanceBefore < baseAmount) {
        throw new AppError('INSUFFICIENT_BALANCE', 'Yetersiz bakiye');
      }

      // Source: withdrawal movement
      await client.query(
        `INSERT INTO cash_bank_movements (id, tenant_id, account_id, movement_type, transaction_date, amount, currency, exchange_rate, reference, description, balance_before, balance_after, related_document_type, related_document_id, target_account_id, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, 'transfer', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
        [
          transferId,
          input.sourceAccountId,
          input.transactionDate,
          input.amount,
          input.currency,
          input.exchangeRate,
          input.reference || null,
          input.description || null,
          balanceBefore,
          balanceBefore - baseAmount,
          null,
          null,
          input.targetAccountId,
          userId,
          userId,
        ],
      );

      // Target: deposit movement (same transfer id as dedup key)
      const targetBalanceBefore = await this.calculateBalance(input.targetAccountId, client);

      await client.query(
        `INSERT INTO cash_bank_movements (id, tenant_id, account_id, movement_type, transaction_date, amount, currency, exchange_rate, reference, description, balance_before, balance_after, related_document_type, related_document_id, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, 'deposit', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          newId(),
          input.targetAccountId,
          input.transactionDate,
          input.amount,
          input.currency,
          input.exchangeRate,
          input.reference || null,
          input.description || null,
          targetBalanceBefore,
          targetBalanceBefore + baseAmount,
          null,
          transferId,
          userId,
          userId,
        ],
      );

      // Update account balances atomically (base currency = TRY)
      await client.query(
        `UPDATE cash_bank_accounts SET balance = balance - $1, updated_by = $2, updated_at = now()
         WHERE id = $3 AND tenant_id = current_tenant_id()`,
        [baseAmount, userId, input.sourceAccountId],
      );

      await client.query(
        `UPDATE cash_bank_accounts SET balance = balance + $1, updated_by = $2, updated_at = now()
         WHERE id = $3 AND tenant_id = current_tenant_id()`,
        [baseAmount, userId, input.targetAccountId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getMovementById(transferId);
  }
}

export const cashBankMovementService = new CashBankMovementService();

export async function deposit(input: DepositInput, userId: string) {
  return cashBankMovementService.deposit(input, userId);
}

export async function withdrawal(input: WithdrawalInput, userId: string) {
  return cashBankMovementService.withdrawal(input, userId);
}

export async function transfer(input: TransferInput, userId: string) {
  return cashBankMovementService.transfer(input, userId);
}

export async function listCashBankMovements(query?: CashBankMovementListQuery) {
  return cashBankMovementService.listMovements(query || ({} as CashBankMovementListQuery));
}

export async function getCashBankMovementById(id: string) {
  return cashBankMovementService.getMovementById(id);
}

export async function cancelMovement(movementId: string, userId: string) {
  const pool = cashBankMovementService.getPoolInstance();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const movement = await cashBankMovementService.getMovementById(movementId);
    if (!movement) throw new AppError('NOT_FOUND', 'Hareket bulunamadı');

    const movementResult = await client.query(
      `SELECT * FROM cash_bank_movements WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [movementId],
    );
    if (movementResult.rows.length === 0) throw new AppError('NOT_FOUND', 'Hareket bulunamadı');
    if (movementResult.rows[0].movement_type === 'transfer') {
      throw new AppError('FORBIDDEN', 'Transfer hareketleri tek başına iptal edilemez');
    }

    const baseAmount = Number(movementResult.rows[0].base_amount);

    // Reverse the balance movement using base_amount
    await client.query(
      `INSERT INTO cash_bank_movements (id, tenant_id, account_id, movement_type, transaction_date, amount, currency, exchange_rate, reference, description, balance_before, balance_after, related_document_type, related_document_id, created_by, updated_by)
       SELECT $1, tenant_id, account_id, CASE WHEN movement_type = 'deposit' THEN 'withdrawal' ELSE 'deposit' END, transaction_date, amount, currency, exchange_rate, reference, description, balance_after, balance_before, 'reversed', $2, $3, $3
       WHERE id = $4`,
      [newId(), movementId, userId, movementId],
    );

    await client.query(
      `UPDATE cash_bank_accounts SET balance = balance ${movementResult.rows[0].movement_type === 'deposit' ? '-' : '+'} $1, updated_by = $2, updated_at = now()
       WHERE id = $3 AND tenant_id = current_tenant_id()`,
      [baseAmount, userId, movementResult.rows[0].account_id],
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
