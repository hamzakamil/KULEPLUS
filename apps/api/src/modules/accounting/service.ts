import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { ensureChartOfAccountsOn } from './chart';
import { linkAllSubledgers } from './subledger';
import { allocateEntryNo, openPeriodFor, round2, toIsoDate, toKurus, todayIso } from './ledger';
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
  UpdateJournalLineInput,
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
/** Kaynak belgeden otomatik üretilen fiş türleri — doğrudan düzenlenemez/ters çevrilemez. */
const AUTO_SOURCE_TYPES = [
  'invoice',
  'invoice_payment',
  'cheque',
  'revaluation',
  'expense',
  'expense_payment',
];

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
      // Tekil kısıt ihlali (ör. aynı hesap kodu / aynı yıl dönemi) → 500 yerine 409.
      if ((err as { code?: string }).code === '23505') {
        throw new AppError('CONFLICT', 'Bu kayıt zaten mevcut (tekil kısıt).');
      }
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
      /** Varsayılan: journal_entries. Dönem/kilit gibi diğer muhasebe tabloları için belirtilir. */
      entityType?: string;
      oldValues?: Record<string, unknown> | null;
      newValues?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, now())`,
      [
        newId(),
        entry.userId ?? null,
        `${entry.entityType ?? 'journal_entries'}.${entry.action}`,
        entry.entityType ?? 'journal_entries',
        entry.entityId,
        entry.oldValues ? JSON.stringify(entry.oldValues) : null,
        entry.newValues ? JSON.stringify(entry.newValues) : null,
      ],
    );
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
    return this.withTenantClient(tenantId, async (client) => {
      const inserted = await ensureChartOfAccountsOn(client);
      // Kasa/banka/kredi kartı alt hesapları (100.xx/102.xx/309.xx) — Faz 7-1.
      await linkAllSubledgers(client);
      return inserted;
    });
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

  /**
   * Tek-kayıt okuyucular AYNI client'ı kullanır: create/update sonrası kaydı ikinci bir
   * bağlantıdan (`get*ById`) okumak, henüz commit edilmemiş satırı göremez → null/eski veri
   * dönüyordu (denetim bulgusu N1).
   */
  private async loadRow(
    client: PoolClient,
    table:
      | 'accounting_accounts'
      | 'fiscal_periods'
      | 'period_locks'
      | 'posting_rules'
      | 'account_mappings',
    id: string,
  ): Promise<DbRow | null> {
    const r = await client.query(
      `SELECT * FROM ${table} WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    return (r.rows[0] as DbRow | undefined) ?? null;
  }

  async getAccountById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const row = await this.loadRow(client, 'accounting_accounts', id);
      return row ? mapAccountRow(row) : null;
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
      const row = await this.loadRow(client, 'accounting_accounts', accountId);
      return row ? mapAccountRow(row) : null;
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
      const row = await this.loadRow(client, 'accounting_accounts', id);
      return row ? mapAccountRow(row) : null;
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

  /** Fiş başlığı + satırları (aynı client — bkz. `loadRow`). */
  private async loadEntry(client: PoolClient, id: string) {
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
  }

  async getEntryById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, (client) => this.loadEntry(client, id));
  }

  /**
   * Satır doğrulama: tek taraflı, boş değil. Toplamlar kuruş (tamsayı) üzerinden
   * hesaplanır — float toplama (0.1 + 0.2) dengeli fişi "dengesiz" göstermesin.
   */
  private validateLines(lines: JournalLineInput[]): {
    debit: number;
    credit: number;
    balanced: boolean;
  } {
    if (lines.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Fisde en az bir satir olmali');
    }
    let debitK = 0;
    let creditK = 0;
    for (const l of lines) {
      const d = toKurus(l.debit);
      const c = toKurus(l.credit);
      if (d < 0 || c < 0) throw new AppError('VALIDATION_ERROR', 'Negatif tutar girilemez');
      if (d > 0 && c > 0)
        throw new AppError('VALIDATION_ERROR', 'Satir tek tarafli olmali (borc veya alacak)');
      if (d === 0 && c === 0) throw new AppError('VALIDATION_ERROR', 'Bos satir girilemez');
      debitK += d;
      creditK += c;
    }
    return { debit: debitK / 100, credit: creditK / 100, balanced: debitK === creditK };
  }

  /** Onay için zorunlu koşullar: en az iki satır + denge (SPEC §10.5). */
  private assertPostable(
    lines: JournalLineInput[],
    totals: { debit: number; credit: number; balanced: boolean },
  ) {
    if (lines.length < 2) {
      throw new AppError('VALIDATION_ERROR', 'Onayli fiste en az iki satir olmali');
    }
    if (!totals.balanced) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Fis dengeli degil: borc ${totals.debit} != alacak ${totals.credit} (SPEC §10.5)`,
      );
    }
  }

  /** Fis olusturur; status=posted ise onaylar (denge + donem + gap-free). */
  async createEntry(input: CreateJournalEntryInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const totals = this.validateLines(input.lines);
      const postNow = input.status === 'posted';
      let postPeriodId: string | null = null;
      if (postNow) {
        this.assertPostable(input.lines, totals);
        postPeriodId = await openPeriodFor(client, input.entry_date);
      }

      const entryId = newId();
      const entryNo = postNow ? await allocateEntryNo(client) : null;
      const periodId = input.period_id ?? postPeriodId;

      await client.query(
        `INSERT INTO journal_entries
           (id, tenant_id, entry_no, entry_date, period_id, entry_type, status, description,
            source_type, source_id, reversal_of_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
        [
          entryId,
          entryNo,
          input.entry_date,
          periodId,
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
        [
          newId(),
          entryId,
          lineNo,
          l.account_id,
          l.description ?? '',
          round2(l.debit),
          round2(l.credit),
          userId,
        ],
      );
      lineNo++;
    }
  }

  /**
   * Onayli fisi ters kayitla duzeltir (SPEC §10.1, §15).
   * - Ters fiş `entryDate` tarihinde (varsayılan: bugün) ve o tarihin açık döneminde yazılır;
   *   orijinal fiş ve dönemi değişmez (kapalı dönemdeki fiş de bugünden ters çevrilebilir).
   * - Bir fiş yalnızca bir kez ters çevrilir; ters fiş yeniden ters çevrilemez
   *   (servis kontrolü + `journal_entries_reversal_once` kısmi UNIQUE).
   */
  async reverseEntry(id: string, userId: string, tenantId?: string, entryDate?: string) {
    return this.withTenantClient(tenantId, (client) =>
      this.reverseEntryOn(client, id, userId, entryDate),
    );
  }

  /**
   * Ters kaydın client-tabanlı uygulaması — kaynak belge servisleri (ör. fatura iptali)
   * kendi transaction'larında çağırır. `allowSource: false` (varsayılan) iken kaynak belgeye
   * bağlı otomatik fişler (fatura, tahsilat, çek, kur değerleme) doğrudan ters çevrilemez:
   * kaynak belge ile yevmiye birlikte düzeltilmelidir (SPEC §15 "Düzeltme").
   */
  async reverseEntryOn(
    client: PoolClient,
    id: string,
    userId: string,
    entryDate?: string,
    opts: { allowSource?: boolean } = {},
  ) {
    {
      const found = await client.query(
        'SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Fis bulunamadi');
      const orig = found.rows[0];
      if (orig.status !== 'posted')
        throw new AppError('FORBIDDEN', 'Yalnizca onayli fis ters kaydedilir');
      if (!opts.allowSource && AUTO_SOURCE_TYPES.includes(String(orig.source_type))) {
        throw new AppError(
          'FORBIDDEN',
          'Kaynak belgeye bagli otomatik fis dogrudan ters cevrilemez; kaynak belgeyi (fatura vb.) iptal edin.',
        );
      }
      if (orig.reversal_of_id || orig.entry_type === 'ters')
        throw new AppError('FORBIDDEN', 'Ters kayit fisi yeniden ters cevrilemez');
      const already = await client.query(
        `SELECT entry_no FROM journal_entries
          WHERE reversal_of_id = $1 AND tenant_id = current_tenant_id() LIMIT 1`,
        [id],
      );
      if (already.rows.length > 0) {
        throw new AppError(
          'CONFLICT',
          `Bu fis zaten ters kaydedilmis (ters fis no ${already.rows[0].entry_no})`,
        );
      }

      const reversalDate = entryDate ?? todayIso();
      const periodId = await openPeriodFor(client, reversalDate);
      const entryNo = await allocateEntryNo(client);
      const reversalId = newId();

      await client.query(
        `INSERT INTO journal_entries
           (id, tenant_id, entry_no, entry_date, period_id, entry_type, status, description,
            source_type, source_id, reversal_of_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, 'ters', 'posted', $5, $6, $7, $8, $9, $10, $11, now(), $11, $11)`,
        [
          reversalId,
          entryNo,
          reversalDate,
          periodId,
          `${orig.description} - TERS KAYIT (fis no ${orig.entry_no})`,
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
        newValues: {
          reversal_id: reversalId,
          reversal_entry_no: entryNo,
          entry_date: reversalDate,
        },
      });
      return { id: reversalId, entryNo, status: 'posted' as const };
    }
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

  /**
   * Taslak fişi günceller; `status: 'posted'` verilirse aynı işlemde onaylar.
   * `lines` verilmezse mevcut satırlar korunur (yalnızca başlık güncellemesi).
   */
  async updateEntry(id: string, input: UpdateJournalEntryInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Fis bulunamadi');
      const current = found.rows[0];
      if (current.status === 'posted')
        throw new AppError('FORBIDDEN', 'Onayli fis guncellenemez; ters kayit kullanin');
      if (current.status === 'cancelled')
        throw new AppError('FORBIDDEN', 'Iptal edilmis fis guncellenemez');

      if (input.lines) {
        this.validateLines(input.lines);
        await this.deleteLines(client, id);
        await this.insertLines(client, id, input.lines, userId);
      }
      const entryDate = String(input.entry_date ?? toIsoDate(current.entry_date));
      await client.query(
        `UPDATE journal_entries SET
           entry_date = $1,
           period_id = COALESCE($2, period_id),
           entry_type = COALESCE($3, entry_type),
           description = COALESCE($4, description),
           updated_by = $5, updated_at = now()
         WHERE id = $6 AND tenant_id = current_tenant_id()`,
        [
          entryDate,
          input.period_id ?? null,
          input.entry_type ?? null,
          input.description ?? null,
          userId,
          id,
        ],
      );
      const totals = await this.refreshTotals(client, id);

      if (input.status === 'cancelled') {
        await client.query(
          `UPDATE journal_entries SET status = 'cancelled' WHERE id = $1 AND tenant_id = current_tenant_id()`,
          [id],
        );
      }

      await this.writeAudit(client, {
        userId,
        action: 'update',
        entityId: id,
        oldValues: current,
        newValues: {
          entry_date: entryDate,
          entry_type: input.entry_type ?? current.entry_type,
          status: input.status ?? current.status,
          description: input.description ?? current.description,
          total_debit: totals.debit,
          total_credit: totals.credit,
        },
      });

      if (input.status === 'posted') {
        await this.postDraft(client, id, userId);
      }
      return this.loadEntry(client, id);
    });
  }

  /** Taslak fişi onaylar (POST /entries/:id/post). */
  async postEntry(id: string, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT status FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Fis bulunamadi');
      await this.postDraft(client, id, userId);
      return this.loadEntry(client, id);
    });
  }

  /**
   * Taslak → onaylı geçişinin tek uygulaması: satırları DB'den okur, en az iki satır +
   * denge + dönem açık kontrolü yapar, gap-free numara ve onaylayan bilgisini yazar.
   * Çağıran fiş satırını FOR UPDATE ile kilitlemiş olmalıdır.
   */
  private async postDraft(client: PoolClient, id: string, userId: string): Promise<void> {
    const r = await client.query(
      'SELECT status, entry_date FROM journal_entries WHERE id = $1 AND tenant_id = current_tenant_id()',
      [id],
    );
    const entry = r.rows[0];
    if (entry.status !== 'draft') {
      throw new AppError('FORBIDDEN', 'Yalnizca taslak fis onaylanabilir');
    }
    const lineRows = await client.query(
      'SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = $1 AND tenant_id = current_tenant_id()',
      [id],
    );
    const lines = lineRows.rows.map((l) => ({
      account_id: String(l.account_id),
      debit: Number(l.debit),
      credit: Number(l.credit),
    }));
    const totals = this.validateLines(lines);
    this.assertPostable(lines, totals);
    const entryDate = toIsoDate(entry.entry_date);
    const periodId = await openPeriodFor(client, entryDate);
    const entryNo = await allocateEntryNo(client);
    await client.query(
      `UPDATE journal_entries SET
         status = 'posted', entry_no = $1, period_id = COALESCE(period_id, $2),
         total_debit = $3, total_credit = $4,
         posted_by = $5, posted_at = now(), updated_by = $5, updated_at = now()
       WHERE id = $6 AND tenant_id = current_tenant_id()`,
      [entryNo, periodId, totals.debit, totals.credit, userId, id],
    );
    await this.writeAudit(client, {
      userId,
      action: 'post',
      entityId: id,
      oldValues: { status: 'draft' },
      newValues: { status: 'posted', entry_no: entryNo },
    });
  }

  /** Başlık toplamlarını satırlardan yeniden hesaplar (taslak düzenlemelerinde). */
  private async refreshTotals(client: PoolClient, id: string) {
    const r = await client.query(
      `UPDATE journal_entries je SET
         total_debit = s.debit, total_credit = s.credit
         FROM (SELECT COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
                 FROM journal_lines WHERE entry_id = $1 AND tenant_id = current_tenant_id()) s
        WHERE je.id = $1 AND je.tenant_id = current_tenant_id()
        RETURNING je.total_debit, je.total_credit`,
      [id],
    );
    return {
      debit: Number(r.rows[0]?.total_debit ?? 0),
      credit: Number(r.rows[0]?.total_credit ?? 0),
    };
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

  private async loadLine(client: PoolClient, id: string) {
    const r = await client.query(
      `SELECT l.*, a.code AS account_code, a.name AS account_name
         FROM journal_lines l
         JOIN accounting_accounts a ON a.id = l.account_id AND a.tenant_id = current_tenant_id()
        WHERE l.id = $1 AND l.tenant_id = current_tenant_id()`,
      [id],
    );
    if (r.rows.length === 0) return null;
    const row = mapLineRow(r.rows[0]);
    return { ...row, account: { code: row.account_code, name: row.account_name } };
  }

  async getLineById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, (client) => this.loadLine(client, id));
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
      this.validateLines([input]);
      const lineId = newId();
      await client.query(
        `INSERT INTO journal_lines (id, tenant_id, entry_id, line_no, account_id, description, debit, credit, created_by, updated_by)
           VALUES ($1, current_tenant_id(), $2,
                   COALESCE($3, (SELECT COALESCE(MAX(line_no), 0) + 1 FROM journal_lines WHERE entry_id = $2)),
                   $4, $5, $6, $7, $8, $8)`,
        [
          lineId,
          input.entry_id,
          input.line_no ?? null,
          input.account_id,
          input.description ?? '',
          round2(input.debit),
          round2(input.credit),
          userId,
        ],
      );
      await this.refreshTotals(client, String(input.entry_id));
      return this.loadLine(client, lineId);
    });
  }

  async updateLine(id: string, input: UpdateJournalLineInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        `SELECT je.id AS entry_id, je.status FROM journal_lines l
           JOIN journal_entries je ON je.id = l.entry_id AND je.tenant_id = current_tenant_id()
          WHERE l.id = $1 AND l.tenant_id = current_tenant_id()`,
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Fis satiri bulunamadi');
      if (found.rows[0].status !== 'draft')
        throw new AppError('FORBIDDEN', 'Yalnizca taslak fis satiri guncellenebilir');
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
          input.debit === undefined ? null : round2(input.debit),
          input.credit === undefined ? null : round2(input.credit),
          userId,
          id,
        ],
      );
      await this.refreshTotals(client, String(found.rows[0].entry_id));
      return this.loadLine(client, id);
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

  /** Aralık çakışması: aynı tenant'ta başka bir mali dönemle kesişen tarih aralığı var mı? */
  private async assertNoPeriodOverlap(
    client: PoolClient,
    start: string,
    end: string,
    excludeId?: string,
  ) {
    const r = await client.query(
      `SELECT label FROM fiscal_periods
        WHERE tenant_id = current_tenant_id()
          AND ($3::uuid IS NULL OR id <> $3::uuid)
          AND daterange(start_date, end_date, '[]') && daterange($1::date, $2::date, '[]')
        LIMIT 1`,
      [start, end, excludeId ?? null],
    );
    if (r.rows.length > 0) {
      throw new AppError('CONFLICT', `Tarih aralığı "${r.rows[0].label}" dönemiyle çakışıyor.`);
    }
  }

  async createPeriod(input: CreatePeriodInput, userId: string, tenantId?: string) {
    const periodId = newId();
    return this.withTenantClient(tenantId, async (client) => {
      if (input.start_date > input.end_date) {
        throw new AppError('VALIDATION_ERROR', 'Dönem başlangıcı bitişinden sonra olamaz.');
      }
      await this.assertNoPeriodOverlap(client, input.start_date, input.end_date);
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
      await this.writeAudit(client, {
        userId,
        action: 'create',
        entityType: 'fiscal_periods',
        entityId: periodId,
        newValues: { ...input },
      });
      const row = await this.loadRow(client, 'fiscal_periods', periodId);
      return row ? mapPeriodRow(row) : null;
    });
  }

  /** Dönem içinde (id ya da tarih aralığıyla) fiş sayısı; status verilirse yalnızca o durum. */
  private async periodEntryCount(
    client: PoolClient,
    period: { id: string; start_date: unknown; end_date: unknown },
    status?: string,
  ): Promise<number> {
    const r = await client.query(
      `SELECT COUNT(*) AS n FROM journal_entries
        WHERE tenant_id = current_tenant_id()
          AND (period_id = $1 OR entry_date BETWEEN $2::date AND $3::date)
          AND ($4::text IS NULL OR status = $4::text)`,
      [period.id, toIsoDate(period.start_date), toIsoDate(period.end_date), status ?? null],
    );
    return Number(r.rows[0].n);
  }

  async updatePeriod(id: string, input: UpdatePeriodInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM fiscal_periods WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Mali donem bulunamadi');
      const cur = found.rows[0];
      const start = input.start_date ?? toIsoDate(cur.start_date);
      const end = input.end_date ?? toIsoDate(cur.end_date);
      if (start > end) {
        throw new AppError('VALIDATION_ERROR', 'Dönem başlangıcı bitişinden sonra olamaz.');
      }
      const datesChanged =
        start !== toIsoDate(cur.start_date) ||
        end !== toIsoDate(cur.end_date) ||
        (input.year !== undefined && input.year !== cur.year);
      if (datesChanged) {
        await this.assertNoPeriodOverlap(client, start, end, id);
        if ((await this.periodEntryCount(client, cur)) > 0) {
          throw new AppError('FORBIDDEN', 'Fişi olan dönemin tarih aralığı değiştirilemez.');
        }
      }
      if (input.status === 'closed' && cur.status !== 'closed') {
        const drafts = await this.periodEntryCount(client, cur, 'draft');
        if (drafts > 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            `Dönemde ${drafts} taslak fiş var; kapatmadan önce onaylayın veya silin.`,
          );
        }
      }
      await client.query(
        `UPDATE fiscal_periods SET
           label = COALESCE($1, label),
           year = COALESCE($2, year),
           start_date = $3,
           end_date = $4,
           status = COALESCE($5, status),
           version = version + 1,
           updated_by = $6, updated_at = now()
         WHERE id = $7 AND tenant_id = current_tenant_id()`,
        [input.label ?? null, input.year ?? null, start, end, input.status ?? null, userId, id],
      );
      await this.writeAudit(client, {
        userId,
        action: input.status && input.status !== cur.status ? `status_${input.status}` : 'update',
        entityType: 'fiscal_periods',
        entityId: id,
        oldValues: { label: cur.label, status: cur.status, year: cur.year },
        newValues: { ...input, start_date: start, end_date: end },
      });
      const row = await this.loadRow(client, 'fiscal_periods', id);
      return row ? mapPeriodRow(row) : null;
    });
  }

  /** Dönem silme: yalnızca hiç fişi olmayan dönem silinebilir (açık/kapalı fark etmez). */
  async deletePeriod(id: string, tenantId?: string, userId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT * FROM fiscal_periods WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) return { success: true };
      if ((await this.periodEntryCount(client, found.rows[0])) > 0) {
        throw new AppError('FORBIDDEN', 'Fişi olan mali dönem silinemez.');
      }
      await client.query(
        'DELETE FROM fiscal_periods WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      await this.writeAudit(client, {
        userId,
        action: 'delete',
        entityType: 'fiscal_periods',
        entityId: id,
        oldValues: { label: found.rows[0].label, year: found.rows[0].year },
      });
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
      const period = await this.loadRow(client, 'fiscal_periods', input.period_id);
      if (!period) throw new AppError('NOT_FOUND', 'Mali donem bulunamadi');
      await client.query(
        `INSERT INTO period_locks (id, tenant_id, period_id, lock_date, reason, locked_by, locked_at, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, now(), $6, $6)`,
        [lockId, input.period_id, input.lock_date, input.reason || '', userId, userId],
      );
      await this.writeAudit(client, {
        userId,
        action: 'create',
        entityType: 'period_locks',
        entityId: lockId,
        newValues: { period_id: input.period_id, lock_date: input.lock_date, reason: input.reason },
      });
      const row = await this.loadRow(client, 'period_locks', lockId);
      return row ? mapLockRow(row) : null;
    });
  }

  async updateLock(id: string, input: UpdatePeriodLockInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const before = await this.loadRow(client, 'period_locks', id);
      if (!before) throw new AppError('NOT_FOUND', 'Donem kilidi bulunamadi');
      await client.query(
        `UPDATE period_locks SET
           period_id = COALESCE($1, period_id),
           lock_date = COALESCE($2, lock_date),
           reason = COALESCE($3, reason),
           updated_by = $4, updated_at = now()
         WHERE id = $5 AND tenant_id = current_tenant_id()`,
        [input.period_id ?? null, input.lock_date ?? null, input.reason ?? null, userId, id],
      );
      await this.writeAudit(client, {
        userId,
        action: 'update',
        entityType: 'period_locks',
        entityId: id,
        oldValues: { lock_date: toIsoDate(before.lock_date), reason: before.reason },
        newValues: { ...input },
      });
      const row = await this.loadRow(client, 'period_locks', id);
      return row ? mapLockRow(row) : null;
    });
  }

  async deleteLock(id: string, tenantId?: string, userId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await this.loadRow(client, 'period_locks', id);
      if (!found) return { success: true };
      await client.query(
        'DELETE FROM period_locks WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      await this.writeAudit(client, {
        userId,
        action: 'delete',
        entityType: 'period_locks',
        entityId: id,
        oldValues: { lock_date: toIsoDate(found.lock_date), reason: found.reason },
      });
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
        [ruleId, input.code, input.name, input.config ?? {}, input.is_active ?? true, userId],
      );
      const row = await this.loadRow(client, 'posting_rules', ruleId);
      return row ? mapRuleRow(row) : null;
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
          input.config ?? null,
          input.is_active ?? null,
          userId,
          id,
        ],
      );
      const row = await this.loadRow(client, 'posting_rules', id);
      return row ? mapRuleRow(row) : null;
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
      const row = await this.loadRow(client, 'account_mappings', mappingId);
      return row ? mapMappingRow(row) : null;
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
        [input.source_type ?? null, input.account_id ?? null, input.direction ?? null, userId, id],
      );
      const row = await this.loadRow(client, 'account_mappings', id);
      return row ? mapMappingRow(row) : null;
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

  /**
   * KDV tevkifatı hazırlık raporu (Faz 7-3). Kesinleşmiş faturalardan:
   *  - `kdv2`: alışlar, KDV-2 kodu bazında matrah / KDV / tevkif edilen KDV (TRY) +
   *    360.01.<kod> hesabının dönem bakiyesiyle mutabakat (fark = 0 beklenir),
   *  - `kdv1`: satışlar, e-Fatura tevkifat kodu bazında (KDV-1 kısmi tevkifat bölümü).
   */
  async withholdingReport(input: { from?: string; to?: string }, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const { from, to } = this.normalizeRange(input);
      const byCode = (type: 'purchase' | 'sales', codeCol: string) =>
        client.query(
          `SELECT il.${codeCol} AS code, il.withholding_einvoice_code AS einvoice_code,
                  il.withholding_kdv2_code AS kdv2_code, il.withholding_rate AS rate_pct,
                  MAX(wt.name) AS name,
                  COUNT(DISTINCT i.id)::int AS document_count,
                  ROUND(SUM((il.line_total - il.tax_amount) * i.exchange_rate), 2) AS base,
                  ROUND(SUM(il.tax_amount * i.exchange_rate), 2) AS vat,
                  ROUND(SUM(il.withholding_amount * i.exchange_rate), 2) AS withheld
             FROM invoice_lines il
             JOIN invoices i ON i.id = il.invoice_id
             LEFT JOIN withholding_types wt ON wt.id = il.withholding_type_id
            WHERE i.tenant_id = current_tenant_id() AND i.type = $1
              AND i.posting_status = 'posted' AND il.withholding_amount > 0
              AND i.issue_date BETWEEN $2::date AND $3::date
            GROUP BY il.${codeCol}, il.withholding_einvoice_code, il.withholding_kdv2_code, il.withholding_rate
            ORDER BY il.${codeCol}`,
          [type, from, to],
        );
      const [purchases, sales, ledger] = await Promise.all([
        byCode('purchase', 'withholding_kdv2_code'),
        byCode('sales', 'withholding_einvoice_code'),
        client.query(
          `SELECT a.code, COALESCE(SUM(jl.credit - jl.debit), 0) AS balance
             FROM accounting_accounts a
             LEFT JOIN journal_lines jl ON jl.account_id = a.id
             LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'
                  AND je.entry_date BETWEEN $1::date AND $2::date
            WHERE a.tenant_id = current_tenant_id() AND a.code LIKE '360.01.%'
              AND (jl.id IS NULL OR je.id IS NOT NULL)
            GROUP BY a.code`,
          [from, to],
        ),
      ]);
      const ledgerByCode = new Map(
        ledger.rows.map((r) => [String(r.code).replace('360.01.', ''), Number(r.balance)]),
      );
      const num = (v: unknown) => Number(v ?? 0);
      const kdv2 = purchases.rows.map((r) => {
        const withheld = num(r.withheld);
        const ledgerAmount = ledgerByCode.get(String(r.kdv2_code)) ?? 0;
        return {
          kdv2Code: r.kdv2_code,
          einvoiceCode: r.einvoice_code,
          name: r.name,
          rate: `${Math.round(num(r.rate_pct) / 10)}/10`,
          documentCount: r.document_count,
          base: num(r.base),
          vat: num(r.vat),
          withheld,
          ledger: ledgerAmount,
          difference: round2(withheld - ledgerAmount),
        };
      });
      const kdv1 = sales.rows.map((r) => ({
        einvoiceCode: r.einvoice_code,
        name: r.name,
        rate: `${Math.round(num(r.rate_pct) / 10)}/10`,
        documentCount: r.document_count,
        base: num(r.base),
        vat: num(r.vat),
        withheld: num(r.withheld),
      }));
      const sum = (rows: Array<{ withheld: number }>) =>
        round2(rows.reduce((acc, r) => acc + r.withheld, 0));
      return {
        from,
        to,
        kdv2,
        kdv2Total: sum(kdv2),
        kdv1,
        kdv1Total: sum(kdv1),
      };
    });
  }

  /** Rapor tarih aralığı varsayılanları (yıl başı → bugün, Europe/Istanbul). */
  private normalizeRange(input: { from?: string; to?: string }): { from: string; to: string } {
    const today = todayIso();
    return { from: input.from ?? `${today.slice(0, 4)}-01-01`, to: input.to ?? today };
  }

  /**
   * Bir hesap satırının üç bileşeni (kuruş değil, TL; DB numeric(18,2)):
   *  - `carry`  : devir = hesabın açılış bakiyesi + `from` öncesi onaylı hareketler,
   *  - `period` : [from, to] aralığındaki onaylı hareketler,
   *  - `cum`    : kümülatif = carry + period (to tarihine kadar).
   * Eksik alanlar 0 sayılır (sahte/eski satırlarla uyumluluk).
   */
  private componentOf(row: DbRow, comp: 'carry' | 'period' | 'cum') {
    const n = (v: unknown) => toKurus(v as number | string | null | undefined);
    const carryD = n(row.opening_debit) + n(row.prior_debit);
    const carryC = n(row.opening_credit) + n(row.prior_credit);
    const perD = n(row.debit);
    const perC = n(row.credit);
    if (comp === 'carry') return { debitK: carryD, creditK: carryC };
    if (comp === 'period') return { debitK: perD, creditK: perC };
    return { debitK: carryD + perD, creditK: carryC + perC };
  }

  /** Hesap kodu ön ekine göre bileşen toplamı (kuruş cinsinden). */
  private summarizeByPrefix(
    rows: DbRow[],
    length: number,
    comp: 'carry' | 'period' | 'cum' = 'period',
  ) {
    const map = new Map<string, { debitK: number; creditK: number }>();
    for (const row of rows) {
      const key = String(row.code).slice(0, length);
      const c = this.componentOf(row, comp);
      const entry = map.get(key) ?? { debitK: 0, creditK: 0 };
      entry.debitK += c.debitK;
      entry.creditK += c.creditK;
      map.set(key, entry);
    }
    return map;
  }

  /**
   * Onaylı fiş satırlarını hesap bazında toplar. `from`'dan önceki hareketler `prior_*`,
   * [from, to] arası `debit/credit` (dönem) olarak ayrılır; hesabın açılış bakiyesi
   * (`opening_*`) başlangıç devridir (SPEC §15 açılış/devir).
   */
  private async aggregateAccountBalances(
    client: PoolClient,
    from: string | null,
    to: string,
  ): Promise<DbRow[]> {
    const result = await client.query(
      `SELECT aa.code, aa.name, aa.type, aa.opening_debit, aa.opening_credit,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND je.entry_date <  $2::date THEN jl.debit  END), 0) AS prior_debit,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND je.entry_date <  $2::date THEN jl.credit END), 0) AS prior_credit,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND je.entry_date >= $2::date THEN jl.debit  END), 0) AS debit,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND je.entry_date >= $2::date THEN jl.credit END), 0) AS credit
         FROM accounting_accounts aa
         LEFT JOIN journal_lines jl
           ON jl.account_id = aa.id AND jl.tenant_id = aa.tenant_id
         LEFT JOIN journal_entries je
           ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
          AND je.status = 'posted' AND je.entry_date <= $1::date
        WHERE aa.tenant_id = current_tenant_id()
        GROUP BY aa.code, aa.name, aa.type, aa.opening_debit, aa.opening_credit
        ORDER BY aa.code`,
      [to, from ?? '0001-01-01'],
    );
    return result.rows as DbRow[];
  }

  /**
   * Mizan (mizan-ı umumi): `from` öncesi devir + dönem hareketi = kümülatif borç/alacak.
   * `debit/credit/balance` kümülatiftir (to tarihine kadar); dönem ve devir ayrı alanlarda.
   */
  async trialBalance(input: { from?: string; to?: string }, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const { from, to } = this.normalizeRange(input);
      const rows = await this.aggregateAccountBalances(client, from, to);
      const sum = { cumD: 0, cumC: 0, perD: 0, perC: 0, carryD: 0, carryC: 0 };
      const accounts = [];
      for (const row of rows) {
        const carry = this.componentOf(row, 'carry');
        const per = this.componentOf(row, 'period');
        const cum = this.componentOf(row, 'cum');
        if (cum.debitK === 0 && cum.creditK === 0 && per.debitK === 0 && per.creditK === 0) {
          continue;
        }
        sum.cumD += cum.debitK;
        sum.cumC += cum.creditK;
        sum.perD += per.debitK;
        sum.perC += per.creditK;
        sum.carryD += carry.debitK;
        sum.carryC += carry.creditK;
        accounts.push({
          code: String(row.code),
          name: row.name,
          type: row.type,
          openingDebit: carry.debitK / 100,
          openingCredit: carry.creditK / 100,
          periodDebit: per.debitK / 100,
          periodCredit: per.creditK / 100,
          debit: cum.debitK / 100,
          credit: cum.creditK / 100,
          balance: (cum.debitK - cum.creditK) / 100,
        });
      }
      return {
        from,
        to,
        accounts,
        openingDebit: sum.carryD / 100,
        openingCredit: sum.carryC / 100,
        periodDebit: sum.perD / 100,
        periodCredit: sum.perC / 100,
        totalDebit: sum.cumD / 100,
        totalCredit: sum.cumC / 100,
        balanced: sum.cumD === sum.cumC,
      };
    });
  }

  /**
   * Bilanço (as_of itibarıyla). Varlık/kaynak hesapları kümülatif (açılış dahil) alınır.
   * Gelir/gider (6/7) bakiyesi İKİYE ayrılır: cari mali yıl başından beri olan kısım
   * "Dönem Net Kârı", önceki yıllardan devreden kısım "Geçmiş Yıllar Kâr/Zararı" — yıl
   * sonu kapanış fişi (690→692→570/580) yazılana kadar eski yılların sonucu dönem kârına
   * karışmaz.
   */
  async balanceSheet(input: { as_of?: string }, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const asOf = input.as_of ?? todayIso();
      const yearStartRow = await client.query(
        `SELECT start_date FROM fiscal_periods
          WHERE tenant_id = current_tenant_id() AND $1::date BETWEEN start_date AND end_date
          ORDER BY start_date DESC LIMIT 1`,
        [asOf],
      );
      const yearStart = yearStartRow.rows[0]?.start_date
        ? toIsoDate(yearStartRow.rows[0].start_date)
        : `${asOf.slice(0, 4)}-01-01`;
      const rows = await this.aggregateAccountBalances(client, yearStart, asOf);
      const cum = this.summarizeByPrefix(rows, 1, 'cum');
      const per = this.summarizeByPrefix(rows, 1, 'period');
      const carry = this.summarizeByPrefix(rows, 1, 'carry');
      const net = (m: Map<string, { debitK: number; creditK: number }>, prefix: string) => {
        const e = m.get(prefix) ?? { debitK: 0, creditK: 0 };
        return e.debitK - e.creditK;
      };
      const donenVarliklar = net(cum, '1');
      const duranVarliklar = net(cum, '2');
      const kisaVadeliYabanciKaynaklar = -net(cum, '3');
      const uzunVadeliYabanciKaynaklar = -net(cum, '4');
      const ozKaynaklar = -net(cum, '5');
      const donemNetKar = -(net(per, '6') + net(per, '7'));
      const gecmisYillarKarZarari = -(net(carry, '6') + net(carry, '7'));
      const aktifToplam = donenVarliklar + duranVarliklar;
      const pasifToplam =
        kisaVadeliYabanciKaynaklar +
        uzunVadeliYabanciKaynaklar +
        ozKaynaklar +
        gecmisYillarKarZarari +
        donemNetKar;
      const t = (k: number) => k / 100;
      return {
        as_of: asOf,
        year_start: yearStart,
        aktif: {
          donenVarliklar: t(donenVarliklar),
          duranVarliklar: t(duranVarliklar),
          toplam: t(aktifToplam),
        },
        pasif: {
          kisaVadeliYabanciKaynaklar: t(kisaVadeliYabanciKaynaklar),
          uzunVadeliYabanciKaynaklar: t(uzunVadeliYabanciKaynaklar),
          ozKaynaklar: t(ozKaynaklar),
          gecmisYillarKarZarari: t(gecmisYillarKarZarari),
          donemNetKar: t(donemNetKar),
          toplam: t(pasifToplam),
        },
        balanced: aktifToplam === pasifToplam,
      };
    });
  }

  /**
   * Gelir tablosu (dönem aralığı) — TDHP 6/7 grubu. Her kalem NET alınır (gelir: alacak −
   * borç, gider: borç − alacak); böylece iade ve ters kayıtlar kalemi doğru azaltır.
   * 7xx (maliyet hesapları) ayrı "maliyetHesaplari7xx" satırı olarak gösterilir ve net
   * kârdan düşülür (bilançodaki 6+7 sonucuyla tutarlı; 7/A–7/B seçimi SMMM kararıdır).
   */
  async incomeStatement(input: { from?: string; to?: string }, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const { from, to } = this.normalizeRange(input);
      const rows = await this.aggregateAccountBalances(client, from, to);
      const g = this.summarizeByPrefix(rows, 2, 'period');
      const g1 = this.summarizeByPrefix(rows, 1, 'period');
      // kuruş cinsinden net: gelir (alacak − borç) / gider (borç − alacak)
      const income = (prefix: string) => {
        const e = g.get(prefix) ?? { debitK: 0, creditK: 0 };
        return e.creditK - e.debitK;
      };
      const expense = (prefix: string) => -income(prefix);
      const t = (k: number) => k / 100;

      const brutSatislar = income('60');
      const satisIndirimleri = expense('61');
      const netSatislar = brutSatislar - satisIndirimleri;
      const satislarinMaliyeti = expense('62');
      const brutKar = netSatislar - satislarinMaliyeti;
      const faaliyetGiderleri = expense('63');
      const faaliyetKari = brutKar - faaliyetGiderleri;
      const digerFaaliyetGelirleri = income('64');
      const digerFaaliyetGiderleri = expense('65');
      const finansmanGiderleri = expense('66');
      const olaganDisiGelirler = income('67');
      const olaganDisiGiderler = expense('68');
      const vergiKarsiligi = rows
        .filter((row) => String(row.code).startsWith('691'))
        .reduce((sum, row) => {
          const c = this.componentOf(row, 'period');
          return sum + c.debitK - c.creditK;
        }, 0);
      const e7 = g1.get('7') ?? { debitK: 0, creditK: 0 };
      const maliyetHesaplari7xx = e7.debitK - e7.creditK;
      const donemNetKari =
        faaliyetKari +
        digerFaaliyetGelirleri -
        digerFaaliyetGiderleri -
        finansmanGiderleri +
        olaganDisiGelirler -
        olaganDisiGiderler -
        vergiKarsiligi -
        maliyetHesaplari7xx;

      return {
        from,
        to,
        brutSatislar: t(brutSatislar),
        satisIndirimleri: t(satisIndirimleri),
        netSatislar: t(netSatislar),
        satislarinMaliyeti: t(satislarinMaliyeti),
        brutKar: t(brutKar),
        faaliyetGiderleri: t(faaliyetGiderleri),
        faaliyetKari: t(faaliyetKari),
        digerFaaliyetGelirleri: t(digerFaaliyetGelirleri),
        digerFaaliyetGiderleri: t(digerFaaliyetGiderleri),
        finansmanGiderleri: t(finansmanGiderleri),
        olaganDisiGelirler: t(olaganDisiGelirler),
        olaganDisiGiderler: t(olaganDisiGiderler),
        vergiKarsiligi: t(vergiKarsiligi),
        maliyetHesaplari7xx: t(maliyetHesaplari7xx),
        donemNetKari: t(donemNetKari),
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

export async function reverseEntry(
  id: string,
  userId: string,
  tenantId?: string,
  entryDate?: string,
) {
  return accountingService.reverseEntry(id, userId, tenantId, entryDate);
}

export async function postEntry(id: string, userId: string, tenantId?: string) {
  return accountingService.postEntry(id, userId, tenantId);
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
  input: UpdateJournalLineInput,
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

export async function deletePeriod(id: string, tenantId?: string, userId?: string) {
  return accountingService.deletePeriod(id, tenantId, userId);
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

export async function deleteLock(id: string, tenantId?: string, userId?: string) {
  return accountingService.deleteLock(id, tenantId, userId);
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

export async function withholdingReport(input?: { from?: string; to?: string }, tenantId?: string) {
  return accountingService.withholdingReport(input ?? {}, tenantId);
}

export async function incomeStatement(input?: { from?: string; to?: string }, tenantId?: string) {
  return accountingService.incomeStatement(input ?? {}, tenantId);
}
