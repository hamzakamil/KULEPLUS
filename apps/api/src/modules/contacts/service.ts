import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import type { CreateContactInput, UpdateContactInput } from './schemas.js';

export type ContactRow = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  trade_name: string | null;
  type: string;
  tax_number: string | null;
  tax_office: string | null;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  version: number;
};

export type ContactWithDetails = ContactRow & {
  addresses: ContactAddressRow[];
  phones: ContactPhoneRow[];
  emails: ContactEmailRow[];
  relations: ContactRelationRow[];
};

export type ContactAddressRow = {
  id: string;
  contact_id: string;
  is_primary: boolean;
  type: string;
  province: string | null;
  district: string | null;
  neighborhood: string | null;
  street: string | null;
  building: string | null;
  apartment: string | null;
  zip_code: string | null;
  parsed: Record<string, unknown>;
  created_at: Date;
};

export type ContactPhoneRow = {
  id: string;
  contact_id: string;
  is_primary: boolean;
  type: string;
  number: string;
  formatted: string | null;
  parsed: Record<string, unknown>;
  created_at: Date;
};

export type ContactEmailRow = {
  id: string;
  contact_id: string;
  is_primary: boolean;
  type: string;
  email: string;
  validated: boolean;
  created_at: Date;
};

export type ContactRelationRow = {
  id: string;
  contact_id: string;
  related_contact_id: string;
  relation_type: string;
  notes: string | null;
  created_at: Date;
};

export class ContactService {
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

