import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { ensureChartOfAccountsOn } from './chart';
import type {
  CreateAccountInput,
  UpdateAccountInput,
  CreatePeriodInput,
  UpdatePeriodInput,
  CreatePeriodLockInput,
  UpdatePeriodLockInput,
  CreateJournalEntryInput,
  UpdateJournalEntryInput,
  JournalLineInput,
  CreatePostingRuleInput,
  UpdatePostingRuleInput,
  CreateAccountMappingInput,
  UpdateAccountMappingInput,
} from './schemas';

/**
 * Muhasebe Fişleri servisi - SPEC §15 + §10.5.
 *
 * Tenant izolasyonu iki katmanlidir:
 *  - API katmani `tenantContext` ile istek-scoped GUC kurar (RLS),
 *  - servis kendi açik transaction'inda `set_config('app.tenant_id', ...)` kurar
 *    (cash-bank/expense deseni). Boylece testler ve bagimsiz cagrilar da güvenli.
 *
 * Guard'lar serviste zorunludur (ROADMAP §0.2 'servis + transaction + DB'):
 *  - Denge: borc = alacak (fis onayinda) -> servis + DB trigger,
 *  - Dönem kilidi: kapali döneme kayit -> PERIOD_LOCKED (409),
 *  - Hesap kontrolü: hareketli / TDHP hesabi silinemez,
 *  - Gap-free yevmiye numarasi (onayda, advisory lock ile),
 *  - Kaynak iliskisi: ayni kaynak ikinci kez otomatik fis üretemez (kismi UNIQUE).
 */
export class AccountingService {
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
       VALUES ($1, current_tenant_id(), $2, $3, 'journal_entries', $4, $5, $6, now())`,
      [
        newId(),
        entry.userId ?? null,
        `journal_entries.${entry.action}`,
        entry.entityId,
        entry.oldValues ? JSON.stringify(entry.oldValues) : null,
        entry.newValues ? JSON.stringify(entry.newValues) : null,
      ],
    );
  }

  /** Kapali dönem kontrolü - dönem kilidi varsa ve tarih kilidin öncesindeyse engel. */
  private async assertPeriodOpen(client: PoolClient, entryDate: string): Promise<void> {
    const period = await client.query(
      `SELECT fp.status,
              (SELECT TRUE FROM period_locks pl
                 WHERE pl.period_id = fp.id AND pl.lock_date > $1
                 LIMIT 1) AS locked
         FROM fiscal_periods fp
        WHERE fp.tenant_id = current_tenant_id()
          AND $1 BETWEEN fp.start_date AND fp.end_date
        LIMIT 1`,
      [entryDate],
    );
    const row = period.rows[0];
    if (!row) return;
    if (row.status === 'closed') {
      throw new AppError('PERIOD_LOCKED', 'Bu mali dönem kapatilmis.');
    }
    if (row.locked) {
      throw new AppError('PERIOD_LOCKED', 'Bu tarih dönem kilidinin gerisinde.');
    }
  }

  /** Hesap ekstresi toplamini hesaplar (varsa hareket oldugunu anlamak için). */
  private async accountHasMovement(client: PoolClient, accountId: string): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE jl.account_id = $1 AND je.tenant_id = current_tenant_id()
        AND je.status = 'posted' LIMIT 1`,
      [accountId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** TDHP sablonunu tenant'a bootstrap eder (ROADMAP T-5.1); idempotent. */
  async ensureChartOfAccounts(tenantId?: string): Promise<number> {
    return this.withTenantClient(tenantId, (client) => ensureChartOfAccountsOn(client));
  }

  async listAccountingAccounts(query: Record<string, unknown>, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const page = Number(query.page ?? 1);
      const limit = Math.min(Number(query.limit ?? 50), 100);
      const q = (query.q as string)?.trim();
      const offset = (page - 1) * limit;
      const conditions: string[] = ['a.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (q) {
        conditions.push(`(a.code ILIKE $${i} OR a.name ILIKE $${i})`);
        values.push(`%${q}%`);
        i++;
      }
      if (query.type) {
        conditions.push(`a.type = $${i}`);
        values.push(query.type);
        i++;
      }
      if (query.only_posting === 'true' || query.only_posting === true) {
        conditions.push(`a.type = 'detail'`);
      }
      const where = conditions.join(' AND ');
      const [list, count] = await Promise.all([
        client.query(
          `SELECT a.* FROM accounting_accounts a WHERE ${where} ORDER BY a.code ASC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM accounting_accounts a WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapAccountRow),
        page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  async getAccountById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM accounting_accounts WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) return null;
      return mapAccountRow(r.rows[0]);
    });
  }

  async createAccount(input: CreateAccountInput, userId: string, tenantId?: string) {
    const accountId = newId();
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO accounting_accounts
           (id, tenant_id, code, name, type, parent_id, is_tdphp, is_active, opening_debit, opening_credit, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [
          accountId,
          input.code,
          input.name,
          input.type,
          input.parent_id ?? null,
          input.is_tdphp,
          input.is_active,
          input.opening_debit,
          input.opening_credit,
          userId,
        ],
      );
      return this.getAccountById(accountId, tenantId);
    });
  }

  async updateAccount(id: string, input: UpdateAccountInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `UPDATE accounting_accounts SET
           code = COALESCE($1, code),
           name = COALESCE($2, name),
           type = COALESCE($3, type),
           parent_id = COALESCE($4, parent_id),
           is_active = COALESCE($5, is_active),
           opening_debit = COALESCE($6, opening_debit),
           opening_credit = COALESCE($7, opening_credit),
           updated_by = $8, updated_at = now()
         WHERE id = $9 AND tenant_id = current_tenant_id()`,
        [
          input.code ?? null,
          input.name ?? null,
          input.type ?? null,
          input.parent_id ?? null,
          input.is_active ?? null,
          input.opening_debit ?? null,
          input.opening_credit ?? null,
          userId,
          id,
        ],
      );
      return this.getAccountById(id, tenantId);
    });
  }

  /** Hesap silme - SPEC §15 "hareketli hesap silinemez". */
  async deleteAccount(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM accounting_accounts WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      if (found.rows[0].is_tdphp) {
        throw new AppError('FORBIDDEN', 'TDHP hesabi silinemez; pasife alin.');
      }
      const hasMovement = await this.accountHasMovement(client, id);
      if (hasMovement) {
        throw new AppError('FORBIDDEN', 'Hareketli hesap silinemez (SPEC §15)');
      }
      await client.query(
        'UPDATE accounting_accounts SET is_active = false, updated_at = now() WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      return { success: true };
    });
  }

  // ==================== Yevmiye Fişleri ====================

  async listJournalEntries(query: Record<string, unknown>, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const page = Number(query.page ?? 1);
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = (page - 1) * limit;
      const conditions: string[] = ['e.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      const status = query.status as string | undefined;
      const type = query.entry_type as string | undefined;
      const from = query.entry_date_from as string | undefined;
      const to = query.entry_date_to as string | undefined;
      const q = (query.q as string)?.trim();
      if (status) {
        conditions.push(`e.status = $${i}`);
        values.push(status);
        i++;
      }
      if (type) {
        conditions.push(`e.entry_type = $${i}`);
        values.push(type);
        i++;
      }
      if (from) {
        conditions.push(`e.entry_date >= $${i}`);
        values.push(from);
        i++;
      }
      if (to) {
        conditions.push(`e.entry_date <= $${i}`);
        values.push(to);
        i++;
      }
      if (q) {
        conditions.push(`( e.description ILIKE $${i} OR e.entry_no::text ILIKE $${i})`);
        values.push(`%${q}%`);
        i++;
      }
      const where = conditions.join(' AND ');
      const [list, count] = await Promise.all([
        client.query(
          `SELECT e.* FROM journal_entries e WHERE ${where} ORDER BY e.entry_date DESC, e.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM journal_entries e WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapEntryRow),
        page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  async getEntryById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) return null;
      const header = mapEntryRow(r.rows[0]);
      const lines = await client.query(
        `SELECT l.*, a.code AS account_code, a.name AS account_name
           FROM journal_lines l
           JOIN accounting_accounts a ON a.id = l.account_id AND a.tenant_id = current_tenant_id()
          WHERE l.entry_id = $1 AND l.tenant_id = current_tenant_id()
          ORDER BY l.line_no`,
        [id],
      );
      return { ...header, lines: lines.rows.map(mapLineRow) };
    });
  }

