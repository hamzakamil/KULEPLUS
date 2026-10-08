import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CompanyService } from '../src/modules/company/service';
import type { Pool } from 'pg';

/**
 * CompanyService birim testleri (SPEC §4.3, ADR-0004).
 * Manual onboarding: başvuru → platform incelemesi → tek kilitli transaction onay.
 */

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function makeMockPool(queryImpl: (sql: string, params?: unknown[]) => unknown): {
  pool: Pool;
  query: ReturnType<typeof vi.fn>;
  client: MockClient;
} {
  const query = vi.fn(queryImpl);
  const client: MockClient = { query: vi.fn(queryImpl), release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, query, client };
}

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    name: 'Örnek Ltd.',
    trade_name: 'Örnek',
    tax_office: 'Kadıköy',
    tax_number: '1234567890',
    currency: 'TRY',
    fiscal_year_start: 1,
    timezone: 'Europe/Istanbul',
    owner_email: 'owner@ornek.com',
    starting_module: 'contacts',
    status: 'pending',
    ...overrides,
  };
}

describe('CompanyService (birim)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createApplication — başvuru (SPEC §4.3)', () => {
    it('kullanıcı yoksa NOT_FOUND döner', async () => {
      const { pool } = makeMockPool((sql: string) => {
        if (sql.includes('FROM users')) return { rows: [] };
        return { rows: [] };
      });
      const svc = new CompanyService(pool);
      await expect(
        svc.createApplication({ name: 'X Ltd.', ownerEmail: 'yok@yok.com' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('bekleyen başvuru varsa reddeder', async () => {
      const { pool } = makeMockPool((sql: string) => {
        if (sql.includes('FROM users')) return { rows: [{ id: 'user-1' }] };
        if (sql.includes('company_applications')) return { rows: [{ id: 'app-0' }] };
        return { rows: [] };
      });
      const svc = new CompanyService(pool);
      await expect(
        svc.createApplication({ name: 'X Ltd.', ownerEmail: 'a@b.com' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('geçerli başvuruda kayıt oluşturur, e-postayı küçük harfe çevirir', async () => {
      const { pool, client } = makeMockPool((sql: string) => {
        if (sql.includes('FROM users')) return { rows: [{ id: 'user-1' }] };
        return { rows: [] };
      });
      const svc = new CompanyService(pool);
      const res = await svc.createApplication({
        name: 'Örnek Ltd.',
        ownerEmail: 'OWNER@Ornek.COM',
        startingModule: 'stock',
      });
      expect(res.applicationId).toBeTruthy();
      expect(res.tenantId).toBeNull();
      const insert = client.query.mock.calls.find(([s]: unknown[]) =>
        (s as string).includes('INSERT INTO company_applications'),
      );
      expect(insert).toBeTruthy();
      expect((insert?.[1] as unknown[])[8]).toBe('owner@ornek.com');
    });
  });

  describe('processApplication — tek kilitli transaction (SPEC §4.3)', () => {
    it('başvuru yoksa NOT_FOUND döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new CompanyService(pool);
      await expect(
        svc.processApplication('yok', { approve: true, reviewerId: 'rev-1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('zaten işlenmiş başvuruyu tekrar işlemez (eşzamanlılık)', async () => {
      const { pool } = makeMockPool((sql: string) => {
        if (sql.includes('FOR UPDATE')) return { rows: [applicationRow({ status: 'approved' })] };
        return { rows: [] };
      });
      const svc = new CompanyService(pool);
      await expect(
        svc.processApplication('app-1', { approve: true, reviewerId: 'rev-1' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('onayda tenant + owner + core entitlement + audit oluşturur', async () => {
      const executed: string[] = [];
      const { pool, client } = makeMockPool((sql: string) => {
        executed.push(sql);
        if (sql.includes('FOR UPDATE')) return { rows: [applicationRow()] };
        if (sql.includes('FROM users')) return { rows: [{ id: 'owner-user' }] };
        return { rows: [] };
      });
      const svc = new CompanyService(pool);
      const res = await svc.processApplication('app-1', { approve: true, reviewerId: 'rev-1' });

      expect(res.tenantId).toBeTruthy();
      expect(executed.some((s) => s.includes('INSERT INTO tenants'))).toBe(true);
      expect(executed.some((s) => s.includes('INSERT INTO tenant_users'))).toBe(true);
      expect(executed.some((s) => s.includes('tenant_entitlements'))).toBe(true);
      expect(executed.some((s) => s.includes('INSERT INTO audit_logs'))).toBe(true);
      expect(executed.some((s) => s === 'COMMIT')).toBe(true);
      void client;
    });

    it('red işleminde tenant oluşturmaz, durumu rejected yapar', async () => {
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        if (sql.includes('FOR UPDATE')) return { rows: [applicationRow()] };
        return { rows: [] };
      });
      const svc = new CompanyService(pool);
      const res = await svc.processApplication('app-1', {
        approve: false,
        rejectionReason: 'Eksik bilgi',
        reviewerId: 'rev-1',
      });
      expect(res.tenantId).toBeNull();
      expect(executed.some((s) => s.includes('INSERT INTO tenants'))).toBe(false);
      const update = executed.find((s) => s.includes('UPDATE company_applications'));
      expect(update).toBeTruthy();
    });

    it("onay e-posta servisi kapalı olsa da tamamlanır — outbox'a yazılır (SPEC §4.3)", async () => {
      // Kabul kriteri: "E-posta servisi kapalı olsa da şirket kurulumu yarım kalmaz (outbox)."
      // Onay transaction'ı e-posta GÖNDERMEZ; yalnızca outbox'a yazar. Gönderim worker'ın işi.
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        if (sql.includes('FOR UPDATE')) return { rows: [applicationRow()] };
        if (sql.includes('FROM users')) return { rows: [{ id: 'owner-user' }] };
        return { rows: [] };
      });
      const svc = new CompanyService(pool);

      const res = await svc.processApplication('app-1', {
        approve: true,
        reviewerId: 'rev-1',
      });

      // Tenant oluştu (iş yarım kalmadı)
      expect(res.tenantId).toBeTruthy();
      // Onay e-postası outbox'a yazıldı
      const outboxInsert = executed.find((s) => s.includes('INSERT INTO email_outbox'));
      expect(outboxInsert).toBeTruthy();
      expect(outboxInsert).toContain("'pending'");
      // Transaction COMMIT ile biter (e-posta gönderimini beklemez)
      expect(executed.some((s) => s === 'COMMIT')).toBe(true);
    });

    it("tenant_settings INSERT'i gerçek şemaya uygun (key/value/locked)", async () => {
      // Regresyon: servis bir zamanlar var olmayan (onboarding_mode, settings)
      // kolonlarını yazıyordu; gerçek şema (tenant_id, key, value, locked, updated_at).
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        if (sql.includes('FOR UPDATE')) return { rows: [applicationRow()] };
        if (sql.includes('FROM users')) return { rows: [{ id: 'owner-user' }] };
        return { rows: [] };
      });
      const svc = new CompanyService(pool);
      await svc.processApplication('app-1', { approve: true, reviewerId: 'rev-1' });

      const settingsInserts = executed.filter((s) => s.includes('INSERT INTO tenant_settings'));
      expect(settingsInserts.length).toBeGreaterThan(0);
      for (const sql of settingsInserts) {
        // Kolon listesi gerçek şemayla uyumlu olmalı (SPEC §4.4)
        const columns = sql.slice(sql.indexOf('('), sql.indexOf(')'));
        expect(columns).toContain('value');
        expect(columns).toContain('locked');
        expect(columns).not.toContain('onboarding_mode');
        expect(columns).not.toContain('settings');
      }
      // onboarding_mode kilitli ayardır (SPEC §4.4) — key olarak yazılır
      expect(settingsInserts.some((s) => s.includes("'onboarding_mode'"))).toBe(true);
    });
  });
});
