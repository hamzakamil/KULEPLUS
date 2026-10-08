import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';
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
    const _tenantId = 'current_tenant_id()'; // RLS için
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = options.offset ?? (page - 1) * limit;
    const sort = options.sort ?? 'code';
    const order = options.order ?? 'asc';
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

  /** Yeni cari oluştur */
  async createContact(data: CreateContactInput): Promise<ContactWithDetails | null> {
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

      // Cari oluştur
      const contactResult = await client.query(
        `INSERT INTO contacts (
          tenant_id, code, name, trade_name, type, tax_number, tax_office, 
          settings, created_at, updated_at
        ) VALUES (
          current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, now(), now()
        ) RETURNING *`,
        [
          data.code,
          data.name,
          data.trade_name ?? null,
          data.type,
          data.tax_number ?? null,
          data.tax_office ?? null,
          JSON.stringify(data.settings ?? {}),
        ],
      );

      const contactId = contactResult.rows[0].id;

      // Adresler
      for (const addr of data.addresses ?? []) {
        await client.query(
          `INSERT INTO contact_addresses (
            contact_id, is_primary, type, province, district, neighborhood, 
            street, building, apartment, zip_code, parsed, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
          )`,
          [
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
            contact_id, is_primary, type, number, formatted, parsed, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, now()
          )`,
          [
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
            contact_id, is_primary, type, email, validated, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, now()
          )`,
          [
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
            contact_id, related_contact_id, relation_type, notes, created_at
          ) VALUES (
            $1, $2, $3, $4, now()
          )`,
          [contactId, rel.related_contact_id, rel.relation_type, rel.notes ?? null],
        );
      }

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
  async updateContact(id: string, data: UpdateContactInput): Promise<ContactWithDetails | null> {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Varolup olmadığını kontrol et
      const existing = await client.query(
        'SELECT id FROM contacts WHERE id = $1 AND tenant_id = current_tenant_id()',
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

      await client.query('COMMIT');
      return this.getContact(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Cari sil (soft delete yerine hard delete - RLS ile güvenli) */
  async deleteContact(id: string): Promise<boolean> {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      'DELETE FROM contacts WHERE id = $1 AND tenant_id = current_tenant_id() RETURNING id',
      [id],
    );
    return (result.rowCount ?? 0) > 0;
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

  /** Cari ledger/ekstre getir */
  async listContactLedger(
    contactId: string,
    options: {
      page?: number;
      limit?: number;
      type?: 'receivable' | 'payable';
      offset?: number;
      cursor?: string | null;
    },
  ) {
    const pool = this.getPoolInstance();
    const _tenantId = 'current_tenant_id()';
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = options.offset ?? (page - 1) * limit;
    const type = options.type;

    // WHERE koşulları
    const whereConditions = ['ple.tenant_id = current_tenant_id()', 'ple.contact_id = $1'];
    const values: unknown[] = [contactId];

    if (type) {
      whereConditions.push(`ple.type = $${values.length + 1}`);
      values.push(type);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count query
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM party_ledger_entries ple ${whereClause}`,
      values,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Main query
    const dataResult = await pool.query(
      `SELECT ple.* FROM party_ledger_entries ple 
       ${whereClause}
ORDER BY ple.posted_at DESC, ple.created_at DESC
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
}