  /** Satir dogrulama: tek tarafli, bos degil; dengeli olmali. */
  private validateLines(lines: JournalLineInput[]): { debit: number; credit: number } {
    if (lines.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Fisde en az bir satir olmali');
    }
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      const d = Number(l.debit ?? 0);
      const c = Number(l.credit ?? 0);
      if (d < 0 || c < 0) throw new AppError('VALIDATION_ERROR', 'Negatif tutar girilemez');
      if (d > 0 && c > 0)
        throw new AppError('VALIDATION_ERROR', 'Satir tek tarafli olmali (borc veya alacak)');
      if (d === 0 && c === 0) throw new AppError('VALIDATION_ERROR', 'Bos satir girilemez');
      debit += d;
      credit += c;
    }
    return { debit, credit };
  }

  /** Fis olusturur; status=posted ise onaylar (denge + donem + gap-free). */
  async createEntry(input: CreateJournalEntryInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const totals = this.validateLines(input.lines);
      const postNow = input.status === 'posted';
      if (postNow && totals.debit !== totals.credit) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Fis dengeli degil: borc ${totals.debit} != alacak ${totals.credit} (SPEC §10.5)`,
        );
      }
      if (postNow) await this.assertPeriodOpen(client, input.entry_date);

      const entryId = newId();
      let entryNo: number | null = null;
      if (postNow) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          (tenantId ?? 'app').toString(),
        ]);
        const seq = await client.query(
          'SELECT COALESCE(MAX(entry_no), 0) + 1 AS next_no FROM journal_entries WHERE tenant_id = current_tenant_id()',
        );
        entryNo = Number(seq.rows[0].next_no);
      }

      await client.query(
        `INSERT INTO journal_entries
           (id, tenant_id, entry_no, entry_date, period_id, entry_type, status, description,
            source_type, source_id, reversal_of_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
        [
          entryId,
          entryNo,
          input.entry_date,
          input.period_id ?? null,
          input.entry_type,
          input.status,
          input.description,
          input.source_type ?? null,
          input.source_id ?? null,
          null,
          totals.debit,
          totals.credit,
          postNow ? userId : null,
          postNow ? new Date() : null,
          userId,
        ],
      );
      await this.insertLines(client, entryId, input.lines, userId);
      await this.writeAudit(client, {
        userId,
        action: 'create',
        entityId: entryId,
        newValues: {
          entry_no: entryNo,
          entry_date: input.entry_date,
          entry_type: input.entry_type,
          status: input.status,
          description: input.description,
          total_debit: totals.debit,
          total_credit: totals.credit,
        },
      });
      return { id: entryId, entryNo, status: input.status, totals };
    });
  }

  private async insertLines(
    client: PoolClient,
    entryId: string,
    lines: JournalLineInput[],
    userId: string,
  ): Promise<void> {
    let lineNo = 1;
    for (const l of lines) {
      await client.query(
        `INSERT INTO journal_lines
           (id, tenant_id, entry_id, line_no, account_id, description, debit, credit, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8)`,
        [newId(), entryId, lineNo, l.account_id, l.description ?? '', l.debit, l.credit, userId],
      );
      lineNo++;
    }
  }

  /** Onayli fisi ters kayitla duzeltir (SPEC §15). */
  async reverseEntry(id: string, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Fis bulunamadi');
      if (found.rows[0].status !== 'posted')
        throw new AppError('FORBIDDEN', 'Yalnizca onayli fis ters kaydedilir');
      const orig = found.rows[0];
      await this.assertPeriodOpen(client, orig.entry_date);

      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        (tenantId ?? 'app').toString(),
      ]);
      const seq = await client.query(
        'SELECT COALESCE(MAX(entry_no), 0) + 1 AS next_no FROM journal_entries WHERE tenant_id = current_tenant_id()',
      );
      const entryNo = Number(seq.rows[0].next_no);
      const reversalId = newId();

      await client.query(
        `INSERT INTO journal_entries
           (id, tenant_id, entry_no, entry_date, period_id, entry_type, status, description,
            source_type, source_id, reversal_of_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, 'posted', $6, $7, $8, $9, $10, $11, $11, now(), $11, $11)`,
        [
          reversalId,
          entryNo,
          orig.entry_date,
          orig.period_id,
          'ters',
          `${orig.description} - TERS KAYIT`,
          orig.source_type,
          orig.source_id,
          id,
          orig.total_credit,
          orig.total_debit,
          userId,
        ],
      );

      const lines = await client.query(
        'SELECT line_no, account_id, description, debit, credit FROM journal_lines WHERE entry_id = $1 ORDER BY line_no',
        [id],
      );
      for (const l of lines.rows) {
        await client.query(
          `INSERT INTO journal_lines
             (id, tenant_id, entry_id, line_no, account_id, description, debit, credit, created_by, updated_by)
           VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8)`,
          [newId(), reversalId, l.line_no, l.account_id, l.description, l.credit, l.debit, userId],
        );
      }
      await this.writeAudit(client, {
        userId,
        action: 'reverse',
        entityId: id,
        newValues: { reversal_id: reversalId, reversal_entry_no: entryNo },
      });
      return { id: reversalId, entryNo, status: 'posted' as const };
    });
  }

  /** Onayli fisi iptal eder (finansal belgede fiziksel silme yok - SPEC §0). */
  async cancelEntry(id: string, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      if (found.rows[0].status === 'posted')
        throw new AppError('FORBIDDEN', 'Onayli fis iptal edilemez; ters kayit kullanin');
      if (found.rows[0].status === 'cancelled') return { success: true };
      await client.query(
        `UPDATE journal_entries SET status = 'cancelled', updated_by = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = current_tenant_id()`,
        [userId, id],
      );
      await this.writeAudit(client, {
        userId,
        action: 'cancel',
        entityId: id,
        oldValues: { status: found.rows[0].status },
        newValues: { status: 'cancelled' },
      });
      return { success: true };
    });
  }

  /** Fisi gunceller; draft fislerde fis numarasi degismez. */
  async updateEntry(id: string, input: UpdateJournalEntryInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Fis bulunamadi');
      if (found.rows[0].status === 'posted')
        throw new AppError('FORBIDDEN', 'Onayli fis guncellenemez');
      const totals = this.validateLines(input.lines ?? []);
      const postNow = input.status === 'posted';
      if (postNow && totals.debit !== totals.credit) {
        throw new AppError('VALIDATION_ERROR', 'Fis dengeli degil (SPEC §10.5)');
      }
      if (postNow)
        await this.assertPeriodOpen(client, input.entry_date ?? found.rows[0].entry_date);

      await client.query(
        `UPDATE journal_entries SET
           entry_date = COALESCE($1, entry_date),
           period_id = COALESCE($2, period_id),
           entry_type = COALESCE($3, entry_type),
           description = COALESCE($4, description),
           status = COALESCE($5, status),
           total_debit = COALESCE($6, total_debit),
           total_credit = COALESCE($7, total_credit),
           updated_by = $8, updated_at = now()
         WHERE id = $9 AND tenant_id = current_tenant_id()`,
        [
          input.entry_date ?? null,
          input.period_id ?? null,
          input.entry_type ?? null,
          input.description ?? null,
          input.status ?? null,
          totals.debit,
          totals.credit,
          userId,
          id,
        ],
      );
      await this.deleteLines(client, id);
      await this.insertLines(client, id, input.lines ?? [], userId);
      await this.writeAudit(client, {
        userId,
        action: 'update',
        entityId: id,
        oldValues: found.rows[0],
        newValues: {
          entry_date: input.entry_date ?? found.rows[0].entry_date,
          entry_type: input.entry_type ?? found.rows[0].entry_type,
          status: input.status ?? found.rows[0].status,
          description: input.description ?? found.rows[0].description,
          total_debit: totals.debit,
          total_credit: totals.credit,
        },
      });
      return this.getEntryById(id, tenantId);
    });
  }

  private async deleteLines(client: PoolClient, entryId: string) {
    await client.query(
      'DELETE FROM journal_lines WHERE entry_id = $1 AND tenant_id = current_tenant_id()',
      [entryId],
    );
  }

  /** Fis siler; draft fislerde silinir, onayli fislerde iptal edilir. */
  async deleteEntry(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      if (found.rows[0].status === 'posted')
        throw new AppError('FORBIDDEN', 'Onayli fis silinemez; iptal edilir');
      if (found.rows[0].status === 'cancelled') return { success: true };
      await client.query(
        'DELETE FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      await this.writeAudit(client, {
        action: 'delete',
        entityId: id,
        oldValues: found.rows[0],
      });
      return { success: true };
    });
  }

  // ==================== Fis Satirlari ====================

  async listJournalLines(query: Record<string, unknown>, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const page = Number(query.page ?? 1);
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = (page - 1) * limit;
      const conditions: string[] = ['l.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      const entryId = query.entry_id as string | undefined;
      const accountId = query.account_id as string | undefined;
      const q = (query.q as string)?.trim();
      if (entryId) {
        conditions.push(`l.entry_id = $${i}`);
        values.push(entryId);
        i++;
      }
      if (accountId) {
        conditions.push(`l.account_id = $${i}`);
        values.push(accountId);
        i++;
      }
      if (q) {
        conditions.push(`l.description ILIKE $${i}`);
        values.push(`%${q}%`);
        i++;
      }
      const where = conditions.join(' AND ');
      const [list, count] = await Promise.all([
        client.query(
          `SELECT l.*, a.code AS account_code, a.name AS account_name
             FROM journal_lines l
             JOIN accounting_accounts a ON a.id = l.account_id AND a.tenant_id = current_tenant_id()
           WHERE ${where} ORDER BY l.line_no ASC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM journal_lines l WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapLineRow),
        page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  async getLineById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM journal_lines WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) return null;
      const row = mapLineRow(r.rows[0]);
      const account = await client.query(
        'SELECT code, name FROM accounting_accounts WHERE id = $1 AND tenant_id = current_tenant_id()',
        [row.account_id],
      );
      return { ...row, account: account.rows[0] };
    });
  }

  async createLine(input: JournalLineInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const entry = await client.query(
        'SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id()',
        [input.entry_id],
      );
      if (entry.rows.length === 0) throw new AppError('NOT_FOUND', 'Fis bulunamadi');
      if (entry.rows[0].status !== 'draft')
        throw new AppError('FORBIDDEN', 'Yalnizca draft fislerde satir eklenebilir');
      const lineId = newId();
      await client.query(
        `INSERT INTO journal_lines (id, tenant_id, entry_id, line_no, account_id, description, debit, credit, created_by, updated_by)
           VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          lineId,
          input.entry_id,
          input.line_no,
          input.account_id,
          input.description ?? '',
          input.debit,
          input.credit,
          userId,
        ],
      );
      return this.getLineById(lineId, tenantId);
    });
  }

  async updateLine(id: string, input: JournalLineInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        `SELECT je.status FROM journal_lines l
           JOIN journal_entries je ON je.id = l.entry_id AND je.tenant_id = current_tenant_id()
          WHERE l.id = $1 AND l.tenant_id = current_tenant_id()`,
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      if (found.rows[0].status === 'posted')
        throw new AppError('FORBIDDEN', 'Onayli fis satiri guncellenemez');
      await client.query(
        `UPDATE journal_lines SET
           line_no = COALESCE($1, line_no),
           account_id = COALESCE($2, account_id),
           description = COALESCE($3, description),
           debit = COALESCE($4, debit),
           credit = COALESCE($5, credit),
           updated_by = $6, updated_at = now()
         WHERE id = $7 AND tenant_id = current_tenant_id()`,
        [
          input.line_no ?? null,
          input.account_id ?? null,
          input.description ?? null,
          input.debit ?? null,
          input.credit ?? null,
          userId,
          id,
        ],
      );
      return this.getLineById(id, tenantId);
    });
  }

  /** Satir siler; ust fisin durumuna bakar (satirda status kolonu yok). */
  async deleteLine(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        `SELECT je.status FROM journal_lines l
           JOIN journal_entries je ON je.id = l.entry_id AND je.tenant_id = current_tenant_id()
          WHERE l.id = $1 AND l.tenant_id = current_tenant_id()`,
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      if (found.rows[0].status === 'posted')
        throw new AppError('FORBIDDEN', 'Onayli fis satiri silinemez');
      await client.query(
        'DELETE FROM journal_lines WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      return { success: true };
    });
  }

  // ==================== Mali Dönem ====================

  async listFiscalPeriods(query: Record<string, unknown>, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const page = Number(query.page ?? 1);
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = (page - 1) * limit;
      const conditions: string[] = ['p.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      const year = query.year as number | undefined;
      const status = query.status as string | undefined;
      const q = (query.q as string)?.trim();
      if (year) {
        conditions.push(`p.year = $${i}`);
        values.push(year);
        i++;
      }
      if (status) {
        conditions.push(`p.status = $${i}`);
        values.push(status);
        i++;
      }
      if (q) {
        conditions.push(`p.label ILIKE $${i}`);
        values.push(`%${q}%`);
        i++;
      }
      const where = conditions.join(' AND ');
      const [list, count] = await Promise.all([
        client.query(
          `SELECT p.* FROM fiscal_periods p WHERE ${where} ORDER BY p.year DESC, p.start_date DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM fiscal_periods p WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapPeriodRow),
        page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  async getPeriodById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM fiscal_periods WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) return null;
      return mapPeriodRow(r.rows[0]);
    });
  }

  async createPeriod(input: CreatePeriodInput, userId: string, tenantId?: string) {
    const periodId = newId();
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO fiscal_periods (id, tenant_id, label, year, start_date, end_date, status, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $7)`,
        [
          periodId,
          input.label,
          input.year,
          input.start_date,
          input.end_date,
          input.status || 'open',
          userId,
        ],
      );
      return this.getPeriodById(periodId, tenantId);
    });
  }

  async updatePeriod(id: string, input: UpdatePeriodInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `UPDATE fiscal_periods SET
           label = COALESCE($1, label),
           year = COALESCE($2, year),
           start_date = COALESCE($3, start_date),
           end_date = COALESCE($4, end_date),
           status = COALESCE($5, status),
           updated_by = $6, updated_at = now()
         WHERE id = $7 AND tenant_id = current_tenant_id()`,
        [
          input.label ?? null,
          input.year ?? null,
          input.start_date ?? null,
          input.end_date ?? null,
          input.status ?? null,
          userId,
          id,
        ],
      );
      return this.getPeriodById(id, tenantId);
    });
  }

  async deletePeriod(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM fiscal_periods WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      if (found.rows[0].status !== 'closed') {
        throw new AppError('FORBIDDEN', 'Acik dönem silinemez');
      }
      await client.query(
        'DELETE FROM fiscal_periods WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      return { success: true };
    });
  }

  // ==================== Dönem Kilidi ====================

  async listPeriodLocks(query: Record<string, unknown>, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const page = Number(query.page ?? 1);
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = (page - 1) * limit;
      const conditions: string[] = ['pl.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      const periodId = query.period_id as string | undefined;
      if (periodId) {
        conditions.push(`pl.period_id = $${i}`);
        values.push(periodId);
        i++;
      }
      const where = conditions.join(' AND ');
      const [list, count] = await Promise.all([
        client.query(
          `SELECT pl.* FROM period_locks pl WHERE ${where} ORDER BY pl.lock_date DESC, pl.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM period_locks pl WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapLockRow),
        page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  async getLockById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM period_locks WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) return null;
      return mapLockRow(r.rows[0]);
    });
  }

  async createLock(input: CreatePeriodLockInput, userId: string, tenantId?: string) {
    const lockId = newId();
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO period_locks (id, tenant_id, period_id, lock_date, reason, locked_by, locked_at, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, now(), $6, $6)`,
        [lockId, input.period_id, input.lock_date, input.reason || '', userId, userId],
      );
      return this.getLockById(lockId, tenantId);
    });
  }

  async updateLock(id: string, input: UpdatePeriodLockInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `UPDATE period_locks SET
           period_id = COALESCE($1, period_id),
           lock_date = COALESCE($2, lock_date),
           reason = COALESCE($3, reason),
           updated_by = $4, updated_at = now()
         WHERE id = $5 AND tenant_id = current_tenant_id()`,
        [input.period_id ?? null, input.lock_date ?? null, input.reason ?? null, userId, id],
      );
      return this.getLockById(id, tenantId);
    });
  }

  async deleteLock(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM period_locks WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      await client.query(
        'DELETE FROM period_locks WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      return { success: true };
    });
  }

  // ==================== Posting Kurallari ====================

  async listPostingRules(query: Record<string, unknown>, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const page = Number(query.page ?? 1);
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = (page - 1) * limit;
      const conditions: string[] = ['pr.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      const code = query.code as string | undefined;
      const name = query.name as string | undefined;
      const is_active = query.is_active as string | undefined;
      if (code) {
        conditions.push(`pr.code = $${i}`);
        values.push(code);
        i++;
      }
      if (name) {
        conditions.push(`pr.name = $${i}`);
        values.push(name);
        i++;
      }
      if (is_active) {
        conditions.push(`pr.is_active = $${i}`);
        values.push(is_active);
        i++;
      }
      const where = conditions.join(' AND ');
      const [list, count] = await Promise.all([
        client.query(
          `SELECT pr.* FROM posting_rules pr WHERE ${where} ORDER BY pr.code ASC, pr.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM posting_rules pr WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapRuleRow),
        page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  async getRuleById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM posting_rules WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) return null;
      return mapRuleRow(r.rows[0]);
    });
  }

  async createRule(input: CreatePostingRuleInput, userId: string, tenantId?: string) {
    const ruleId = newId();
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO posting_rules (id, tenant_id, code, name, config, is_active, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $6)`,
        [ruleId, input.code, input.name, input.config || '{}', input.is_active || true, userId],
      );
      return this.getRuleById(ruleId, tenantId);
    });
  }

  async updateRule(id: string, input: UpdatePostingRuleInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `UPDATE posting_rules SET
           code = COALESCE($1, code),
           name = COALESCE($2, name),
           config = COALESCE($3, config),
           is_active = COALESCE($4, is_active),
           updated_by = $5, updated_at = now()
         WHERE id = $6 AND tenant_id = current_tenant_id()`,
        [
          input.code ?? null,
          input.name ?? null,
          input.config || '{}',
          input.is_active || true,
          userId,
          id,
        ],
      );
      return this.getRuleById(id, tenantId);
    });
  }

  async deleteRule(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM posting_rules WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      await client.query(
        'DELETE FROM posting_rules WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      return { success: true };
    });
  }

  // ==================== Hesap Eşleme ====================

  async listAccountMappings(query: Record<string, unknown>, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const page = Number(query.page ?? 1);
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = (page - 1) * limit;
      const conditions: string[] = ['am.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      const sourceType = query.source_type as string | undefined;
      const direction = query.direction as string | undefined;
      if (sourceType) {
        conditions.push(`am.source_type = $${i}`);
        values.push(sourceType);
        i++;
      }
      if (direction) {
        conditions.push(`am.direction = $${i}`);
        values.push(direction);
        i++;
      }
      const where = conditions.join(' AND ');
      const [list, count] = await Promise.all([
        client.query(
          `SELECT am.* FROM account_mappings am WHERE ${where} ORDER BY am.source_type ASC, am.direction ASC, am.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM account_mappings am WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapMappingRow),
        page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  async getMappingById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM account_mappings WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) return null;
      return mapMappingRow(r.rows[0]);
    });
  }

  async createMapping(input: CreateAccountMappingInput, userId: string, tenantId?: string) {
    const mappingId = newId();
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO account_mappings (id, tenant_id, source_type, account_id, direction, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $5)`,
        [mappingId, input.source_type, input.account_id, input.direction || 'debit', userId],
      );
      return this.getMappingById(mappingId, tenantId);
    });
  }

  async updateMapping(
    id: string,
    input: UpdateAccountMappingInput,
    userId: string,
    tenantId?: string,
  ) {
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `UPDATE account_mappings SET
           source_type = COALESCE($1, source_type),
           account_id = COALESCE($2, account_id),
           direction = COALESCE($3, direction),
           updated_by = $4, updated_at = now()
         WHERE id = $5 AND tenant_id = current_tenant_id()`,
        [
          input.source_type || null,
          input.account_id || null,
          input.direction || 'debit',
          userId,
          id,
        ],
      );
      return this.getMappingById(id, tenantId);
    });
  }

  async deleteMapping(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM account_mappings WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      await client.query(
        'DELETE FROM account_mappings WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      return { success: true };
    });
  }

  // ==================== Denge Kurali ====================

  async getNextEntryNo(tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const seq = await client.query(
        'SELECT COALESCE(MAX(entry_no), 0) + 1 AS next_no FROM journal_entries WHERE tenant_id = current_tenant_id()',
      );
      return Number(seq.rows[0].next_no);
    });
  }

  // ==================== Muhasebe Raporları (Faz 5) ====================
  //
  // Tüm raporlar yalnızca onaylı (`posted`) fişleri dikkate alır (SPEC §15).
  // Hesap kodu ilk hanesine göre sınıf: 1 Dönen + 2 Duran (aktif),
  // 3 Kısa + 4 Uzun Yabancı Kaynak + 5 Öz Kaynak (pasif), 6 Gelir + 7 Maliyet.

  /** Rapor tarih aralığı varsayılanları (yıl başı → bugün). */
  private normalizeRange(input: { from?: string; to?: string }): { from: string; to: string } {
    const today = new Date().toISOString().slice(0, 10);
    return { from: input.from ?? `${today.slice(0, 4)}-01-01`, to: input.to ?? today };
  }

  /** Hesap kodundan prefix grubu toplamı (debit/credit) çıkarır. */
  private summarizeByPrefix(rows: DbRow[], length: number) {
    const map = new Map<string, { debit: number; credit: number }>();
    for (const row of rows) {
      const key = String(row.code).slice(0, length);
      const entry = map.get(key) ?? { debit: 0, credit: 0 };
      entry.debit += Number(row.debit ?? 0);
      entry.credit += Number(row.credit ?? 0);
      map.set(key, entry);
    }
    return map;
  }

  /** Onaylı fiş satırlarını hesap bazında toplar (opsiyonel tarih aralığı). */
  private async aggregateAccountBalances(
    client: PoolClient,
    from: string | null,
    to: string,
  ): Promise<DbRow[]> {
    const conditions = ["je.status = 'posted'", 'je.entry_date <= $1'];
    const values: unknown[] = [to];
    if (from) {
      conditions.push('je.entry_date >= $2');
      values.push(from);
    }
    const result = await client.query(
      `SELECT aa.code, aa.name, aa.type,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit ELSE 0 END), 0) AS debit,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit ELSE 0 END), 0) AS credit
         FROM accounting_accounts aa
         LEFT JOIN journal_lines jl
           ON jl.account_id = aa.id AND jl.tenant_id = aa.tenant_id
         LEFT JOIN journal_entries je
           ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
          AND ${conditions.join(' AND ')}
        WHERE aa.tenant_id = current_tenant_id()
        GROUP BY aa.code, aa.name, aa.type
        ORDER BY aa.code`,
      values,
    );
    return result.rows as DbRow[];
  }

  /** Mizan (mizan-ı umumi): dönem aralığında hesap bazında borç/alacak/bakiye. */
  async trialBalance(input: { from?: string; to?: string }, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const { from, to } = this.normalizeRange(input);
      const rows = await this.aggregateAccountBalances(client, from, to);
      let totalDebit = 0;
      let totalCredit = 0;
      const accounts = rows
        .map((row) => {
          const debit = Number(row.debit);
          const credit = Number(row.credit);
          return {
            code: String(row.code),
            name: row.name,
            type: row.type,
            debit,
            credit,
            balance: debit - credit,
          };
        })
        .filter((a) => a.debit !== 0 || a.credit !== 0);
      for (const a of accounts) {
        totalDebit += a.debit;
        totalCredit += a.credit;
      }
      return {
        from,
        to,
        accounts,
        totalDebit,
        totalCredit,
        balanced: Math.abs(totalDebit - totalCredit) < 0.005,
      };
    });
  }

  /** Bilanço (dönem sonu itibarıyla kümülatif). */
  async balanceSheet(input: { as_of?: string }, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const asOf = input.as_of ?? new Date().toISOString().slice(0, 10);
      const rows = await this.aggregateAccountBalances(client, null, asOf);
      const g = this.summarizeByPrefix(rows, 1);
      const signed = (prefix: string) => {
        const e = g.get(prefix) ?? { debit: 0, credit: 0 };
        return e.debit - e.credit;
      };
      const donenVarliklar = signed('1');
      const duranVarliklar = signed('2');
      const kisaVadeliYabanciKaynaklar = -signed('3');
      const uzunVadeliYabanciKaynaklar = -signed('4');
      const ozKaynaklar = -signed('5');
      // Dönem sonucu (6 gelir − 7 gider): 6 alacak ağırlıklı, 7 borç ağırlıklı.
      const donemNetKar = -(signed('6') + signed('7'));
      const aktifToplam = donenVarliklar + duranVarliklar;
      const pasifToplam =
        kisaVadeliYabanciKaynaklar + uzunVadeliYabanciKaynaklar + ozKaynaklar + donemNetKar;
      return {
        as_of: asOf,
        aktif: { donenVarliklar, duranVarliklar, toplam: aktifToplam },
        pasif: {
          kisaVadeliYabanciKaynaklar,
          uzunVadeliYabanciKaynaklar,
          ozKaynaklar,
          donemNetKar,
          toplam: pasifToplam,
        },
        balanced: Math.abs(aktifToplam - pasifToplam) < 0.005,
      };
    });
  }

  /** Gelir tablosu (dönem aralığı) — TDHP 6/7 grubu. */
  async incomeStatement(input: { from?: string; to?: string }, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const { from, to } = this.normalizeRange(input);
      const rows = await this.aggregateAccountBalances(client, from, to);
      const g = this.summarizeByPrefix(rows, 2);
      const cr = (prefix: string) => g.get(prefix)?.credit ?? 0;
      const dr = (prefix: string) => g.get(prefix)?.debit ?? 0;

      const brutSatislar = cr('60');
      const satisIndirimleri = dr('61');
      const netSatislar = brutSatislar - satisIndirimleri;
      const satislarinMaliyeti = dr('62');
      const brutKar = netSatislar - satislarinMaliyeti;
      const faaliyetGiderleri = dr('63');
      const faaliyetKari = brutKar - faaliyetGiderleri;
      const digerFaaliyetGelirleri = cr('64');
      const digerFaaliyetGiderleri = dr('65');
      const finansmanGiderleri = dr('66');
      const olaganDisiGelirler = cr('67');
      const olaganDisiGiderler = dr('68');
      const vergiKarsiligi = rows
        .filter((row) => String(row.code).startsWith('691'))
        .reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
      const donemNetKari =
        faaliyetKari +
        digerFaaliyetGelirleri -
        digerFaaliyetGiderleri -
        finansmanGiderleri +
        olaganDisiGelirler -
        olaganDisiGiderler -
        vergiKarsiligi;

      return {
        from,
        to,
        brutSatislar,
        satisIndirimleri,
        netSatislar,
        satislarinMaliyeti,
        brutKar,
        faaliyetGiderleri,
        faaliyetKari,
        digerFaaliyetGelirleri,
        digerFaaliyetGiderleri,
        finansmanGiderleri,
        olaganDisiGelirler,
        olaganDisiGiderler,
        vergiKarsiligi,
        donemNetKari,
      };
    });
  }
}

