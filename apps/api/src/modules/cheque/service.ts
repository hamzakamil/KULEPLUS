import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import { allocateEntryNo, openPeriodFor, round2, todayIso } from '../accounting/ledger.js';
import { cashBankLedgerAccount, ensureAccountByCode } from '../accounting/subledger.js';
import { accountingService } from '../accounting/service.js';
import { ensureChartOfAccountsOn } from '../accounting/chart.js';
import type { Pool, PoolClient } from 'pg';
import type {
  CreateChequeInput,
  UpdateChequeInput,
  ChequeListQuery,
  EndorseChequeInput,
  CollectChequeInput,
  DepositChequeInput,
  PledgeChequeInput,
  ReleaseChequeInput,
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
 * Portföy içi yer değişimi (durum 'portfolio' kalır — Faz 7-4):
 *   own ─tahsile ver▸ bank,  own ─teminata ver▸ pledged,  bank|pledged ─geri al▸ own
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
  /** Çek mi senet mi (alınan senet 121.xx, verilen senet 321; çek 101.xx / 103). */
  chequeType?: 'cheque' | 'promissory';
  /** İşlem öncesi portföy yeri (own/bank/pledged) — alacaklandırılacak 101.0x hesabı. */
  fromHolder?: string;
  /** İşlem sonrası portföy yeri. */
  toHolder?: string;
}

/** Fiş üreten çek olayları (Faz 7-4). */
export type ChequeLedgerEvent = 'created' | 'deposited' | 'pledged' | 'released' | 'endorsed';

