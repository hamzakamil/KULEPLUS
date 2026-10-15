import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

/**
 * Şantiye (saha) servisi — ROADMAP Faz 7.6.
 *
 * Şantiye kaydı kokpitteki "Şantiyeler" kartını besler; ayrıca `province` /
 * `district` alanları MGM hava durumu istasyon çözümlemesinin girdisidir
 * (`weather.service.ts`). Bu yüzden `province` zorunludur.
 *
 * Tenant izolasyonu iki katmanlı (management deseni): `tenantContext` (RLS) +
 * servisin kendi transaction'ında `set_config('app.tenant_id', ...)`.
 */

export const SITE_STATUSES = ['active', 'paused', 'completed', 'archived'] as const;

/** Durum etiketleri — web tarafındaki gösterimle aynı sözlük. */
export const SITE_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: 'Devam ediyor',
  paused: 'Askıda',
  completed: 'Tamamlandı',
  archived: 'Arşiv',
};

export const createSiteSchema = z.object({
  /** Boş bırakılırsa `SA-0001` biçiminde otomatik üretilir. */
  code: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1, 'Şantiye adı zorunlu').max(160),
  province: z.string().trim().min(1, 'İl zorunlu').max(80),
  district: z.string().trim().max(80).nullish(),
  address: z.string().trim().max(500).nullish(),
  contact_id: z.string().uuid().nullish(),
  status: z.enum(SITE_STATUSES).default('active'),
  sort_order: z.number().int().min(0).max(9999).default(0),
  notes: z.string().trim().max(2000).nullish(),
});

export const updateSiteSchema = createSiteSchema.partial();

