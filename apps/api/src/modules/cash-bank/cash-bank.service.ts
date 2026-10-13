import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { newId } from '@kuleplus/shared';
import { z } from 'zod';

export const createCashBankAccountSchema = z.object({
  accountType: z.enum(['cash', 'bank']).default('cash'),
  accountName: z.string().min(1),
  accountNumber: z.string().optional(),
  currency: z.string().length(3).default('TRY'),
  description: z.string().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  openingBalance: z.number().nonnegative().default(0),
});

export const updateCashBankAccountSchema = createCashBankAccountSchema.partial();

export const CashBankAccountListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  accountType: z.enum(['cash', 'bank']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  currency: z.string().length(3).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['number', 'accountName', 'balance', 'createdAt', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateCashBankAccountInput = z.infer<typeof createCashBankAccountSchema>;
export type UpdateCashBankAccountInput = z.infer<typeof updateCashBankAccountSchema>;
export type CashBankAccountListQuery = z.infer<typeof CashBankAccountListQuerySchema>;

export interface CashBankAccount {
  id: string;
  accountType: 'cash' | 'bank';
  accountName: string;
  accountNumber?: string;
  currency: string;
  description?: string;
  balance: number;
  status: 'active' | 'inactive';
  openingBalance: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

class CashBankAccountService {
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

  private async withTenantClient<T>(
    tenantId: string | undefined,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = this.getPoolInstance();
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

  async listAccounts(query: CashBankAccountListQuery, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const { page, limit, accountType, status, currency, search, sortBy, sortOrder } = query;
      const offset = (page - 1) * limit;

      const conditions: string[] = ['t.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (accountType) {
        conditions.push(`t.account_type = $${paramIdx}`);
        values.push(accountType);
        paramIdx++;
      }
      if (status) {
        conditions.push(`t.status = $${paramIdx}`);
        values.push(status);
        paramIdx++;
      }
      if (currency) {
        conditions.push(`t.currency = $${paramIdx}`);
        values.push(currency);
        paramIdx++;
      }
      if (search) {
        conditions.push(`(t.account_name ILIKE $${paramIdx} OR t.description ILIKE $${paramIdx})`);
        values.push(`%${search}%`);
        paramIdx++;
      }

      const col =
        {
          number: 't.account_name',
          accountName: 't.account_name',
          createdAt: 't.created_at',
          balance: 't.balance',
          status: 't.status',
        }[sortBy] || 't.created_at';
      const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

      // Tek doğruluk kaynağı: saklı `balance` kolonu (movement.service onu günceller,
      // opening_balance ile başlar). Ayrıca alt sorguyla YENİDEN hesaplamak çift kaynak
      // yaratıyor ve transfer satırlarını (target_account_id) saymadığı için yanlış
      // sonuç veriyordu.
      const [accountsResult, countResult] = await Promise.all([
        client.query(
          `SELECT t.* FROM cash_bank_accounts t
           WHERE ${conditions.join(' AND ')}
           ORDER BY ${col} ${order} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...values, limit, offset],
        ),
        client.query(
          `SELECT COUNT(*) as total FROM cash_bank_accounts t WHERE ${conditions.join(' AND ')}`,
          values,
        ),
      ]);

      return {
        items: accountsResult.rows.map((r: Record<string, unknown>) => ({
          ...r,
          balance: Number(r.balance),
          openingBalance: Number(r.opening_balance),
          accountName: r.account_name,
          accountNumber: r.account_number,
          accountType: r.account_type,
        })),
        page,
        limit,
        total: Number(countResult.rows[0].total),
        totalPages: Math.ceil(Number(countResult.rows[0].total) / limit),
      };
    });
  }

  async getAccountById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const result = await client.query(
        `SELECT t.* FROM cash_bank_accounts t
         WHERE t.id = $1 AND t.tenant_id = current_tenant_id()`,
        [id],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        ...row,
        balance: Number(row.balance),
        openingBalance: Number(row.opening_balance),
        accountName: row.account_name,
        accountNumber: row.account_number,
        accountType: row.account_type,
      };
    });
  }

  async createAccount(input: CreateCashBankAccountInput, userId: string, tenantId?: string) {
    const pool = this.getPoolInstance();
    const accountId = newId();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      }

      await client.query(
        `INSERT INTO cash_bank_accounts (id, tenant_id, account_type, account_name, account_number, currency, description, status, opening_balance, balance, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8, $9, $9)`,
        [
          accountId,
          input.accountType,
          input.accountName,
          input.accountNumber || null,
          input.currency,
          input.description || null,
          input.status,
          input.openingBalance,
          userId,
        ],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getAccountById(accountId, tenantId);
  }

  async updateAccount(
    id: string,
    input: UpdateCashBankAccountInput,
    userId: string,
    tenantId?: string,
  ) {
    const pool = this.getPoolInstance();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      }

      await client.query(
        `UPDATE cash_bank_accounts 
         SET account_type = COALESCE($1, account_type),
             account_name = COALESCE($2, account_name),
             account_number = COALESCE($3, account_number),
             currency = COALESCE($4, currency),
             description = COALESCE($5, description),
             status = COALESCE($6, status),
             opening_balance = COALESCE($7, opening_balance),
             updated_by = $8, updated_at = now()
         WHERE id = $9 AND tenant_id = current_tenant_id()`,
        [
          input.accountType || null,
          input.accountName || null,
          input.accountNumber || null,
          input.currency || null,
          input.description || null,
          input.status || null,
          input.openingBalance ?? null,
          userId,
          id,
        ],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getAccountById(id, tenantId);
  }

  async deleteAccount(id: string, tenantId?: string) {
    const pool = this.getPoolInstance();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      }

      const account = await client.query(
        `SELECT * FROM cash_bank_accounts WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [id],
      );
      if (account.rows.length === 0) throw new AppError('NOT_FOUND', 'Cash/Bank account not found');
      if (account.rows[0].status !== 'active')
        throw new AppError('FORBIDDEN', 'Only active accounts can be deleted');

      await client.query(
        `UPDATE cash_bank_accounts SET status = 'deleted', updated_at = now() WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [id],
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
}

export const cashBankAccountService = new CashBankAccountService();

export async function createCashBankAccount(
  input: CreateCashBankAccountInput,
  userId: string,
  tenantId?: string,
) {
  return cashBankAccountService.createAccount(input, userId, tenantId);
}

export async function getCashBankAccountById(id: string, tenantId?: string) {
  return cashBankAccountService.getAccountById(id, tenantId);
}

export async function listCashBankAccounts(query?: CashBankAccountListQuery, tenantId?: string) {
  return cashBankAccountService.listAccounts(query || ({} as CashBankAccountListQuery), tenantId);
}

export async function updateCashBankAccount(
  id: string,
  input: UpdateCashBankAccountInput,
  userId: string,
  tenantId?: string,
) {
  return cashBankAccountService.updateAccount(id, input, userId, tenantId);
}

export async function deleteCashBankAccount(id: string, tenantId?: string) {
  return cashBankAccountService.deleteAccount(id, tenantId);
}