/** Muhasebe portu — varsayılan implementasyon accounting tablolarına yazar. */
export interface JournalPort {
  /** Muhuhasebe modülü açık mı? (tenant_entitlements) */
  isAccountingActive(tenantId?: string): Promise<boolean>;
  /** Tahsil kaydı: borç kasa/banka, alacak 120/320. Fiş id döner (çözülemezse null). */
  postCollected(ctx: ChequeJournalContext, client: PoolClient): Promise<string | null>;
  /** Karşılıksız kaydı. Fiş id döner (çözülemezse null). */
  postBounced(ctx: ChequeJournalContext, client: PoolClient): Promise<string | null>;
  /** Diğer olaylar (alış/veriliş, tahsile/teminata verme, geri alma, ciro). */
  postEvent?(
    event: ChequeLedgerEvent,
    ctx: ChequeJournalContext,
    client: PoolClient,
  ): Promise<string | null>;
  /** İptalde bu çeke ait (ters çevrilmemiş) tüm fişleri ters kayıtla düzeltir. */
  reverseAll?(chequeId: string, userId: string, date: string, client: PoolClient): Promise<number>;
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
  chequeType: 'cheque' | 'promissory';
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
    return this.withTenantClient(tenantId, (client) => this.loadCheque(client, id));
  }

  /**
   * Aynı client ile okur: işlem sonrası kaydı ikinci bir bağlantıdan (`getChequeById`)
   * okumak commit edilmemiş satırı göremez → yeni çekte null, işlemlerde eski veri dönüyordu.
   */
  private async loadCheque(client: PoolClient, id: string) {
    const r = await client.query(
      'SELECT * FROM cheques WHERE id = $1 AND tenant_id = current_tenant_id()',
      [id],
    );
    if (r.rows.length === 0) return null;
    return mapChequeRow(r.rows[0]);
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
      // Alınan: 101.0x/121.0x B / 120 A — verilen: 320 B / 103/321 A (Faz 7-4).
      let journalEntryId: string | null = null;
      if (this.journalPort.postEvent && (await this.journalPort.isAccountingActive(tenantId))) {
        journalEntryId = await this.journalPort.postEvent(
          'created',
          {
            chequeId,
            direction: input.direction,
            amount: input.amount,
            transactionDate: input.issue_date,
            cashBankAccountId: input.cash_bank_account_id ?? null,
            description: `${input.direction === 'incoming' ? 'Alınan' : 'Verilen'} ${
              input.cheque_type === 'promissory' ? 'senet' : 'çek'
            }: ${input.cheque_no} — ${input.drawer_name}`,
            userId,
            chequeType: input.cheque_type,
            toHolder: input.portfolio_holder,
          },
          client,
        );
      }
      await this.insertTransaction(client, {
        chequeId,
        type: 'created',
        fromStatus: null,
        toStatus: 'portfolio',
        date: input.issue_date,
        amount: input.amount,
        party: null,
        journalEntryId,
        description: 'Çek/senet kaydı oluşturuldu',
        userId,
      });

      return this.loadCheque(client, chequeId);
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
      return this.loadCheque(client, id);
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
      if (cheque.portfolioHolder !== 'own') {
        throw new AppError(
          'FORBIDDEN',
          'Tahsildeki veya teminattaki çek cirolanamaz; önce portföye geri alın',
        );
      }

      if (!['customer', 'supplier'].includes(input.to_holder)) {
        throw new AppError('VALIDATION_ERROR', 'Ciro yalnızca tedarikçiye veya müşteriye yapılır');
      }
      // Ciro: 320 (tedarikçiye) / 120 (müşteriye) B — 101.0x/121.0x A
      const journalEntryId = await this.postEventIfActive(client, tenantId, 'endorsed', cheque, {
        transactionDate: input.transaction_date,
        description: input.description ?? `Çek ciro: ${cheque.chequeNo} → ${input.party_name}`,
        userId,
        toHolder: input.to_holder,
      });
      await this.transition(client, cheque, 'endorsed', input.transaction_date, userId, {
        newHolder: input.to_holder,
        party: input.party_name,
        description: input.description ?? `Ciro: ${input.party_name}`,
        journalEntryId,
      });
      return this.loadCheque(client, id);
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
            chequeType: cheque.chequeType,
            fromHolder: cheque.portfolioHolder,
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
      return this.loadCheque(client, id);
    });
  }

  /** Karşılıksız: bankadaki çek geri döner (terminal) + ters muhasebe kaydı. */
  async bounceCheque(id: string, input: BounceChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const cheque = await this.loadActiveCheque(client, id);
      if (
        cheque.direction === 'incoming' &&
        !['bank', 'pledged', 'own'].includes(cheque.portfolioHolder)
      ) {
        throw new AppError(
          'FORBIDDEN',
          'Karşılıksız kaydı yalnızca portföydeki/bankadaki çekte yapılır',
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
            chequeType: cheque.chequeType,
            fromHolder: cheque.portfolioHolder,
          },
          client,
        );
      }

      await this.transition(client, cheque, 'bounced', input.transaction_date, userId, {
        description: `Karşılıksız: ${input.reason}`,
        journalEntryId,
      });
      return this.loadCheque(client, id);
    });
  }

  /** Tahsile verme: portföydeki alınan çek/senet bankaya verilir (101.02 B / 101.01 A). */
  async depositCheque(id: string, input: DepositChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const cheque = await this.loadActiveCheque(client, id);
      this.assertIncomingAt(cheque, ['own'], 'tahsile verilebilir');
      const journalEntryId = await this.postEventIfActive(client, tenantId, 'deposited', cheque, {
        transactionDate: input.transaction_date,
        description: input.description ?? `Çek tahsile verildi: ${cheque.chequeNo}`,
        userId,
        toHolder: 'bank',
        cashBankAccountId: input.cash_bank_account_id,
      });
      await this.moveWithinPortfolio(
        client,
        cheque,
        'bank',
        'deposited',
        input.transaction_date,
        userId,
        {
          party: 'Banka (tahsil)',
          description: input.description ?? 'Tahsile verildi',
          cashBankAccountId: input.cash_bank_account_id,
          journalEntryId,
        },
      );
      return this.loadCheque(client, id);
    });
  }

  /** Teminata verme: portföydeki alınan çek/senet teminat olarak verilir (101.03 B / 101.01 A). */
  async pledgeCheque(id: string, input: PledgeChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const cheque = await this.loadActiveCheque(client, id);
      this.assertIncomingAt(cheque, ['own'], 'teminata verilebilir');
      const journalEntryId = await this.postEventIfActive(client, tenantId, 'pledged', cheque, {
        transactionDate: input.transaction_date,
        description:
          input.description ?? `Çek teminata verildi: ${cheque.chequeNo} → ${input.party_name}`,
        userId,
        toHolder: 'pledged',
      });
      await this.moveWithinPortfolio(
        client,
        cheque,
        'pledged',
        'pledged',
        input.transaction_date,
        userId,
        {
          party: input.party_name,
          description: input.description ?? `Teminata verildi: ${input.party_name}`,
          journalEntryId,
        },
      );
      return this.loadCheque(client, id);
    });
  }

  /** Geri alma: tahsilden veya teminattan portföye dönüş (101.01 B / 101.02|101.03 A). */
  async releaseCheque(id: string, input: ReleaseChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const cheque = await this.loadActiveCheque(client, id);
      this.assertIncomingAt(cheque, ['bank', 'pledged'], 'portföye geri alınabilir');
      const journalEntryId = await this.postEventIfActive(client, tenantId, 'released', cheque, {
        transactionDate: input.transaction_date,
        description: input.description ?? `Çek portföye geri alındı: ${cheque.chequeNo}`,
        userId,
        toHolder: 'own',
      });
      await this.moveWithinPortfolio(
        client,
        cheque,
        'own',
        'released',
        input.transaction_date,
        userId,
        {
          party: 'Portföy',
          description: input.description ?? 'Portföye geri alındı',
          journalEntryId,
        },
      );
      return this.loadCheque(client, id);
    });
  }

  private assertIncomingAt(cheque: LoadedCheque, holders: string[], action: string) {
    if (cheque.direction !== 'incoming') {
      throw new AppError('FORBIDDEN', `Yalnızca alınan çek/senet ${action}`);
    }
    if (!holders.includes(cheque.portfolioHolder)) {
      throw new AppError(
        'FORBIDDEN',
        `Bu işlem için çek/senedin yeri ${holders.join(' veya ')} olmalı (şu an: ${cheque.portfolioHolder})`,
      );
    }
  }

  /** Muhasebe aktifse olay fişini yazar (port destekliyorsa). */
  private async postEventIfActive(
    client: PoolClient,
    tenantId: string | undefined,
    event: ChequeLedgerEvent,
    cheque: LoadedCheque,
    extra: {
      transactionDate: string;
      description: string;
      userId: string;
      toHolder?: string;
      cashBankAccountId?: string | null;
    },
  ): Promise<string | null> {
    if (!this.journalPort.postEvent) return null;
    if (!(await this.journalPort.isAccountingActive(tenantId))) return null;
    return this.journalPort.postEvent(
      event,
      {
        chequeId: cheque.id,
        direction: cheque.direction as 'incoming' | 'outgoing',
        amount: cheque.amount,
        transactionDate: extra.transactionDate,
        cashBankAccountId: extra.cashBankAccountId ?? cheque.cashBankAccountId,
        description: extra.description,
        userId: extra.userId,
        chequeType: cheque.chequeType,
        fromHolder: cheque.portfolioHolder,
        toHolder: extra.toHolder,
      },
      client,
    );
  }

  /** Durum 'portfolio' kalırken yer değiştirir + portföy ve durum geçmişi yazar. */
  private async moveWithinPortfolio(
    client: PoolClient,
    cheque: LoadedCheque,
    toHolder: string,
    transactionType: string,
    date: string,
    userId: string,
    options: {
      party: string;
      description: string;
      cashBankAccountId?: string;
      journalEntryId: string | null;
    },
  ) {
    await client.query(
      `UPDATE cheques SET portfolio_holder = $1,
              cash_bank_account_id = COALESCE($2, cash_bank_account_id),
              updated_by = $3, updated_at = now()
        WHERE id = $4 AND tenant_id = current_tenant_id()`,
      [toHolder, options.cashBankAccountId ?? null, userId, cheque.id],
    );
    await this.closePortfolio(client, cheque.id, date);
    await this.insertPortfolio(client, cheque.id, toHolder, options.party, date);
    await this.insertTransaction(client, {
      chequeId: cheque.id,
      type: transactionType,
      fromStatus: cheque.status,
      toStatus: 'portfolio',
      date,
      amount: cheque.amount,
      party: options.party,
      journalEntryId: options.journalEntryId,
      description: options.description,
      userId,
    });
  }

  /** İptal: terminal olmayan her durumdan (terminal). */
  async cancelCheque(id: string, input: CancelChequeInput, userId: string, tenantId?: string) {
    return this.withTenantClient(tenantId, async (client) => {
      const cheque = await this.loadActiveCheque(client, id);
      const today = todayIso();
      // Bu çeke ait fişler (alış, tahsile verme vb.) ters kayıtla düzeltilir (Faz 7-4).
      if (this.journalPort.reverseAll) {
        await this.journalPort.reverseAll(id, userId, today, client);
      }
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
      return this.loadCheque(client, id);
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
      chequeType: row.cheque_type === 'promissory' ? 'promissory' : 'cheque',
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

  /**
   * Tahsil. Alınan: kasa/banka B / 101.0x (bulunduğu yer) A; verilen: 103/321 B / banka A.
   * Çekin alış fişi yoksa (Faz 7-4 öncesi kayıt) eski davranış: karşı hesap 120/320.
   */
  async postCollected(ctx: ChequeJournalContext, client: PoolClient): Promise<string | null> {
    await ensureChartOfAccountsOn(client);
    if (!ctx.cashBankAccountId) return null;
    const cash = await cashBankLedgerAccount(client, ctx.cashBankAccountId);
    if (!cash) return null;
    const legacy = !(await this.hasEntries(client, ctx.chequeId));
    if (ctx.direction === 'incoming') {
      const credit = legacy
        ? await this.byCode(client, '120')
        : await this.holdingAccount(client, ctx, ctx.fromHolder ?? 'own');
      return this.writeEntry(client, ctx, cash, credit);
    }
    const debit = legacy ? await this.byCode(client, '320') : await this.issuedAccount(client, ctx);
    return this.writeEntry(client, ctx, debit, cash);
  }

  /**
   * Karşılıksız. Alınan: 128 Şüpheli Ticari Alacaklar B / 101.0x A (eski kayıtta 120 A);
   * verilen (ödenmedi): 103/321 B / 320 A — borç tedarikçiye geri döner.
   */
  async postBounced(ctx: ChequeJournalContext, client: PoolClient): Promise<string | null> {
    await ensureChartOfAccountsOn(client);
    const legacy = !(await this.hasEntries(client, ctx.chequeId));
    if (ctx.direction === 'incoming') {
      const doubtful = await this.byCode(client, '128');
      const credit = legacy
        ? await this.byCode(client, '120')
        : await this.holdingAccount(client, ctx, ctx.fromHolder ?? 'own');
      return this.writeEntry(client, ctx, doubtful, credit);
    }
    if (legacy) return null;
    return this.writeEntry(
      client,
      ctx,
      await this.issuedAccount(client, ctx),
      await this.byCode(client, '320'),
    );
  }

  async postEvent(
    event: ChequeLedgerEvent,
    ctx: ChequeJournalContext,
    client: PoolClient,
  ): Promise<string | null> {
    await ensureChartOfAccountsOn(client);
    if (event === 'created') {
      if (ctx.direction === 'incoming') {
        // Alınan çek/senet: portföy (veya verilen yer) B / 120 Alıcılar A
        return this.writeEntry(
          client,
          ctx,
          await this.holdingAccount(client, ctx, ctx.toHolder ?? 'own'),
          await this.byCode(client, '120'),
        );
      }
      // Verilen çek/senet: 320 Satıcılar B / 103 Verilen Çekler | 321 Borç Senetleri A
      return this.writeEntry(
        client,
        ctx,
        await this.byCode(client, '320'),
        await this.issuedAccount(client, ctx),
      );
    }
    const legacy = !(await this.hasEntries(client, ctx.chequeId));
    if (event === 'endorsed') {
      const debit = await this.byCode(client, ctx.toHolder === 'customer' ? '120' : '320');
      const credit = legacy
        ? await this.byCode(client, '120')
        : await this.holdingAccount(client, ctx, ctx.fromHolder ?? 'own');
      return this.writeEntry(client, ctx, debit, credit);
    }
    // Portföy içi yer değişimi: eski kayıtlarda 101.0x bakiyesi olmadığından fiş yazılmaz.
    if (legacy) return null;
    return this.writeEntry(
      client,
      ctx,
      await this.holdingAccount(client, ctx, ctx.toHolder ?? 'own'),
      await this.holdingAccount(client, ctx, ctx.fromHolder ?? 'own'),
    );
  }

  async reverseAll(chequeId: string, userId: string, date: string, client: PoolClient) {
    const r = await client.query(
      `SELECT je.id FROM journal_entries je
        WHERE je.tenant_id = current_tenant_id() AND je.source_type = 'cheque' AND je.source_id = $1
          AND je.status = 'posted' AND je.entry_type <> 'ters'
          AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = je.id)
        ORDER BY je.fiscal_year DESC, je.entry_no DESC`,
      [chequeId],
    );
    for (const row of r.rows) {
      await accountingService.reverseEntryOn(client, String(row.id), userId, date, {
        allowSource: true,
      });
    }
    return r.rows.length;
  }

  /** Bu çeke ait onaylı fiş var mı? (Faz 7-4 öncesi kayıtlarda yok → eski hesaplama) */
  private async hasEntries(client: PoolClient, chequeId: string): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM journal_entries
        WHERE tenant_id = current_tenant_id() AND source_type = 'cheque' AND source_id = $1
          AND status = 'posted' LIMIT 1`,
      [chequeId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Alınan çek/senedin bulunduğu yere göre hesabı (yoksa açılır):
   * çek 101.01 portföy / 101.02 tahsilde / 101.03 teminatta; senet 121.01 / 121.02 / 121.03.
   */
  private async holdingAccount(
    client: PoolClient,
    ctx: ChequeJournalContext,
    holder: string,
  ): Promise<string> {
    const promissory = ctx.chequeType === 'promissory';
    const parent = promissory ? '121' : '101';
    const noun = promissory ? 'Senetler' : 'Çekler';
    const [suffix, label] =
      holder === 'bank'
        ? ['02', `Tahsile Verilen ${noun}`]
        : holder === 'pledged'
          ? ['03', promissory ? 'Teminattaki Senetler' : 'Teminata Verilen Çekler']
          : ['01', `Portföydeki ${noun}`];
    return ensureAccountByCode(client, `${parent}.${suffix}`, label, parent);
  }

  /** Verilen çek → 103 Verilen Çekler ve Ödeme Emirleri; verilen senet → 321 Borç Senetleri. */
  private async issuedAccount(client: PoolClient, ctx: ChequeJournalContext): Promise<string> {
    return this.byCode(client, ctx.chequeType === 'promissory' ? '321' : '103');
  }

  private async byCode(client: PoolClient, code: string): Promise<string> {
    const r = await client.query(
      'SELECT id FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1 LIMIT 1',
      [code],
    );
    if (!r.rows[0]) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Muhasebe hesabı bulunamadı: ${code} (hesap planını kurun)`,
      );
    }
    return String(r.rows[0].id);
  }

  /** Çift taraflı fiş (dönem kapısı + gap-free numara). */
  private async writeEntry(
    client: PoolClient,
    ctx: ChequeJournalContext,
    debitAccountId: string,
    creditAccountId: string,
  ): Promise<string> {
    const periodId = await openPeriodFor(client, ctx.transactionDate);
    const entryNo = await allocateEntryNo(client, periodId);
    const entryId = newId();
    const amount = round2(ctx.amount);
    await client.query(
      `INSERT INTO journal_entries
         (id, tenant_id, entry_no, entry_date, period_id, entry_type, status, description,
          source_type, source_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
       VALUES ($1, current_tenant_id(), $2, $3, $4, 'mahsup', 'posted', $5, 'cheque', $6, $7, $7, $8, now(), $8, $8)`,
      [
        entryId,
        entryNo,
        ctx.transactionDate,
        periodId,
        ctx.description,
        ctx.chequeId,
        amount,
        ctx.userId,
      ],
    );
    let lineNo = 1;
    for (const l of [
      { accountId: debitAccountId, debit: amount, credit: 0 },
      { accountId: creditAccountId, debit: 0, credit: amount },
    ]) {
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
