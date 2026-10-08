import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { newId } from '@kuleplus/shared';
import { isValidMigrationName, withTenant } from '../src/tenant';

/**
 * Tenant izolasyon test çerçevesi — ROADMAP Faz 0 kabul kriteri:
 * "Tenant A, tenant B'nin verisini okuyamaz".
 *
 * docker compose postgres çalışmıyorsa (TEST_DATABASE_URL yoksa) atlanır.
 * Önkoşul: RLS skeleton migration'ı migrator rolüyle uygulanmış olmalı
 * (`npm run migrate --workspace packages/db`).
 */
const appUserUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!appUserUrl)('RLS tenant izolasyonu (docker postgres)', () => {
  const pool = new pg.Pool({ connectionString: appUserUrl });

  it('A kiracısı B kiracısının satırını göremez', async () => {
    const tenantA = newId();
    const tenantB = newId();

    await withTenant(pool, tenantA, async (client) => {
      await client.query('INSERT INTO demo_items (id, tenant_id, name) VALUES ($1, $2, $3)', [
        newId(),
        tenantA,
        'A-faturası',
      ]);
    });

    const countA = await withTenant(pool, tenantA, async (client) => {
      const { rows } = await client.query('SELECT id FROM demo_items');
      return rows.length;
    });
    expect(countA).toBe(1);

    const countB = await withTenant(pool, tenantB, async (client) => {
      const { rows } = await client.query('SELECT id FROM demo_items');
      return rows.length;
    });
    expect(countB).toBe(0);

    // Temizlik (tenant A bağlamında — kendi satırını silebilir)
    await withTenant(pool, tenantA, async (client) => {
      await client.query('DELETE FROM demo_items WHERE tenant_id = $1', [tenantA]);
    });
  });

  it('bağlam kurulmadan SELECT satır döndürmez (boş tenant)', async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT id FROM demo_items');
      expect(rows.length).toBe(0);
    } finally {
      client.release();
    }
  });
});

describe('migration dosya adı kuralı (SPEC §30.7)', () => {
  it('YYYYMMDDHHMM_<slug>.sql biçimini kabul eder', () => {
    expect(isValidMigrationName('202610050000_rls_skeleton.sql')).toBe(true);
  });

  it('kural dışı adları reddeder', () => {
    expect(isValidMigrationName('rls_skeleton.sql')).toBe(false);
    expect(isValidMigrationName('202610050000-rls-skeleton.sql')).toBe(false);
    expect(isValidMigrationName('202610050000_rls_skeleton.down.sql')).toBe(false);
  });
});
