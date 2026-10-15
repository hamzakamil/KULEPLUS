import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { SiteService } from '../src/modules/management/sites.service';

/**
 * Şantiye servisi — ROADMAP Faz 7.6.
 *
 * Sahte `pool` enjekte edilir (`ApprovalService` testi deseni): servis
 * BEGIN/set_config/veri sorguları/COMMIT akışını kendi transaction'ında koşar.
 * Gerçek Postgres'e bağlanılmaz.
 */

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function makeMockPool(queryImpl: (sql: string, params?: unknown[]) => unknown) {
  const clientQuery = vi.fn(queryImpl);
  const client: MockClient = { query: clientQuery, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client as unknown as PoolClient) } as unknown as Pool;
  return { pool, clientQuery };
}

/** Transaction/oturum sorgularını otomatik geçir. */
function base(queryImpl: (sql: string, params?: unknown[]) => unknown) {
  return (sql: string, params?: unknown[]) => {
    const text = sql.trim();
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text) || text.includes('set_config')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return queryImpl(text, params);
  };
}

const siteRow = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'SA-0001',
  name: 'Vadi Rezidans',
  province: 'İstanbul',
  district: 'Başakşehir',
  address: null,
  contact_id: null,
  contact_name: null,
  status: 'active',
  sort_order: 1,
  notes: null,
  created_at: new Date('2026-10-15T08:00:00Z'),
  updated_at: new Date('2026-10-15T08:00:00Z'),
};

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

describe('SiteService (Faz 7.6)', () => {
  it('createSite: kod verilmezse `SA-0001` üretir ve satırı camelCase döner', async () => {
    const calls: string[] = [];
    const { pool } = makeMockPool(
      base((sql) => {
        calls.push(sql);
        if (sql.includes('count(*)::int AS n FROM sites')) return Promise.resolve({ rows: [{ n: 0 }] });
        if (sql.startsWith('SELECT 1 FROM sites WHERE code')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql.startsWith('INSERT INTO sites')) return Promise.resolve({ rows: [], rowCount: 1 });
        if (sql.includes('FROM sites s')) return Promise.resolve({ rows: [siteRow], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    );
    const service = new SiteService({ pool });

    const created = await service.createSite(
      {
        name: 'Vadi Rezidans',
        province: 'İstanbul',
        district: 'Başakşehir',
        status: 'active',
        sort_order: 1,
      },
      USER,
      TENANT,
    );

    expect(created.code).toBe('SA-0001');
    expect(created.statusLabel).toBe('Devam ediyor');
    expect(created.createdAt).toBe('2026-10-15T08:00:00.000Z');
    const insert = calls.find((sql) => sql.startsWith('INSERT INTO sites')) ?? '';
    expect(insert).toContain('app.current_tenant_id()');
  });

  it('createSite: aynı kod varsa CONFLICT döner', async () => {
    const { pool } = makeMockPool(
      base((sql) => {
        if (sql.startsWith('SELECT 1 FROM sites WHERE code')) {
          return Promise.resolve({ rows: [{ exists: 1 }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    );
    const service = new SiteService({ pool });

    await expect(
      service.createSite(
        { code: 'SA-0001', name: 'X', province: 'Ankara', status: 'active', sort_order: 0 },
        USER,
        TENANT,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('updateSite: kayıt yoksa NOT_FOUND', async () => {
    const { pool } = makeMockPool(base(() => Promise.resolve({ rows: [], rowCount: 0 })));
    const service = new SiteService({ pool });

    await expect(service.updateSite('yok', { name: 'Y' }, USER, TENANT)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('updateSite: yalnızca verilen alanları SET eder ve updated_at tazeler', async () => {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const { pool } = makeMockPool(
      base((sql, params) => {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT id FROM sites WHERE id')) {
          return Promise.resolve({ rows: [{ id: siteRow.id }], rowCount: 1 });
        }
        if (sql.includes('FROM sites s')) {
          return Promise.resolve({ rows: [{ ...siteRow, province: 'Ankara' }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    );
    const service = new SiteService({ pool });

    const updated = await service.updateSite(siteRow.id, { province: 'Ankara' }, USER, TENANT);

    const update = calls.find((call) => call.sql.startsWith('UPDATE sites SET'));
    expect(update?.sql).toContain('province = $1');
    expect(update?.sql).toContain('updated_at = now()');
    expect(update?.sql ?? '').not.toContain('name =');
    expect(updated.province).toBe('Ankara');
  });

  it('deleteSite: kayıt yoksa NOT_FOUND, varsa deleted döner', async () => {
    const { pool } = makeMockPool(
      base((sql) => {
        if (sql.startsWith('DELETE FROM sites')) return Promise.resolve({ rows: [], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    );
    const service = new SiteService({ pool });
    await expect(service.deleteSite(siteRow.id, TENANT)).resolves.toEqual({
      id: siteRow.id,
      deleted: true,
    });

    const empty = makeMockPool(base(() => Promise.resolve({ rows: [], rowCount: 0 })));
    const emptyService = new SiteService({ pool: empty.pool });
    await expect(emptyService.deleteSite(siteRow.id, TENANT)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('listSites: filtreler SQL’e bağlanır, sayfalama bilgisi döner', async () => {
    const calls: string[] = [];
    const { pool } = makeMockPool(
      base((sql) => {
        calls.push(sql);
        if (sql.includes('count(*)::int AS n')) return Promise.resolve({ rows: [{ n: 120 }] });
        if (sql.includes('FROM sites s')) return Promise.resolve({ rows: [siteRow], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    );
    const service = new SiteService({ pool });

    const page = await service.listSites(
      { q: 'vadi', status: 'active', province: undefined, page: 2, limit: 50 },
      TENANT,
    );

    expect(page.total).toBe(120);
    expect(page.totalPages).toBe(3);
    expect(page.page).toBe(2);
    const listSql = calls.find((sql) => sql.includes('LIMIT')) ?? '';
    expect(listSql).toContain('s.status = $1');
    expect(listSql).toContain('ILIKE $2');
    expect(listSql).toContain('LIMIT $3 OFFSET $4');
  });

  it('listSitesForCockpit: yalnızca aktif/askıdaki şantiyeleri sınırlı sayıda getirir', async () => {
    const calls: string[] = [];
    const { pool } = makeMockPool(
      base((sql) => {
        calls.push(sql);
        if (sql.includes('FROM sites s')) {
          return Promise.resolve({
            rows: [
              {
                id: siteRow.id,
                name: siteRow.name,
                province: siteRow.province,
                district: siteRow.district,
                status: 'active',
              },
            ],
            rowCount: 1,
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    );
    const service = new SiteService({ pool });

    const items = await service.listSitesForCockpit(TENANT);

    expect(items).toHaveLength(1);
    expect(items[0]?.statusLabel).toBe('Devam ediyor');
    const sql = calls.find((text) => text.includes('FROM sites s')) ?? '';
    expect(sql).toContain("status IN ('active', 'paused')");
    expect(sql).toContain('LIMIT 12');
  });
});