/**
 * Ham SQL satırları (snake_case kolonlar) → API nesnesi dönüşümleri.
 * `any` yerine bilinçli olarak `DbRow`: kolonlar query'de `SELECT *` ile geldiği
 * için derleme zamanı tipi yok; çıktı da `Record<string, unknown>` olarak taşınır
 * (yalnızca `res.json`'a gider, arithmetic yapılmaz).
 */
export type DbRow = Record<string, unknown>;
export type MappedRow = Record<string, unknown>;

/** pg normalde Date döner; test mock'ları string verebilir — ikisini de kabul et. */
function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export function mapAccountRow(row: DbRow): MappedRow {
  return {
    ...row,
    openingDebit: Number(row.opening_debit),
    openingCredit: Number(row.opening_credit),
    openingBalance: Number(row.opening_debit) - Number(row.opening_credit),
    created_at: toDate(row.created_at),
    updated_at: toDate(row.updated_at),
  };
}

export function mapPeriodRow(row: DbRow): MappedRow {
  return {
    ...row,
    created_at: toDate(row.created_at),
    updated_at: toDate(row.updated_at),
    start_date: toDate(row.start_date),
    end_date: toDate(row.end_date),
  };
}

export function mapEntryRow(row: DbRow): MappedRow {
  return {
    ...row,
    totalDebit: Number(row.total_debit),
    totalCredit: Number(row.total_credit),
    created_at: toDate(row.created_at),
    updated_at: toDate(row.updated_at),
    posted_at: row.posted_at ? toDate(row.posted_at) : null,
    entry_date: toDate(row.entry_date),
  };
}

