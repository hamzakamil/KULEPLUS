import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlatformService } from '../src/modules/platform/service';
import type { Pool } from 'pg';

/**
 * PlatformService birim testleri (SPEC §5.1, ADR-0003).
 * Kritik kural: grant olmadan çapraz tenant erişimi YOK.
 */

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function makeMockPool(queryImpl: (sql: string, params?: unknown[]) => unknown) {
  const query = vi.fn(queryImpl);
  const client: MockClient = { query: vi.fn(queryImpl), release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, query, client };
}

describe('PlatformService (birim)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getPlatformUserByUserId', () => {
    it('platform kullanıcısı yoksa null döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new PlatformService(pool);
      expect(await svc.getPlatformUserByUserId('user-1')).toBeNull();
    });

    it('platform kullanıcısını owner bayrağıyla döner', async () => {
      const { pool } = makeMockPool(() => ({
        rows: [{ id: 'pu-1', user_id: 'u-1', is_platform_owner: true, status: 'active' }],
      }));
      const svc = new PlatformService(pool);
      const pu = await svc.getPlatformUserByUserId('u-1');
      expect(pu?.is_platform_owner).toBe(true);
    });
  });

  describe('createPlatformUser — tek owner (ADR-0003)', () => {
    it('ikinci owner denemesinde CONFLICT döner (kısmi unique index)', async () => {
      const { pool } = makeMockPool((sql: string) => {
        if (sql.includes('INSERT INTO platform_users')) {
          throw new Error('duplicate key value violates unique constraint "uq_platform_owner"');
        }
        return { rows: [] };
      });
      const svc = new PlatformService(pool);
      await expect(
        svc.createPlatformUser({ userId: 'u-1', isPlatformOwner: true }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rol kodlarıyla platform kullanıcısı oluşturur', async () => {
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        return { rows: [] };
      });
      const svc = new PlatformService(pool);
      const res = await svc.createPlatformUser({
        userId: 'u-1',
        roleCodes: ['platform_support'],
      });
      expect(res.id).toBeTruthy();
      expect(executed.some((s) => s.includes('INSERT INTO platform_user_roles'))).toBe(true);
    });
  });

  describe('grantSupportAccess — gerekçe + süre zorunlu (SPEC §5.1)', () => {
    it('kısa gerekçe VALIDATION_ERROR döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new PlatformService(pool);
      await expect(
        svc.grantSupportAccess({
          tenantId: 't-1',
          platformUserId: 'pu-1',
          reason: 'kısa',
          scope: 'read_only',
          expiresInHours: 24,
          grantedBy: 'pu-owner',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('geçersiz süre VALIDATION_ERROR döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new PlatformService(pool);
      await expect(
        svc.grantSupportAccess({
          tenantId: 't-1',
          platformUserId: 'pu-1',
          reason: 'Müşteri destek talebi #1234',
          scope: 'read_only',
          expiresInHours: 5000,
          grantedBy: 'pu-owner',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('geçerli grant oluşturur ve audit yazar', async () => {
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        return { rows: [] };
      });
      const svc = new PlatformService(pool);
      const res = await svc.grantSupportAccess({
        tenantId: 't-1',
        platformUserId: 'pu-1',
        reason: 'Müşteri destek talebi #1234',
        scope: 'read_only',
        expiresInHours: 24,
        grantedBy: 'pu-owner',
      });
      expect(res.id).toBeTruthy();
      expect(executed.some((s) => s.includes('INSERT INTO support_access_grants'))).toBe(true);
      expect(executed.some((s) => s.includes('INSERT INTO audit_logs'))).toBe(true);
    });
  });

  describe('readTenantDataWithGrant — grant yoksa erişim YOK', () => {
    it('aktif grant yoksa SUPPORT_ACCESS_REQUIRED döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new PlatformService(pool);
      await expect(
        svc.readTenantDataWithGrant('pu-1', 't-1', async () => 'gizli-veri'),
      ).rejects.toMatchObject({ code: 'SUPPORT_ACCESS_REQUIRED' });
    });
  });

  describe('revokeGrant', () => {
    it('aktif olmayan grant için NOT_FOUND döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [], rowCount: 0 }));
      const svc = new PlatformService(pool);
      await expect(svc.revokeGrant('g-1', 'pu-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