  /** Tüm cari listesini getir (filtreleme, sıralama, sayfalama ile) */
  async listContacts(options: {
    page?: number;
    limit?: number;
    sort?: string;
    order?: 'asc' | 'desc';
    type?: string;
    is_active?: boolean;
    q?: string;
    offset?: number;
    cursor?: string | null;
  }) {
    const pool = this.getPoolInstance();
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = options.offset ?? (page - 1) * limit;
    // Kritik: ORDER BY SQL enjeksiyonunu kapat — saf liste (whitelist) dışı değer reddedilir.
    const ALLOWED_SORT = new Set(['code', 'name', 'created_at', 'updated_at', 'type']);
    const sort = ALLOWED_SORT.has(options.sort ?? '') ? (options.sort as string) : 'code';
    const order = options.order === 'desc' ? 'desc' : 'asc';
    const type = options.type;
    const isActive = options.is_active;
    const search = options.q?.trim() ?? '';

    // WHERE koşulları
    const whereConditions = ['tenant_id = current_tenant_id()'];
    const values: unknown[] = [];

    if (type) {
      whereConditions.push(`type = $${values.length + 1}`);
      values.push(type);
    }
    if (isActive !== undefined) {
      whereConditions.push(`is_active = $${values.length + 1}`);
      values.push(isActive);
    }
    if (search) {
      const firstIndex = values.length + 1;
      whereConditions.push(
        `(name ILIKE $${firstIndex} OR code ILIKE $${firstIndex + 1} OR trade_name ILIKE $${firstIndex + 2})`,
      );
      const searchTerm = `%${search}%`;
      values.push(searchTerm, searchTerm, searchTerm);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count query
    const countResult = await pool.query(`SELECT COUNT(*) FROM contacts ${whereClause}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    // Main query
    const dataResult = await pool.query(
      `SELECT c.*, 
              (SELECT jsonb_agg(a ORDER BY a.is_primary DESC, a.created_at) 
               FROM contact_addresses a 
               WHERE a.contact_id = c.id) AS addresses,
              (SELECT jsonb_agg(p ORDER BY p.is_primary DESC, p.created_at) 
               FROM contact_phones p 
               WHERE p.contact_id = c.id) AS phones,
              (SELECT jsonb_agg(e ORDER BY e.is_primary DESC, e.created_at) 
               FROM contact_emails e 
               WHERE e.contact_id = c.id) AS emails,
              (SELECT jsonb_agg(r ORDER BY r.created_at) 
               FROM contact_relations r 
               WHERE r.contact_id = c.id) AS relations
       FROM contacts c 
        ${whereClause}
        ORDER BY ${sort} ${order}
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    return {
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /** Tek cari getir (ID'ye göre) */
  async getContact(id: string): Promise<ContactWithDetails | null> {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT c.*, 
              (SELECT jsonb_agg(a ORDER BY a.is_primary DESC, a.created_at) 
               FROM contact_addresses a 
               WHERE a.contact_id = c.id) AS addresses,
              (SELECT jsonb_agg(p ORDER BY p.is_primary DESC, p.created_at) 
               FROM contact_phones p 
               WHERE p.contact_id = c.id) AS phones,
              (SELECT jsonb_agg(e ORDER BY e.is_primary DESC, e.created_at) 
               FROM contact_emails e 
               WHERE e.contact_id = c.id) AS emails,
              (SELECT jsonb_agg(r ORDER BY r.created_at) 
               FROM contact_relations r 
               WHERE r.contact_id = c.id) AS relations
       FROM contacts c 
       WHERE c.id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );

    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    return {
      ...row,
      addresses: row.addresses ?? [],
      phones: row.phones ?? [],
      emails: row.emails ?? [],
      relations: row.relations ?? [],
    };
  }

  /**
   * Denetim kaydı — yazma işlemiyle AYNI transaction'da (ADR-0016, SPEC §27.3).
   * tenant_id sunucu tarafında `current_tenant_id()` ile bağlanır (body'den gelmez).
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
       VALUES ($1, current_tenant_id(), $2, $3, 'contacts', $4, $5, $6, now())`,
      [
        newId(),
        entry.userId ?? null,
        entry.action,
        entry.entityId,
        entry.oldValues ? JSON.stringify(entry.oldValues) : null,
        entry.newValues ? JSON.stringify(entry.newValues) : null,
      ],
    );
  }

  /** Yeni cari oluştur */
  async createContact(
    data: CreateContactInput,
    userId?: string,
  ): Promise<ContactWithDetails | null> {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Kontrol: Aynı tenant içinde aynı kod var mı?
      const codeCheck = await client.query(
        'SELECT id FROM contacts WHERE tenant_id = current_tenant_id() AND code = $1',
        [data.code],
      );
      if ((codeCheck as { rowCount: number }).rowCount > 0) {
        throw new AppError('CONFLICT', 'Bu kod zaten kullanımda');
      }

      // Cari oluştur (SPEC §0.1/ADR-0002: id uygulaması üretir — UUID v7, DB default'u yok)
      const contactId = newId();
      const _contactResult = await client.query(
        `INSERT INTO contacts (
          id, tenant_id, code, name, trade_name, type, tax_number, tax_office,
          is_active, settings, created_at, updated_at
        ) VALUES (
          $1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, now(), now()
        ) RETURNING *`,
        [
          contactId,
          data.code,
          data.name,
          data.trade_name ?? null,
          data.type,
          data.tax_number ?? null,
          data.tax_office ?? null,
          data.is_active ?? true,
          JSON.stringify(data.settings ?? {}),
        ],
      );

      // Adresler
      for (const addr of data.addresses ?? []) {
        await client.query(
          `INSERT INTO contact_addresses (
            id, contact_id, is_primary, type, province, district, neighborhood,
            street, building, apartment, zip_code, parsed, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now()
          )`,
          [
            newId(),
            contactId,
            addr.is_primary ?? false,
            addr.type ?? 'default',
            addr.province ?? null,
            addr.district ?? null,
            addr.neighborhood ?? null,
            addr.street ?? null,
            addr.building ?? null,
            addr.apartment ?? null,
            addr.zip_code ?? null,
            JSON.stringify(addr.parsed ?? {}),
          ],
        );
      }

      // Telefonlar
      for (const phone of data.phones ?? []) {
        await client.query(
          `INSERT INTO contact_phones (
            id, contact_id, is_primary, type, number, formatted, parsed, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, now()
          )`,
          [
            newId(),
            contactId,
            phone.is_primary ?? false,
            phone.type ?? 'mobile',
            phone.number,
            phone.formatted ?? null,
            JSON.stringify(phone.parsed ?? {}),
          ],
        );
      }

      // E-postalar
      for (const email of data.emails ?? []) {
        await client.query(
          `INSERT INTO contact_emails (
            id, contact_id, is_primary, type, email, validated, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, now()
          )`,
          [
            newId(),
            contactId,
            email.is_primary ?? false,
            email.type ?? 'default',
            email.email,
            email.validated ?? false,
          ],
        );
      }

      // İlişkiler
      for (const rel of data.relations ?? []) {
        await client.query(
          `INSERT INTO contact_relations (
            id, contact_id, related_contact_id, relation_type, notes, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, now()
          )`,
          [newId(), contactId, rel.related_contact_id, rel.relation_type, rel.notes ?? null],
        );
      }

      // Denetim izi — cari kaydıyla AYNI transaction'da (ADR-0016, SPEC §27.3)
      await this.writeAudit(client, {
        userId,
        action: 'contacts.create',
        entityId: contactId,
        newValues: { code: data.code, name: data.name, type: data.type },
      });

      await client.query('COMMIT');
      return this.getContact(contactId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Cari güncelle */
  async updateContact(
    id: string,
    data: UpdateContactInput,
    userId?: string,
  ): Promise<ContactWithDetails | null> {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Varolup olmadığını kontrol et (denetim izi için eski değerler de okunur)
      const existing = await client.query(
        'SELECT id, code, name, type FROM contacts WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (existing.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      // Kontrol: Kod çakışması (varsa)
      if (data.code !== undefined) {
        const codeCheck = await client.query(
          'SELECT id FROM contacts WHERE tenant_id = current_tenant_id() AND code = $1 AND id <> $2',
          [data.code, id],
        );
        if ((codeCheck as { rowCount: number }).rowCount > 0) {
          await client.query('ROLLBACK');
          throw new AppError('CONFLICT', 'Bu kod zaten kullanımda');
        }
      }

      // Cariyi güncelle
      const fields: string[] = [];
      const values: unknown[] = [];
      let valueIndex = 1;

      if (data.code !== undefined) {
        fields.push(`code = $${valueIndex++}`);
        values.push(data.code);
      }
      if (data.name !== undefined) {
        fields.push(`name = $${valueIndex++}`);
        values.push(data.name);
      }
      if (data.trade_name !== undefined) {
        fields.push(`trade_name = $${valueIndex++}`);
        values.push(data.trade_name ?? null);
      }
      if (data.type !== undefined) {
        fields.push(`type = $${valueIndex++}`);
        values.push(data.type);
      }
      if (data.tax_number !== undefined) {
        fields.push(`tax_number = $${valueIndex++}`);
        values.push(data.tax_number ?? null);
      }
      if (data.tax_office !== undefined) {
        fields.push(`tax_office = $${valueIndex++}`);
        values.push(data.tax_office ?? null);
      }
      if (data.is_active !== undefined) {
        fields.push(`is_active = $${valueIndex++}`);
        values.push(data.is_active);
      }
      if (data.settings !== undefined) {
        fields.push(`settings = $${valueIndex++}`);
        values.push(JSON.stringify(data.settings));
      }
      fields.push(`updated_at = now()`);

      if (fields.length === 0) {
        await client.query('ROLLBACK');
        return this.getContact(id);
      }

      values.push(id);
      await client.query(
        `UPDATE contacts SET ${fields.join(', ')} WHERE id = $${valueIndex++} AND tenant_id = current_tenant_id()`,
        values,
      );

      // İlişkili kayıtları güncellemek yerine silip yeniden oluşturuyoruz (basitlik için)
      // Ürünlerde daha karmaşık senaryolar için ayrı güncelleme endpoint'leri eklenebilir

      // Adresleri yeniden oluştur
      if (data.addresses !== undefined) {
        await client.query('DELETE FROM contact_addresses WHERE contact_id = $1', [id]);
        for (const addr of data.addresses) {
          await client.query(
            `INSERT INTO contact_addresses (
              contact_id, is_primary, type, province, district, neighborhood, 
              street, building, apartment, zip_code, parsed, created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
            )`,
            [
              id,
              addr.is_primary ?? false,
              addr.type ?? 'default',
              addr.province ?? null,
              addr.district ?? null,
              addr.neighborhood ?? null,
              addr.street ?? null,
              addr.building ?? null,
              addr.apartment ?? null,
              addr.zip_code ?? null,
              JSON.stringify(addr.parsed ?? {}),
            ],
          );
        }
      }

      // Telefonları yeniden oluştur
      if (data.phones !== undefined) {
        await client.query('DELETE FROM contact_phones WHERE contact_id = $1', [id]);
        for (const phone of data.phones) {
          await client.query(
            `INSERT INTO contact_phones (
              contact_id, is_primary, type, number, formatted, parsed, created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, now()
            )`,
            [
              id,
              phone.is_primary ?? false,
              phone.type ?? 'mobile',
              phone.number,
              phone.formatted ?? null,
              JSON.stringify(phone.parsed ?? {}),
            ],
          );
        }
      }

      // E-postaları yeniden oluştur
      if (data.emails !== undefined) {
        await client.query('DELETE FROM contact_emails WHERE contact_id = $1', [id]);
        for (const email of data.emails) {
          await client.query(
            `INSERT INTO contact_emails (
              contact_id, is_primary, type, email, validated, created_at
            ) VALUES (
              $1, $2, $3, $4, $5, now()
            )`,
            [
              id,
              email.is_primary ?? false,
              email.type ?? 'default',
              email.email,
              email.validated ?? false,
            ],
          );
        }
      }

      // İlişkileri yeniden oluştur
      if (data.relations !== undefined) {
        await client.query('DELETE FROM contact_relations WHERE contact_id = $1', [id]);
        for (const rel of data.relations) {
          await client.query(
            `INSERT INTO contact_relations (
              contact_id, related_contact_id, relation_type, notes, created_at
            ) VALUES (
              $1, $2, $3, $4, now()
            )`,
            [id, rel.related_contact_id, rel.relation_type, rel.notes ?? null],
          );
        }
      }

      // Denetim izi — güncellemeyle AYNI transaction'da (ADR-0016, SPEC §27.3).
      // new_values: yalnız gönderilen skaler alanlar (adres/telefon dizileri hariç).
      const scalarUpdates: Record<string, unknown> = {};
      for (const key of [
        'code',
        'name',
        'trade_name',
        'type',
        'tax_number',
        'tax_office',
        'is_active',
        'settings',
      ] as const) {
        const value = (data as Record<string, unknown>)[key];
        if (value !== undefined) scalarUpdates[key] = value;
      }
      await this.writeAudit(client, {
        userId,
        action: 'contacts.update',
        entityId: id,
        oldValues: (existing.rows?.[0] as Record<string, unknown> | undefined) ?? null,
        newValues: scalarUpdates,
      });

      await client.query('COMMIT');
      return this.getContact(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Cari sil (hard delete — RLS ile güvenli) + denetim izi aynı transaction'da (ADR-0016) */
  async deleteContact(id: string, userId?: string): Promise<boolean> {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const previous = await client.query<{ id: string; code: string; name: string }>(
        'SELECT id, code, name FROM contacts WHERE id = $1 AND tenant_id = current_tenant_id()',
        [id],
      );
      if (previous.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query('DELETE FROM contacts WHERE id = $1 AND tenant_id = current_tenant_id()', [
        id,
      ]);
      await this.writeAudit(client, {
        userId,
        action: 'contacts.delete',
        entityId: id,
        oldValues: (previous.rows?.[0] as Record<string, unknown> | undefined) ?? null,
      });
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Cari tipi güncelle (müşteri/satıcı) */
  async setContactType(
    id: string,
    type: 'customer' | 'supplier',
  ): Promise<ContactWithDetails | null> {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `UPDATE contacts 
       SET type = $1, updated_at = now() 
       WHERE id = $2 AND tenant_id = current_tenant_id() 
       RETURNING *`,
      [type, id],
    );

    if (result.rowCount === 0) return null;
    return this.getContact(id);
  }

  /** Cari ledger/ekstre getir — borç/alacak yönü ve yürüyen bakiye ile. */
  async listContactLedger(
    contactId: string,
    options: {
      page?: number;
      limit?: number;
      type?: 'receivable' | 'payable';
      dateFrom?: string;
      dateTo?: string;
      offset?: number;
      cursor?: string | null;
    },
  ) {
    const pool = this.getPoolInstance();
    const page = options.page ?? 1;
    const limit = options.limit ?? 50;
    const offset = options.offset ?? (page - 1) * limit;
    const type = options.type;

    // WHERE koşulları
    const whereConditions = ['ple.tenant_id = current_tenant_id()', 'ple.contact_id = $1'];
    const values: unknown[] = [contactId];

    if (type) {
      whereConditions.push(`ple.type = $${values.length + 1}`);
      values.push(type);
    }
    if (options.dateFrom) {
      whereConditions.push(`ple.posted_at >= $${values.length + 1}::date`);
      values.push(options.dateFrom);
    }
    if (options.dateTo) {
      whereConditions.push(`ple.posted_at < ($${values.length + 1}::date + interval '1 day')`);
      values.push(options.dateTo);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Toplamlar: receivable = borç (bize olan borcu), payable = alacak (bizden alacağı)
    const totalsResult = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'receivable'), 0) AS debit,
         COALESCE(SUM(amount) FILTER (WHERE type = 'payable'), 0) AS credit,
         COUNT(*) AS total
       FROM party_ledger_entries ple ${whereClause}`,
      values,
    );
    const debit = Number(totalsResult.rows[0].debit);
    const credit = Number(totalsResult.rows[0].credit);
    const total = parseInt(totalsResult.rows[0].total, 10);

    // Devir (sayfa başından önceki net bakiye) — doğru bakiye için şart.
    const sign = `CASE WHEN ple.type = 'receivable' THEN ple.amount ELSE -ple.amount END`;
    const openingResult = await pool.query(
      `SELECT COALESCE(SUM(${sign}), 0) AS opening
       FROM party_ledger_entries ple ${whereClause}`,
      values,
    );
    const openingBalance = Number(openingResult.rows[0].opening);

    // Sayfa hareketleri — eskiden yeniye, yürüyen bakiye uygulama tarafında hesaplanır.
    const dataResult = await pool.query(
      `SELECT ple.* FROM party_ledger_entries ple
       ${whereClause}
       ORDER BY ple.posted_at ASC, ple.created_at ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    return {
      data: dataResult.rows.map((r: Record<string, unknown>) => ({
        ...r,
        amount: Number(r.amount),
      })),
      summary: {
        debit,
        credit,
        balance: debit - credit,
        openingBalance,
        entryCount: total,
      },
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * Cari detay paketi — ekranın tek çağrıda ihtiyaç duyduğu her şey.
   * Ön muhasebe programlarındaki "cari kartı" görünümünün veri kaynağı:
   * künye + bakiye/risk + açık belgeler + belge özetleri + yaşlandırma.
   */
  async getContactSummary(contactId: string) {
    const pool = this.getPoolInstance();

    const [balance, docs, docStats, aging, agingPayable, lastMovements] = await Promise.all([
      // Bakiye ve risk — fatura ve ledgersız belgeler birleşik
      pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE type = 'receivable'), 0) AS debit,
           COALESCE(SUM(amount) FILTER (WHERE type = 'payable'), 0) AS credit,
           COUNT(*) AS entry_count
         FROM party_ledger_entries
         WHERE tenant_id = current_tenant_id() AND contact_id = $1`,
        [contactId],
      ),
      // Açık (kapanmamış) faturalar
      pool.query(
        `SELECT i.id, i.number, i.type, i.status, i.issue_date, i.due_date, i.currency,
                COALESCE(i.total, 0) AS total, COALESCE(i.paid_amount, 0) AS paid,
                COALESCE(i.balance, 0) AS balance,
                GREATEST(0, (CURRENT_DATE - COALESCE(i.due_date, i.issue_date))) AS days_overdue
         FROM invoices i
         WHERE i.tenant_id = current_tenant_id() AND i.contact_id = $1
           AND i.status <> 'cancelled'
         ORDER BY i.issue_date DESC
         LIMIT 100`,
        [contactId],
      ),
      // Belge istatistikleri (fatura, teklif, sipariş, irsaliye)
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM invoices WHERE tenant_id = current_tenant_id() AND contact_id = $1 AND type = 'sales' AND status <> 'cancelled') AS sales_invoices,
           (SELECT COUNT(*) FROM invoices WHERE tenant_id = current_tenant_id() AND contact_id = $1 AND type = 'purchase' AND status <> 'cancelled') AS purchase_invoices,
           (SELECT COUNT(*) FROM sales_quotes WHERE tenant_id = current_tenant_id() AND contact_id = $1) AS quotes,
           (SELECT COUNT(*) FROM sales_orders WHERE tenant_id = current_tenant_id() AND contact_id = $1) AS orders,
           (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = current_tenant_id() AND contact_id = $1) AS purchase_orders,
           (SELECT COUNT(*) FROM deliveries WHERE tenant_id = current_tenant_id() AND contact_id = $1) AS deliveries`,
        [contactId],
      ),
      // Yaşlandırma kovaları — satış (alacak) ve alış (borç) ayrı ayrı
      pool.query(
        `SELECT
           COALESCE(SUM(balance) FILTER (WHERE days <= 0), 0) AS current,
           COALESCE(SUM(balance) FILTER (WHERE days BETWEEN 1 AND 30), 0) AS d1_30,
           COALESCE(SUM(balance) FILTER (WHERE days BETWEEN 31 AND 60), 0) AS d31_60,
           COALESCE(SUM(balance) FILTER (WHERE days BETWEEN 61 AND 90), 0) AS d61_90,
           COALESCE(SUM(balance) FILTER (WHERE days > 90), 0) AS d90_plus
         FROM (
           SELECT COALESCE(balance, 0) AS balance,
                  GREATEST(0, (CURRENT_DATE - COALESCE(due_date, issue_date))) AS days
           FROM invoices
           WHERE tenant_id = current_tenant_id() AND contact_id = $1
             AND status <> 'cancelled' AND type = 'sales' AND COALESCE(balance, 0) > 0
         ) t`,
        [contactId],
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(balance) FILTER (WHERE days <= 0), 0) AS current,
           COALESCE(SUM(balance) FILTER (WHERE days BETWEEN 1 AND 30), 0) AS d1_30,
           COALESCE(SUM(balance) FILTER (WHERE days BETWEEN 31 AND 60), 0) AS d31_60,
           COALESCE(SUM(balance) FILTER (WHERE days BETWEEN 61 AND 90), 0) AS d61_90,
           COALESCE(SUM(balance) FILTER (WHERE days > 90), 0) AS d90_plus
         FROM (
           SELECT COALESCE(balance, 0) AS balance,
                  GREATEST(0, (CURRENT_DATE - COALESCE(due_date, issue_date))) AS days
           FROM invoices
           WHERE tenant_id = current_tenant_id() AND contact_id = $1
             AND status <> 'cancelled' AND type = 'purchase' AND COALESCE(balance, 0) > 0
         ) t`,
        [contactId],
      ),
      // Son hareketler (ekstre önizleme)
      pool.query(
        `SELECT id, type, document_type, document_number, posted_at, amount, currency, description
         FROM party_ledger_entries
         WHERE tenant_id = current_tenant_id() AND contact_id = $1
         ORDER BY posted_at DESC, created_at DESC
         LIMIT 10`,
        [contactId],
      ),
    ]);

    const debit = Number(balance.rows[0].debit);
    const credit = Number(balance.rows[0].credit);
    const numberize = (row: Record<string, unknown>) => ({
      current: Number(row.current),
      d1_30: Number(row.d1_30),
      d31_60: Number(row.d31_60),
      d61_90: Number(row.d61_90),
      d90_plus: Number(row.d90_plus),
    });
    const agingReceivable = numberize(aging.rows[0]);
    const payableBuckets = numberize(agingPayable.rows[0]);
    const sumBuckets = (b: ReturnType<typeof numberize>) =>
      b.current + b.d1_30 + b.d31_60 + b.d61_90 + b.d90_plus;

    const openDocsCount = docs.rows.filter(
      (d) => Number(d.balance) > 0 && d.type === 'sales',
    ).length;
    const overdueCount = docs.rows.filter(
      (d) => Number(d.balance) > 0 && d.type === 'sales' && Number(d.days_overdue) > 0,
    ).length;

    return {
      balance: {
        debit,
        credit,
        balance: debit - credit,
        entryCount: Number(balance.rows[0].entry_count),
      },
      /** Satış faturalarından doğan alacak — asıl risk göstergesi. */
      risk: {
        openDocuments: openDocsCount,
        overdueDocuments: overdueCount,
        overdueAmount: sumBuckets(agingReceivable) - agingReceivable.current,
        totalReceivable: sumBuckets(agingReceivable),
        totalPayable: sumBuckets(payableBuckets),
        aging: agingReceivable,
        agingPayable: payableBuckets,
        /** Faturalardan hesaplanan net: alacak − borç (ledger boş olsa da doğru). */
        invoiceNet: sumBuckets(agingReceivable) - sumBuckets(payableBuckets),
      },
      documents: docs.rows.map((d: Record<string, unknown>) => ({
        ...d,
        total: Number(d.total),
        paid: Number(d.paid),
        balance: Number(d.balance),
        days_overdue: Number(d.days_overdue),
      })),
      documentStats: docStats.rows[0],
      recentMovements: lastMovements.rows.map((r: Record<string, unknown>) => ({
        ...r,
        amount: Number(r.amount),
      })),
    };
  }

  /**
   * Cari listesi + bakiyeler. Ön muhasebenin olmazsa olmazı: listede anlık bakiye.
   * `party_ledger_entries` yoksa bakiye 0 gelir (henüz hareket girilmemiş cari).
   */
  async listContactsWithBalances(options: {
    page?: number;
    limit?: number;
    sort?: string;
    order?: 'asc' | 'desc';
    type?: string;
    is_active?: boolean;
    q?: string;
    onlyWithBalance?: boolean;
  }) {
    const pool = this.getPoolInstance();
    const page = options.page ?? 1;
    const limit = options.limit ?? 25;
    const offset = (page - 1) * limit;
    const ALLOWED_SORT = new Set(['code', 'name', 'created_at', 'updated_at', 'type', 'balance']);
    const sort = ALLOWED_SORT.has(options.sort ?? '') ? (options.sort as string) : 'code';
    const order = options.order === 'desc' ? 'DESC' : 'ASC';

    const conditions = ['c.tenant_id = current_tenant_id()'];
    const values: unknown[] = [];
    if (options.type) {
      conditions.push(`c.type = $${values.length + 1}`);
      values.push(options.type);
    }
    if (options.is_active !== undefined) {
      conditions.push(`c.is_active = $${values.length + 1}`);
      values.push(options.is_active);
    }
    if (options.q?.trim()) {
      const i = values.length + 1;
      conditions.push(
        `(c.name ILIKE $${i} OR c.code ILIKE $${i + 1} OR COALESCE(c.trade_name,'') ILIKE $${i + 2} OR COALESCE(c.tax_number,'') ILIKE $${i + 3})`,
      );
      const term = `%${options.q.trim()}%`;
      values.push(term, term, term, term);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    // Bakiye: receivable → borç (bize), payable → alacak (bizden)
    const balanceExpr = `COALESCE(led.debit, 0) - COALESCE(led.credit, 0)`;
    const havingClause = options.onlyWithBalance ? `HAVING ABS(${balanceExpr}) > 0.004` : '';
    const orderBy = sort === 'balance' ? balanceExpr : `c.${sort}`;

    const baseQuery = `
      FROM contacts c
      LEFT JOIN (
        SELECT contact_id,
               SUM(amount) FILTER (WHERE type = 'receivable') AS debit,
               SUM(amount) FILTER (WHERE type = 'payable') AS credit
        FROM party_ledger_entries
        WHERE tenant_id = current_tenant_id()
        GROUP BY contact_id
      ) led ON led.contact_id = c.id
      ${where}
      GROUP BY c.id, led.debit, led.credit
      ${havingClause}`;

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM (SELECT c.id ${baseQuery}) x`, values),
      pool.query(
        `SELECT c.*,
                COALESCE(led.debit, 0) AS debit,
                COALESCE(led.credit, 0) AS credit,
                ${balanceExpr} AS balance
         ${baseQuery}
         ORDER BY ${orderBy} ${order} NULLS LAST, c.name ASC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);
    return {
      data: dataResult.rows.map((r: Record<string, unknown>) => ({
        ...r,
        debit: Number(r.debit),
        credit: Number(r.credit),
        balance: Number(r.balance),
        addresses: [],
        phones: [],
        emails: [],
        relations: [],
      })),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Cari listesi özet sayaçları — üst KPI şeridi için. */
  async getContactsStats() {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE type = 'customer') AS customers,
         COUNT(*) FILTER (WHERE type = 'supplier') AS suppliers,
         COUNT(*) FILTER (WHERE is_active) AS active,
         COUNT(*) FILTER (WHERE NOT is_active) AS inactive,
         COUNT(*) FILTER (WHERE is_active AND COALESCE(tax_number,'') = '') AS missing_tax_number
       FROM contacts WHERE tenant_id = current_tenant_id()`,
    );
    const balances = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'receivable'), 0) AS receivable,
         COALESCE(SUM(amount) FILTER (WHERE type = 'payable'), 0) AS payable
       FROM party_ledger_entries WHERE tenant_id = current_tenant_id()`,
    );
    // Ledger henüz girilmemiş olabilir; fatura bakiyeleri asıl kaynak.
    const invoiceBalances = await pool.query(
      `SELECT
         COALESCE(SUM(balance) FILTER (WHERE type = 'sales'), 0) AS receivable,
         COALESCE(SUM(balance) FILTER (WHERE type = 'purchase'), 0) AS payable,
         COALESCE(SUM(balance) FILTER (WHERE type = 'sales' AND COALESCE(due_date, issue_date) < CURRENT_DATE), 0) AS overdue
       FROM invoices
       WHERE tenant_id = current_tenant_id() AND status <> 'cancelled' AND COALESCE(balance, 0) > 0`,
    );
    const row = result.rows[0];
    const invRec = Number(invoiceBalances.rows[0].receivable);
    const invPay = Number(invoiceBalances.rows[0].payable);
    return {
      total: Number(row.total),
      customers: Number(row.customers),
      suppliers: Number(row.suppliers),
      active: Number(row.active),
      inactive: Number(row.inactive),
      missingTaxNumber: Number(row.missing_tax_number),
      totalReceivable: invRec || Number(balances.rows[0].receivable),
      totalPayable: invPay || Number(balances.rows[0].payable),
      overdueAmount: Number(invoiceBalances.rows[0].overdue),
      netBalance: invRec - invPay,
    };
  }
}