export function mapLineRow(row: DbRow): MappedRow {
  return {
    ...row,
    debit: Number(row.debit),
    credit: Number(row.credit),
    created_at: toDate(row.created_at),
    updated_at: toDate(row.updated_at),
  };
}

export function mapRuleRow(row: DbRow): MappedRow {
  // pg `jsonb`'ı zaten parse edilmiş nesne olarak döner; string gelirse (test mock'ları)
  // parse et. Önceki hali JSON.parse(obje) → "[object Object]" hatası üretiyordu.
  return {
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : (row.config ?? {}),
    created_at: toDate(row.created_at),
    updated_at: toDate(row.updated_at),
  };
}

export function mapMappingRow(row: DbRow): MappedRow {
  return {
    ...row,
    created_at: toDate(row.created_at),
    updated_at: toDate(row.updated_at),
  };
}

export function mapLockRow(row: DbRow): MappedRow {
  return {
    ...row,
    created_at: toDate(row.created_at),
    updated_at: toDate(row.updated_at),
    lock_date: toDate(row.lock_date),
    locked_at: toDate(row.locked_at),
  };
}

export const accountingService = new AccountingService();

// ==================== Modül düzeyi kısayolları (cash-bank deseni) ====================

export async function ensureChartOfAccounts(tenantId?: string): Promise<number> {
  return accountingService.ensureChartOfAccounts(tenantId);
}

