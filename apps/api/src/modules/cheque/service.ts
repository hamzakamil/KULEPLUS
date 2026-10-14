import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import type {
  CreateChequeInput,
  UpdateChequeInput,
  ChequeListQuery,
  EndorseChequeInput,
  CollectChequeInput,
  BounceChequeInput,
  CancelChequeInput,
  PortfolioListQuery,
  TransactionListQuery,
} from './schemas';

/**
 * Çek/Senet servisi — ROADMAP Faz 6.
 *
 * Kapsam: portföy, ciro, tahsil, karşılıksız, vade takvimi, durum geçmişi +
 * muhasebe kaydı (muhasebe modülü aktifse).
 *
 * Tenant izolasyonu iki katmanlı (accounting/deseni):
 *  - API katmanı `tenantContext` (RLS),
 *  - servis kendi transaction'ında `set_config('app.tenant_id', ...)`.
 *
 * Durum makinesi (terminal durumlar kesinleşmiştir — SPEC §10.1 ruhu):
 *   portfolio ──ciro──▸ endorsed (terminal)
 *   portfolio ─tahsil▸ collected (terminal)
 *   portfolio ───────▸ bounced (terminal)
 *   portfolio ───────▸ cancelled (terminal)
 * Her geçiş `cheque_transactions`'a durum geçmişi yazar; portföy yeri
 * `cheque_portfolio`'da aktif kayıtla (until_date IS NULL) tutulur.
 *
 * Muhasebe kaydı: `JournalPort` üzerinden (DIP — SPEC §29.3, domain sınırı).
 * Port, çağıran transaction'ın client'ını kullanır → fiş ile durum geçişi
 * ATOMIKTİR. Port bağlanmazsa veya muhasebe modülü kapalıysa kayıt atlanır
 * (ROADMAP Faz 6: "muhasebe kaydı" koşullu — modül açıkken zorunlu).
 */
export interface ChequeJournalContext {
  chequeId: string;
  direction: 'incoming' | 'outgoing';
  amount: number;
  transactionDate: string;
  cashBankAccountId: string | null;
  description: string;
  userId: string;
}

/** Muhasebe portu — varsayılan implementasyon accounting tablolarına yazar. */
export interface JournalPort {
  /** Muhuhasebe modülü açık mı? (tenant_entitlements) */
  isAccountingActive(tenantId?: string): Promise<boolean>;
  /** Tahsil kaydı: borç kasa/banka, alacak 120/320. Fiş id döner (çözülemezse null). */
  postCollected(ctx: ChequeJournalContext, client: PoolClient): Promise<string | null>;
  /** Karşılıksız kaydı: tahsilin tersi. Fiş id döner (çözülemezse null). */
  postBounced(ctx: ChequeJournalContext, client: PoolClient): Promise<string | null>;
}

/** Portföy özet satırı. */
export interface PortfolioSummaryRow {
  holder: string;
  status: string;
  count: number;
  totalAmount: number;
}

/** Yüklenen aktif çek satırı (servis içi tip). */
interface LoadedCheque {
  id: string;
  status: string;
  direction: string;
  portfolioHolder: string;
  cashBankAccountId: string | null;
  amount: number;
  chequeNo: string;
}