export const siteListQuerySchema = z.object({
  q: z.string().optional(),
  province: z.string().optional(),
  status: z.enum(SITE_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;
export type SiteListQuery = z.infer<typeof siteListQuerySchema>;

export interface Site {
  id: string;
  code: string;
  name: string;
  province: string;
  district: string | null;
  address: string | null;
  contactId: string | null;
  contactName: string | null;
  status: (typeof SITE_STATUSES)[number];
  statusLabel: string;
  sortOrder: number;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SitePage {
  items: Site[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const SITE_COLUMNS = `
  s.id, s.code, s.name, s.province, s.district, s.address, s.contact_id,
  s.status, s.sort_order, s.notes, s.created_at, s.updated_at,
  c.name AS contact_name`;

const toIso = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
};

function mapSiteRow(row: Record<string, unknown>): Site {
  const status = String(row.status ?? 'active') as Site['status'];
  return {
    id: String(row.id),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    province: String(row.province ?? ''),
    district: row.district ? String(row.district) : null,
    address: row.address ? String(row.address) : null,
    contactId: row.contact_id ? String(row.contact_id) : null,
    contactName: row.contact_name ? String(row.contact_name) : null,
    status,
    statusLabel: SITE_STATUS_LABELS[status] ?? status,
    sortOrder: Number(row.sort_order ?? 0),
    notes: row.notes ? String(row.notes) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const nullable = (value: string | null | undefined): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
};

export class SiteService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;

  constructor(options?: { pool?: Pool }) {
    this.providedPool = options?.pool ?? null;
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
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** `SA-0001` biçiminde boşta olan kod üretir (tenant içi benzersizlik). */
  private async nextCode(client: PoolClient): Promise<string> {
    const countResult = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM sites');
    const start = Number(countResult.rows[0]?.n ?? 0) + 1;
    for (let offset = 0; offset < 200; offset++) {
      const candidate = `SA-${String(start + offset).padStart(4, '0')}`;
      const exists = await client.query('SELECT 1 FROM sites WHERE code = $1 LIMIT 1', [candidate]);
      if (exists.rowCount === 0) return candidate;
    }
    return `SA-${Date.now().toString().slice(-6)}`;
  }

  async listSites(query: SiteListQuery, tenantId: string | undefined): Promise<SitePage> {
    return this.withTenantClient(tenantId, async (client) => {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        params.push(query.status);
        filters.push(`s.status = $${params.length}`);
      }
      if (query.province) {
        params.push(query.province);
        filters.push(`s.province = $${params.length}`);
      }
      if (query.q) {
        params.push(`%${query.q}%`);
        filters.push(
          `(s.name ILIKE $${params.length} OR s.code ILIKE $${params.length} OR s.province ILIKE $${params.length} OR coalesce(s.district, '') ILIKE $${params.length})`,
        );
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const totalResult = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sites s ${where}`,
        params,
      );
      const total = Number(totalResult.rows[0]?.n ?? 0);
      const limit = query.limit;
      const offset = (query.page - 1) * limit;
      const rows = await client.query(
        `SELECT ${SITE_COLUMNS}
           FROM sites s
           LEFT JOIN contacts c ON c.id = s.contact_id
           ${where}
          ORDER BY s.sort_order ASC, s.name ASC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return {
        items: rows.rows.map((row) => mapSiteRow(row as Record<string, unknown>)),
        page: query.page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      };
    });
  }

  async getSite(id: string, tenantId: string | undefined): Promise<Site | null> {
    return this.withTenantClient(tenantId, async (client) => {
      const rows = await client.query(
        `SELECT ${SITE_COLUMNS}
           FROM sites s
           LEFT JOIN contacts c ON c.id = s.contact_id
          WHERE s.id = $1
          LIMIT 1`,
        [id],
      );
      const row = rows.rows[0];
      return row ? mapSiteRow(row as Record<string, unknown>) : null;
    });
  }

  async createSite(
    input: CreateSiteInput,
    userId: string | undefined,
    tenantId: string | undefined,
  ): Promise<Site> {
    const id = newId();
    return this.withTenantClient(tenantId, async (client) => {
      const code = input.code ?? (await this.nextCode(client));
      const duplicate = await client.query('SELECT 1 FROM sites WHERE code = $1 LIMIT 1', [code]);
      if ((duplicate.rowCount ?? 0) > 0) {
        throw new AppError('CONFLICT', `Bu şantiye kodu zaten kullanılıyor: ${code}`);
      }
      await client.query(
        `INSERT INTO sites
           (id, tenant_id, code, name, province, district, address, contact_id, status,
            sort_order, notes, created_by, updated_by)
         VALUES ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          id,
          code,
          input.name,
          input.province,
          nullable(input.district),
          nullable(input.address),
          input.contact_id ?? null,
          input.status,
          input.sort_order,
          nullable(input.notes),
          userId ?? null,
        ],
      );
      const created = await client.query(
        `SELECT ${SITE_COLUMNS}
           FROM sites s
           LEFT JOIN contacts c ON c.id = s.contact_id
          WHERE s.id = $1
          LIMIT 1`,
        [id],
      );
      return mapSiteRow(created.rows[0] as Record<string, unknown>);
    });
  }

  async updateSite(
    id: string,
    input: UpdateSiteInput,
    userId: string | undefined,
    tenantId: string | undefined,
  ): Promise<Site> {
    return this.withTenantClient(tenantId, async (client) => {
      const current = await client.query('SELECT id FROM sites WHERE id = $1 LIMIT 1', [id]);
      if (current.rowCount === 0) throw new AppError('NOT_FOUND', 'Şantiye bulunamadı');

      if (input.code) {
        const duplicate = await client.query(
          'SELECT 1 FROM sites WHERE code = $1 AND id <> $2 LIMIT 1',
          [input.code, id],
        );
        if ((duplicate.rowCount ?? 0) > 0) {
          throw new AppError('CONFLICT', `Bu şantiye kodu zaten kullanılıyor: ${input.code}`);
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (input.code !== undefined) push('code', input.code);
      if (input.name !== undefined) push('name', input.name);
      if (input.province !== undefined) push('province', input.province);
      if (input.district !== undefined) push('district', nullable(input.district));
      if (input.address !== undefined) push('address', nullable(input.address));
      if (input.contact_id !== undefined) push('contact_id', input.contact_id ?? null);
      if (input.status !== undefined) push('status', input.status);
      if (input.sort_order !== undefined) push('sort_order', input.sort_order);
      if (input.notes !== undefined) push('notes', nullable(input.notes));
      if (sets.length > 0) {
        params.push(userId ?? null);
        sets.push(`updated_by = $${params.length}`);
        params.push(id);
        await client.query(
          `UPDATE sites SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
          params,
        );
      }
      const updated = await client.query(
        `SELECT ${SITE_COLUMNS}
           FROM sites s
           LEFT JOIN contacts c ON c.id = s.contact_id
          WHERE s.id = $1
          LIMIT 1`,
        [id],
      );
      return mapSiteRow(updated.rows[0] as Record<string, unknown>);
    });
  }

  async deleteSite(id: string, tenantId: string | undefined): Promise<{ id: string; deleted: true }> {
    return this.withTenantClient(tenantId, async (client) => {
      const result = await client.query('DELETE FROM sites WHERE id = $1', [id]);
      if (result.rowCount === 0) throw new AppError('NOT_FOUND', 'Şantiye bulunamadı');
      return { id, deleted: true as const };
    });
  }

  /**
   * Kokpit için aktif şantiyeler (arşiv/tamamlanan hariç, en fazla 12).
   * Hava durumu bu listenin il/ilçesinden çözülür.
   */
  async listSitesForCockpit(
    tenantId: string | undefined,
  ): Promise<Array<Pick<Site, 'id' | 'name' | 'province' | 'district' | 'status' | 'statusLabel'>>> {
    return this.withTenantClient(tenantId, async (client) => {
      const rows = await client.query(
        `SELECT s.id, s.name, s.province, s.district, s.status
           FROM sites s
          WHERE s.status IN ('active', 'paused')
          ORDER BY s.sort_order ASC, s.name ASC
          LIMIT 12`,
      );
      return (rows.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        province: String(row.province),
        district: row.district ? String(row.district) : null,
        status: String(row.status) as Site['status'],
        statusLabel: SITE_STATUS_LABELS[String(row.status)] ?? String(row.status),
      }));
    });
  }
}