export async function listAccountingAccounts(query?: Record<string, unknown>, tenantId?: string) {
  return accountingService.listAccountingAccounts(query ?? {}, tenantId);
}

export async function getAccountById(id: string, tenantId?: string) {
  return accountingService.getAccountById(id, tenantId);
}

export async function createAccount(input: CreateAccountInput, userId: string, tenantId?: string) {
  return accountingService.createAccount(input, userId, tenantId);
}

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
  userId: string,
  tenantId?: string,
) {
  return accountingService.updateAccount(id, input, userId, tenantId);
}

export async function deleteAccount(id: string, tenantId?: string) {
  return accountingService.deleteAccount(id, tenantId);
}

export async function listJournalEntries(query?: Record<string, unknown>, tenantId?: string) {
  return accountingService.listJournalEntries(query ?? {}, tenantId);
}

export async function getEntryById(id: string, tenantId?: string) {
  return accountingService.getEntryById(id, tenantId);
}

export async function createEntry(
  input: CreateJournalEntryInput,
  userId: string,
  tenantId?: string,
) {
  return accountingService.createEntry(input, userId, tenantId);
}

export async function updateEntry(
  id: string,
  input: UpdateJournalEntryInput,
  userId: string,
  tenantId?: string,
) {
  return accountingService.updateEntry(id, input, userId, tenantId);
}

