import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { DEFAULT_UNITS, ensureTenantDefaults } from '../src/modules/core/tenant-defaults';

/**
 * `ensureTenantDefaults` yalnızca `client.query` kullanır. Var-mı kontrolleri
 * (`SELECT 1 FROM <tablo>`) için `existing` içindeki tablolar dolu sayılır; diğer
 * tüm tablolar (KDV, gider kategorisi…) dolu döner ki testler yalnızca birim/depoya baksın.
 */
function fakeClient(existing: { units?: boolean; warehouses?: boolean } = {}) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("current_setting('app.tenant_id'")) return { rows: [{ v: 'onceki' }] };
    if (sql.startsWith('SELECT 1 FROM units'))
      return { rowCount: existing.units ? 1 : 0, rows: [] };
    if (sql.startsWith('SELECT 1 FROM warehouses')) {
      return { rowCount: existing.warehouses ? 1 : 0, rows: [] };
    }
    if (sql.startsWith('SELECT 1')) return { rowCount: 1, rows: [] };
    return { rowCount: 1, rows: [] };
  });
  return { client: { query } as unknown as PoolClient, query };
}

function insertsInto(query: ReturnType<typeof vi.fn>, table: string) {
  return query.mock.calls.filter((c) => String(c[0]).includes(`INSERT INTO ${table}`));
}

describe('ensureTenantDefaults — birim ve depo', () => {
  it('birimi ve deposu olmayan yeni şirkete varsayılan birimleri ve Merkez Depo ekler', async () => {
    const { client, query } = fakeClient();

    await ensureTenantDefaults(client, 'tenant-yeni');

    const units = insertsInto(query, 'units');
    expect(units).toHaveLength(DEFAULT_UNITS.length);
    const codes = units.map((c) => (c[1] as unknown[])[2]);
    expect(codes).toEqual(['ADET', 'KG', 'LT', 'MT', 'PAKET', 'KUTU']);
    // Yalnızca ADET ana birim.
    const baseFlags = units.map((c) => (c[1] as unknown[])[5]);
    expect(baseFlags).toEqual([true, false, false, false, false, false]);

    const warehouses = insertsInto(query, 'warehouses');
    expect(warehouses).toHaveLength(1);
    expect(String(warehouses[0][0])).toContain("'MERKEZ'");
    expect((warehouses[0][1] as unknown[])[1]).toBe('tenant-yeni');
  });

  it('id deterministiktir: aynı şirket için tekrar çalışınca aynı id üretilir', async () => {
    const a = fakeClient();
    const b = fakeClient();

    await ensureTenantDefaults(a.client, 'tenant-x');
    await ensureTenantDefaults(b.client, 'tenant-x');

    const ids = (q: ReturnType<typeof vi.fn>) =>
      insertsInto(q, 'units').map((c) => (c[1] as unknown[])[0]);
    expect(ids(a.query)).toEqual(ids(b.query));
    expect(new Set(ids(a.query)).size).toBe(DEFAULT_UNITS.length); // hepsi farklı
    expect(ids(a.query)[0]).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  });

  it('zaten birimi/deposu olan şirkete dokunmaz (kendi birimlerini koruması için)', async () => {
    const { client, query } = fakeClient({ units: true, warehouses: true });

    await ensureTenantDefaults(client, 'tenant-eski');

    expect(insertsInto(query, 'units')).toHaveLength(0);
    expect(insertsInto(query, 'warehouses')).toHaveLength(0);
  });

  it('RLS için tenant bağlamını kurar ve sonunda önceki değere döndürür', async () => {
    const { client, query } = fakeClient();

    await ensureTenantDefaults(client, 'tenant-yeni');

    const setConfigs = query.mock.calls.filter((c) => String(c[0]).includes('set_config'));
    expect((setConfigs[0][1] as unknown[])[0]).toBe('tenant-yeni');
    expect((setConfigs.at(-1)![1] as unknown[])[0]).toBe('onceki');
  });
});