export class ChequeService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;
  private readonly journalPort: JournalPort;

  constructor(options?: { pool?: Pool; journalPort?: JournalPort }) {
    this.providedPool = options?.pool ?? null;
    this.journalPort = options?.journalPort ?? new AccountingJournalPort();
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

  /** Muhasebe portu dışarıdan enjekte edilebilir (test/alternatif implementasyon). */
  withJournalPort(port: JournalPort): ChequeService {
    return new ChequeService({ pool: this.providedPool ?? undefined, journalPort: port });
  }

  // ======================= Okuma =======================

  async listCheques(query: ChequeListQuery, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const page = query.page;
      const limit = query.limit;
      const offset = (page - 1) * limit;
      const conditions: string[] = ['c.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;

      if (query.q) {
        conditions.push(
          `(c.cheque_no ILIKE $${i} OR c.drawer_name ILIKE $${i} OR c.serial_no ILIKE $${i} OR c.bank_name ILIKE $${i})`,
        );
        values.push(`%${query.q}%`);
        i++;
      }
      if (query.cheque_type) {
        conditions.push(`c.cheque_type = $${i}`);
        values.push(query.cheque_type);
        i++;
      }
      if (query.direction) {
        conditions.push(`c.direction = $${i}`);
        values.push(query.direction);
        i++;
      }
      if (query.status) {
        conditions.push(`c.status = $${i}`);
        values.push(query.status);
        i++;
      }
      if (query.portfolio_holder) {
        conditions.push(`c.portfolio_holder = $${i}`);
        values.push(query.portfolio_holder);
        i++;
      }
      if (query.contact_id) {
        conditions.push(`c.contact_id = $${i}`);
        values.push(query.contact_id);
        i++;
      }
      if (query.due_from) {
        conditions.push(`c.due_date >= $${i}`);
        values.push(query.due_from);
        i++;
      }
      if (query.due_to) {
        conditions.push(`c.due_date <= $${i}`);
        values.push(query.due_to);
        i++;
      }

      const where = conditions.join(' AND ');
      // Sıralama: ADR-0018 — whitelist kolon eşlemesi (SQL enjeksiyon koruması).
      const sortColumnMap: Record<string, string> = {
        due_date: 'c.due_date',
        amount: 'c.amount',
        createdAt: 'c.created_at',
        cheque_no: 'c.cheque_no',
      };
      const sortColumn = sortColumnMap[query.sortBy] ?? 'c.due_date';
      const sortOrder = query.sortOrder === 'desc' ? 'DESC' : 'ASC';

      const [list, count] = await Promise.all([
        client.query(
          `SELECT c.* FROM cheques c WHERE ${where}
           ORDER BY ${sortColumn} ${sortOrder} LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM cheques c WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapChequeRow),
        page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  async getChequeById(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        'SELECT * FROM cheques WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (r.rows.length === 0) return null;
      return mapChequeRow(r.rows[0]);
    });
  }

  async listPortfolio(query: PortfolioListQuery, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['p.tenant_id = current_tenant_id()'];
      const values: unknown[] = [];
      let i = 1;
      if (query.holder) {
        conditions.push(`p.holder = $${i}`);
        values.push(query.holder);
        i++;
      }
      if (query.active_only !== false) {
        conditions.push('p.until_date IS NULL');
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT p.* FROM cheque_portfolio p WHERE ${where}
           ORDER BY p.since_date DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM cheque_portfolio p WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapPortfolioRow),
        page: query.page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  /** Özet: portföy yeri × durum bazında adet ve toplam (iptal edilenler hariç). */
  async portfolioSummary(tenantId?: string): Promise<{ items: PortfolioSummaryRow[] }> {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        `SELECT portfolio_holder AS holder, status,
                COUNT(*)::int AS count,
                COALESCE(SUM(amount), 0) AS total
           FROM cheques
          WHERE tenant_id = current_tenant_id()
            AND status <> 'cancelled'
          GROUP BY portfolio_holder, status
          ORDER BY portfolio_holder, status`,
      );
      return {
        items: r.rows.map((row) => ({
          holder: row.holder,
          status: row.status,
          count: Number(row.count),
          totalAmount: Number(row.total),
        })),
      };
    });
  }

  /** Vade takvimi: yaklaşan vadeler (varsayılan: bugünden 30 gün). */
  async dueCalendar(tenantId?: string, days = 30) {
    return this.withTenantClient(tenantId, async (client) => {
      const r = await client.query(
        `SELECT id, cheque_type, direction, cheque_no, serial_no, drawer_name,
                due_date, amount, currency, status, portfolio_holder
           FROM cheques
          WHERE tenant_id = current_tenant_id()
            AND status = 'portfolio'
            AND due_date BETWEEN current_date AND current_date + $1::int
          ORDER BY due_date ASC`,
        [days],
      );
      return r.rows.map((row) => ({
        id: row.id,
        chequeType: row.cheque_type,
        direction: row.direction,
        chequeNo: row.cheque_no,
        serialNo: row.serial_no,
        drawerName: row.drawer_name,
        dueDate: toDateString(row.due_date),
        amount: Number(row.amount),
        currency: row.currency,
        status: row.status,
        portfolioHolder: row.portfolio_holder,
      }));
    });
  }

  async listTransactions(query: TransactionListQuery, chequeId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['t.tenant_id = current_tenant_id()', 't.cheque_id = $1'];
      const values: unknown[] = [chequeId];
      let i = 2;
      if (query.transaction_type) {
        conditions.push(`t.transaction_type = $${i}`);
        values.push(query.transaction_type);
        i++;
      }
      if (query.from) {
        conditions.push(`t.transaction_date >= $${i}`);
        values.push(query.from);
        i++;
      }
      if (query.to) {
        conditions.push(`t.transaction_date <= $${i}`);
        values.push(query.to);
        i++;
      }
      const where = conditions.join(' AND ');
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const [list, count] = await Promise.all([
        client.query(
          `SELECT t.* FROM cheque_transactions t WHERE ${where}
           ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
          [...values, limit, offset],
        ),
        client.query(`SELECT COUNT(*) AS total FROM cheque_transactions t WHERE ${where}`, values),
      ]);
      return {
        items: list.rows.map(mapTransactionRow),
        page: query.page,
        limit,
        total: Number(count.rows[0].total),
        totalPages: Math.ceil(Number(count.rows[0].total) / limit),
      };
    });
  }

  // ======================= Yazma =======================

  async createCheque(input: CreateChequeInput, userId: string, tenantId?: string) {
    const chequeId = newId();
    return this.withTenantClient(tenantId, async (client) => {
      const dup = await client.query(
        `SELECT id FROM cheques
          WHERE tenant_id = current_tenant_id()
            AND COALESCE(serial_no, '') = COALESCE($1, '') AND cheque_no = $2`,
        [input.serial_no ?? null, input.cheque_no],
      );
      if (dup.rows.length > 0) {
        throw new AppError('CONFLICT', 'Bu seri/no kombinasyonuyla çek zaten kayıtlı');
      }

      await client.query(
        `INSERT INTO cheques
           (id, tenant_id, cheque_type, direction, serial_no, cheque_no, bank_name, branch,
            account_no, drawer_name, endorser_name, issue_date, due_date, amount, currency,
            status, portfolio_holder, contact_id, cash_bank_account_id, description, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 'portfolio', $15, $16, $17, $18, $19, $19)`,
        [
          chequeId,
          input.cheque_type,
          input.direction,
          input.serial_no ?? null,
          input.cheque_no,
          input.bank_name ?? null,
          input.branch ?? null,
          input.account_no ?? null,
          input.drawer_name,
          input.endorser_name ?? null,
          input.issue_date,
          input.due_date,
          input.amount,
          input.currency,
          input.portfolio_holder,
          input.contact_id ?? null,
          input.cash_bank_account_id ?? null,
          input.description ?? null,
          userId,
        ],
      );

      // Açılış portföy kaydı + durum geçmişi (aynı transaction).
      await this.insertPortfolio(
        client,
        chequeId,
        input.portfolio_holder,
        input.drawer_name,
        input.issue_date,
      );
      await this.insertTransaction(client, {
        chequeId,
        type: 'created',
        fromStatus: null,
        toStatus: 'portfolio',
        date: input.issue_date,
        amount: input.amount,
        party: null,
        journalEntryId: null,
        description: 'Çek/senet kaydı oluşturuldu',
        userId,
      });

      return this.getChequeById(chequeId, tenantId);
    });
  }

  async updateCheque(id: string, input: UpdateChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT status FROM cheques WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Çek/senet bulunamadı');
      if (found.rows[0].status !== 'portfolio') {
        throw new AppError(
          'FORBIDDEN',
          'Yalnızca portföydeki çek/senet güncellenebilir (kesinleşmiş kayıt değişmez — SPEC §10.1)',
        );
      }

      await client.query(
        `UPDATE cheques SET
           drawer_name = COALESCE($1, drawer_name),
           endorser_name = COALESCE($2, endorser_name),
           bank_name = COALESCE($3, bank_name),
           branch = COALESCE($4, branch),
           account_no = COALESCE($5, account_no),
           due_date = COALESCE($6, due_date),
           description = COALESCE($7, description),
           contact_id = COALESCE($8, contact_id),
           cash_bank_account_id = COALESCE($9, cash_bank_account_id),
           updated_by = $10, updated_at = now()
         WHERE id = $11 AND tenant_id = current_tenant_id()`,
        [
          input.drawer_name ?? null,
          input.endorser_name ?? null,
          input.bank_name ?? null,
          input.branch ?? null,
          input.account_no ?? null,
          input.due_date ?? null,
          input.description ?? null,
          input.contact_id ?? null,
          input.cash_bank_account_id ?? null,
          userId,
          id,
        ],
      );
      return this.getChequeById(id, tenantId);
    });
  }

  async deleteCheque(id: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        'SELECT status FROM cheques WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (found.rows.length === 0) throw new AppError('NOT_FOUND', 'Çek/senet bulunamadı');
      if (found.rows[0].status !== 'portfolio') {
        throw new AppError(
          'FORBIDDEN',
          'Yalnızca portföydeki çek/senet silinebilir; işlem görmüş çek iptal edilir',
        );
      }
      // Durum geçmişi ve portföy kaydı ON DELETE CASCADE ile temizlenir.
      await client.query('DELETE FROM cheques WHERE id = $1 AND tenant_id = current_tenant_id()', [
        id,
      ]);
      return { success: true };
    });
  }

  // ======================= Yaşam Döngüsü =======================

  /** Ciro: alınan çek başka tarafa devredilir (terminal). */
  async endorseCheque(id: string, input: EndorseChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const cheque = await this.loadActiveCheque(client, id);
      if (cheque.direction !== 'incoming') {
        throw new AppError('FORBIDDEN', 'Yalnızca alınan çek/senet cirolanabilir');
      }

      await this.transition(client, cheque, 'endorsed', input.transaction_date, userId, {
        newHolder: input.to_holder,
        party: input.party_name,
        description: input.description ?? `Ciro: ${input.party_name}`,
      });
      return this.getChequeById(id, tenantId);
    });
  }

  /** Tahsil: portföydeki çek bankaya/kasaya tahsil edilir (terminal) + muhasebe kaydı. */
  async collectCheque(id: string, input: CollectChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const cheque = await this.loadActiveCheque(client, id);
      const amount = input.amount ?? cheque.amount;

      let journalEntryId: string | null = null;
      if (await this.journalPort.isAccountingActive(tenantId)) {
        journalEntryId = await this.journalPort.postCollected(
          {
            chequeId: id,
            direction: cheque.direction as 'incoming' | 'outgoing',
            amount,
            transactionDate: input.transaction_date,
            cashBankAccountId: input.cash_bank_account_id,
            description: input.description ?? `Çek tahsilatı: ${cheque.chequeNo}`,
            userId,
          },
          client,
        );
      }

      await this.closePortfolio(client, id, input.transaction_date);
      await this.transition(client, cheque, 'collected', input.transaction_date, userId, {
        description: input.description ?? 'Tahsil edildi',
        amount,
        cashBankAccountId: input.cash_bank_account_id,
        journalEntryId,
      });
      return this.getChequeById(id, tenantId);
    });
  }

  /** Karşılıksız: bankadaki çek geri döner (terminal) + ters muhasebe kaydı. */
  async bounceCheque(id: string, input: BounceChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const cheque = await this.loadActiveCheque(client, id);
      if (cheque.portfolioHolder !== 'bank') {
        throw new AppError(
          'FORBIDDEN',
          'Karşılıksız kaydı yalnızca bankada olan çeklerde yapılır (portföy yeri: bank)',
        );
      }

      let journalEntryId: string | null = null;
      if (await this.journalPort.isAccountingActive(tenantId)) {
        journalEntryId = await this.journalPort.postBounced(
          {
            chequeId: id,
            direction: cheque.direction as 'incoming' | 'outgoing',
            amount: cheque.amount,
            transactionDate: input.transaction_date,
            cashBankAccountId: cheque.cashBankAccountId,
            description: `Çek karşılıksız: ${cheque.chequeNo} — ${input.reason}`,
            userId,
          },
          client,
        );
      }

      await this.transition(client, cheque, 'bounced', input.transaction_date, userId, {
        description: `Karşılıksız: ${input.reason}`,
        journalEntryId,
      });
      return this.getChequeById(id, tenantId);
    });
  }

  /** İptal: terminal olmayan her durumdan (terminal). */
  async cancelCheque(id: string, input: CancelChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const cheque = await this.loadActiveCheque(client, id);
      const today = new Date().toISOString().slice(0, 10);
      await this.closePortfolio(client, id, today);
      await client.query(
        `UPDATE cheques SET status = 'cancelled', cancelled_reason = $1, updated_by = $2, updated_at = now()
          WHERE id = $3 AND tenant_id = current_tenant_id()`,
        [input.reason, userId, id],
      );
      await this.insertTransaction(client, {
        chequeId: id,
        type: 'cancelled',
        fromStatus: cheque.status,
        toStatus: 'cancelled',
        date: today,
        amount: cheque.amount,
        party: null,
        journalEntryId: null,
        description: `İptal: ${input.reason}`,
        userId,
      });
      return this.getChequeById(id, tenantId);
    });
  }

  // ======================= Yardımcılar =======================

  private async loadActiveCheque(client: PoolClient, id: string): Promise<LoadedCheque> {
    const r = await client.query(
      'SELECT * FROM cheques WHERE id = $1 AND tenant_id = current_tenant_id()',
      [id],
    );
    if (r.rows.length === 0) throw new AppError('NOT_FOUND', 'Çek/senet bulunamadı');
    const row = r.rows[0];
    if (row.status !== 'portfolio') {
      throw new AppError('FORBIDDEN', `Çek/senet terminal durumda: ${row.status}`);
    }
    return {
      id: row.id,
      status: row.status,
      direction: row.direction,
      portfolioHolder: row.portfolio_holder,
      cashBankAccountId: row.cash_bank_account_id,
      amount: Number(row.amount),
      chequeNo: row.cheque_no,
    };
  }

  private async insertPortfolio(
    client: PoolClient,
    chequeId: string,
    holder: string,
    partyName: string,
    sinceDate: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO cheque_portfolio
         (id, tenant_id, cheque_id, holder, party_name, since_date)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5)`,
      [newId(), chequeId, holder, partyName, sinceDate],
    );
  }

  private async closePortfolio(
    client: PoolClient,
    chequeId: string,
    untilDate: string,
  ): Promise<void> {
    await client.query(
      `UPDATE cheque_portfolio SET until_date = $1, updated_at = now()
        WHERE tenant_id = current_tenant_id() AND cheque_id = $2 AND until_date IS NULL`,
      [untilDate, chequeId],
    );
  }

  private async insertTransaction(
    client: PoolClient,
    input: {
      chequeId: string;
      type: string;
      fromStatus: string | null;
      toStatus: string;
      date: string;
      amount?: number | null;
      party?: string | null;
      journalEntryId?: string | null;
      description?: string;
      userId: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO cheque_transactions
         (id, tenant_id, cheque_id, transaction_type, from_status, to_status,
          transaction_date, amount, party_name, journal_entry_id, description, created_by, updated_by)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [
        newId(),
        input.chequeId,
        input.type,
        input.fromStatus,
        input.toStatus,
        input.date,
        input.amount ?? null,
        input.party ?? null,
        input.journalEntryId ?? null,
        input.description ?? null,
        input.userId,
      ],
    );
  }

  /** Durum geçişi: çek kartı + portföy + durum geçmişi tek transaction. */
  private async transition(
    client: PoolClient,
    cheque: LoadedCheque,
    toStatus: string,
    date: string,
    userId: string,
    options: {
      newHolder?: string;
      party?: string;
      description?: string;
      amount?: number;
      cashBankAccountId?: string;
      journalEntryId?: string | null;
    },
  ): Promise<void> {
    await client.query(
      `UPDATE cheques SET
         status = $1,
         portfolio_holder = COALESCE($2, portfolio_holder),
         cash_bank_account_id = COALESCE($3, cash_bank_account_id),
         updated_by = $4, updated_at = now()
       WHERE id = $5 AND tenant_id = current_tenant_id()`,
      [toStatus, options.newHolder ?? null, options.cashBankAccountId ?? null, userId, cheque.id],
    );

    if (options.newHolder && options.party) {
      await this.closePortfolio(client, cheque.id, date);
      await this.insertPortfolio(client, cheque.id, options.newHolder, options.party, date);
    }

    await this.insertTransaction(client, {
      chequeId: cheque.id,
      type: toStatus,
      fromStatus: cheque.status,
      toStatus,
      date,
      amount: options.amount ?? null,
      party: options.party ?? null,
      journalEntryId: options.journalEntryId ?? null,
      description: options.description,
      userId,
    });
  }
}

// ======================= Muhasebe Port Uygulaması =======================

/**
 * Varsayılan muhasebe portu — accounting tablolarına, çağıran transaction'ın
 * client'ı ile yazar (atomik; fiş ile durum geçişi aynı işlem).
 *
 * Hesap çözümleme sırası (T-5.2 "hazır + düzenlenebilir"):
 *   1. `account_mappings` (kasa/banka → muhasebe hesabı),
 *   2. TDHP kodu fallback: 100 kasa, 102 banka, 120 müşteri borç (alınan çek),
 *      320 satıcılar alacağı (verilen çek).
 * Fiş numarası gap-free (advisory lock + MAX+1 — accounting/service.ts deseni).
 */
class AccountingJournalPort implements JournalPort {
  async isAccountingActive(tenantId?: string): Promise<boolean> {
    if (!tenantId) return false;
    try {
      const r = await getPool('app').query<{ status: string }>(
        `SELECT status FROM tenant_entitlements WHERE tenant_id = $1 AND module_code = 'accounting'`,
        [tenantId],
      );
      return r.rows[0]?.status === 'active';
    } catch {
      return false;
    }
  }

  async postCollected(ctx: ChequeJournalContext, client: PoolClient): Promise<string | null> {
    return this.writeEntry(
      client,
      ctx,
      ctx.direction === 'incoming'
        ? // Alınan çek tahsil: Borç kasa/banka, Alacak 120
          { debitSource: ctx.cashBankAccountId, creditCode: '120' }
        : // Verilen çek tahsil: Borç 320, Alacak kasa/banka
          { debitCode: '320', creditSource: ctx.cashBankAccountId },
    );
  }

  async postBounced(ctx: ChequeJournalContext, client: PoolClient): Promise<string | null> {
    return this.writeEntry(
      client,
      ctx,
      ctx.direction === 'incoming'
        ? // Alınan çek karşılıksız: Borç 120, Alacak kasa/banka (tahsilin tersi)
          { debitCode: '120', creditSource: ctx.cashBankAccountId }
        : // Verilen çek karşılıksız: Borç kasa/banka, Alacak 320 (tahsilin tersi)
          { debitSource: ctx.cashBankAccountId, creditCode: '320' },
    );
  }

  /** Çift taraflı fiş yazar; hesap çözülemezse null (kayıt atlanır). */
  private async writeEntry(
    client: PoolClient,
    ctx: ChequeJournalContext,
    side: {
      debitCode?: string;
      debitSource?: string | null;
      creditCode?: string;
      creditSource?: string | null;
    },
  ): Promise<string | null> {
    const debitAccountId = side.debitSource
      ? await this.resolveCashBankAccount(client, side.debitSource)
      : side.debitCode
        ? await this.resolveAccountByCode(client, side.debitCode)
        : null;
    const creditAccountId = side.creditSource
      ? await this.resolveCashBankAccount(client, side.creditSource)
      : side.creditCode
        ? await this.resolveAccountByCode(client, side.creditCode)
        : null;
    if (!debitAccountId || !creditAccountId) return null;

    await client.query('SELECT pg_advisory_xact_lock(hashtext(current_setting($1)))', [
      'app.tenant_id',
    ]);
    const seq = await client.query(
      'SELECT COALESCE(MAX(entry_no), 0) + 1 AS next_no FROM journal_entries WHERE tenant_id = current_tenant_id()',
    );
    const entryNo = Number(seq.rows[0].next_no);
    const entryId = newId();

    await client.query(
      `INSERT INTO journal_entries
         (id, tenant_id, entry_no, entry_date, entry_type, status, description,
          source_type, source_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
       VALUES ($1, current_tenant_id(), $2, $3, 'mahsup', 'posted', $4, 'cheque', $5, $6, $6, $7, now(), $7, $7)`,
      [
        entryId,
        entryNo,
        ctx.transactionDate,
        ctx.description,
        ctx.chequeId,
        ctx.amount,
        ctx.userId,
      ],
    );

    const lines: Array<{ accountId: string; debit: number; credit: number }> = [
      { accountId: debitAccountId, debit: ctx.amount, credit: 0 },
      { accountId: creditAccountId, debit: 0, credit: ctx.amount },
    ];
    let lineNo = 1;
    for (const l of lines) {
      await client.query(
        `INSERT INTO journal_lines
           (id, tenant_id, entry_id, line_no, account_id, description, debit, credit, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8)`,
        [newId(), entryId, lineNo, l.accountId, ctx.description, l.debit, l.credit, ctx.userId],
      );
      lineNo++;
    }
    return entryId;
  }

  /** Kasa/banka kartının eşlemiş muhasebe hesabı (account_mappings → TDHP fallback). */
  private async resolveCashBankAccount(
    client: PoolClient,
    accountId: string,
  ): Promise<string | null> {
    const r = await client.query(
      `SELECT aa.id
         FROM cash_bank_accounts cba
         JOIN account_mappings am
           ON am.tenant_id = cba.tenant_id
          AND am.source_type = (CASE WHEN cba.account_type = 'bank' THEN 'bank' ELSE 'cash' END)
          AND am.direction = 'debit'
         JOIN accounting_accounts aa
           ON aa.id = am.account_id AND aa.tenant_id = cba.tenant_id
        WHERE cba.id = $1 AND cba.tenant_id = current_tenant_id()
        LIMIT 1`,
      [accountId],
    );
    if (r.rows.length > 0) return r.rows[0].id;
    // Fallback: hesabın tipine göre TDHP kodu.
    const type = await client.query(
      'SELECT account_type FROM cash_bank_accounts WHERE id = $1 AND tenant_id = current_tenant_id()',
      [accountId],
    );
    const code = type.rows[0]?.account_type === 'bank' ? '102' : '100';
    return this.resolveAccountByCode(client, code);
  }

  private async resolveAccountByCode(client: PoolClient, code: string): Promise<string | null> {
    const r = await client.query(
      'SELECT id FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1 LIMIT 1',
      [code],
    );
    return r.rows[0]?.id ?? null;
  }
}

// ======================= Row Mapper'lar =======================

function toDateString(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.slice(0, 10);
  return null;
}

function mapChequeRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    chequeType: row.cheque_type,
    direction: row.direction,
    serialNo: row.serial_no,
    chequeNo: row.cheque_no,
    bankName: row.bank_name,
    branch: row.branch,
    accountNo: row.account_no,
    drawerName: row.drawer_name,
    endorserName: row.endorser_name,
    issueDate: toDateString(row.issue_date),
    dueDate: toDateString(row.due_date),
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    portfolioHolder: row.portfolio_holder,
    contactId: row.contact_id,
    cashBankAccountId: row.cash_bank_account_id,
    description: row.description,
    cancelledReason: row.cancelled_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPortfolioRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    chequeId: row.cheque_id,
    holder: row.holder,
    partyName: row.party_name,
    sinceDate: toDateString(row.since_date),
    untilDate: toDateString(row.until_date),
    notes: row.notes,
  };
}

function mapTransactionRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    chequeId: row.cheque_id,
    transactionType: row.transaction_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    transactionDate: toDateString(row.transaction_date),
    amount: row.amount != null ? Number(row.amount) : null,
    partyName: row.party_name,
    journalEntryId: row.journal_entry_id,
    description: row.description,
    createdAt: row.created_at,
  };
}