export async function reverseEntry(id: string, userId: string, tenantId?: string) {
  return accountingService.reverseEntry(id, userId, tenantId);
}

export async function cancelEntry(id: string, userId: string, tenantId?: string) {
  return accountingService.cancelEntry(id, userId, tenantId);
}

export async function deleteEntry(id: string, tenantId?: string) {
  return accountingService.deleteEntry(id, tenantId);
}

export async function listJournalLines(query?: Record<string, unknown>, tenantId?: string) {
  return accountingService.listJournalLines(query ?? {}, tenantId);
}

export async function getLineById(id: string, tenantId?: string) {
  return accountingService.getLineById(id, tenantId);
}

export async function createLine(input: JournalLineInput, userId: string, tenantId?: string) {
  return accountingService.createLine(input, userId, tenantId);
}

export async function updateLine(
  id: string,
  input: JournalLineInput,
  userId: string,
  tenantId?: string,
) {
  return accountingService.updateLine(id, input, userId, tenantId);
}

export async function deleteLine(id: string, tenantId?: string) {
  return accountingService.deleteLine(id, tenantId);
}

export async function listFiscalPeriods(query?: Record<string, unknown>, tenantId?: string) {
  return accountingService.listFiscalPeriods(query ?? {}, tenantId);
}

export async function getPeriodById(id: string, tenantId?: string) {
  return accountingService.getPeriodById(id, tenantId);
}

export async function createPeriod(input: CreatePeriodInput, userId: string, tenantId?: string) {
  return accountingService.createPeriod(input, userId, tenantId);
}

export async function updatePeriod(
  id: string,
  input: UpdatePeriodInput,
  userId: string,
  tenantId?: string,
) {
  return accountingService.updatePeriod(id, input, userId, tenantId);
}

export async function deletePeriod(id: string, tenantId?: string) {
  return accountingService.deletePeriod(id, tenantId);
}

export async function listPeriodLocks(query?: Record<string, unknown>, tenantId?: string) {
  return accountingService.listPeriodLocks(query ?? {}, tenantId);
}

export async function getLockById(id: string, tenantId?: string) {
  return accountingService.getLockById(id, tenantId);
}

export async function createLock(input: CreatePeriodLockInput, userId: string, tenantId?: string) {
  return accountingService.createLock(input, userId, tenantId);
}

export async function updateLock(
  id: string,
  input: UpdatePeriodLockInput,
  userId: string,
  tenantId?: string,
) {
  return accountingService.updateLock(id, input, userId, tenantId);
}

export async function deleteLock(id: string, tenantId?: string) {
  return accountingService.deleteLock(id, tenantId);
}

export async function listPostingRules(query?: Record<string, unknown>, tenantId?: string) {
  return accountingService.listPostingRules(query ?? {}, tenantId);
}

export async function getRuleById(id: string, tenantId?: string) {
  return accountingService.getRuleById(id, tenantId);
}

export async function createRule(input: CreatePostingRuleInput, userId: string, tenantId?: string) {
  return accountingService.createRule(input, userId, tenantId);
}

export async function updateRule(
  id: string,
  input: UpdatePostingRuleInput,
  userId: string,
  tenantId?: string,
) {
  return accountingService.updateRule(id, input, userId, tenantId);
}

export async function deleteRule(id: string, tenantId?: string) {
  return accountingService.deleteRule(id, tenantId);
}

export async function listAccountMappings(query?: Record<string, unknown>, tenantId?: string) {
  return accountingService.listAccountMappings(query ?? {}, tenantId);
}

export async function getMappingById(id: string, tenantId?: string) {
  return accountingService.getMappingById(id, tenantId);
}

export async function createMapping(
  input: CreateAccountMappingInput,
  userId: string,
  tenantId?: string,
) {
  return accountingService.createMapping(input, userId, tenantId);
}

export async function updateMapping(
  id: string,
  input: UpdateAccountMappingInput,
  userId: string,
  tenantId?: string,
) {
  return accountingService.updateMapping(id, input, userId, tenantId);
}

export async function deleteMapping(id: string, tenantId?: string) {
  return accountingService.deleteMapping(id, tenantId);
}

export async function getNextEntryNo(tenantId?: string) {
  return accountingService.getNextEntryNo(tenantId);
}

// ==================== Muhasebe Raporları (Faz 5) ====================

export async function trialBalance(input?: { from?: string; to?: string }, tenantId?: string) {
  return accountingService.trialBalance(input ?? {}, tenantId);
}

export async function balanceSheet(input?: { as_of?: string }, tenantId?: string) {
  return accountingService.balanceSheet(input ?? {}, tenantId);
}

export async function incomeStatement(input?: { from?: string; to?: string }, tenantId?: string) {
  return accountingService.incomeStatement(input ?? {}, tenantId);
}
