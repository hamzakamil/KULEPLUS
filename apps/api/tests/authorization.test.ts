import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthorizationService } from '../src/modules/authorization/service';
import type { Pool } from 'pg';

/**
 * AuthorizationService birim testleri (SPEC §4.6, §6, ROADMAP Faz 1 DoD).
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

describe('AuthorizationService (birim)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe("createInvitation — 7 gün, tek kullanımlık, hash'li (SPEC §4.6)", () => {
    it('bekleyen davet varsa reddeder', async () => {
      const { pool } = makeMockPool((sql: string) => {
        if (sql.includes('FROM tenant_invitations')) return { rows: [{ id: 'inv-0' }] };
        return { rows: [] };
      });
      const svc = new AuthorizationService(pool);
      await expect(
        svc.createInvitation({
          tenantId: 'tenant-1',
          email: 'a@b.com',
          roleIds: [],
          createdBy: 'user-1',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('davet oluşturur; e-posta küçük harfe çevrilir; ham token döner', async () => {
      const { pool, client } = makeMockPool(() => ({ rows: [] }));
      const svc = new AuthorizationService(pool);
      const res = await svc.createInvitation({
        tenantId: 'tenant-1',
        email: 'DAVET@Ornek.COM',
        roleIds: ['role-1'],
        createdBy: 'user-1',
      });
      expect(res.token).toBeTruthy();
      expect(res.email).toBe('DAVET@Ornek.COM');
      const insert = client.query.mock.calls.find(([s]: unknown[]) =>
        (s as string).includes('INSERT INTO tenant_invitations'),
      );
      expect(insert).toBeTruthy();
      const params = insert?.[1] as unknown[];
      expect(params[2]).toBe('davet@ornek.com'); // küçük harf
      // Token hash'li saklanır — ham token DB'ye yazılmaz
      expect(params[4]).not.toBe(res.token);
      // 7 gün geçerlilik (SPEC §4.6)
      const expiresAt = params[5] as Date;
      const days = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);
    });
  });

  describe('acceptInvitation — davet kabulü', () => {
    it('şifreler eşleşmezse VALIDATION_ERROR döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new AuthorizationService(pool);
      await expect(
        svc.acceptInvitation({ token: 't', password: 'a', passwordConfirm: 'b' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('geçersiz/süresi dolmuş token NOT_FOUND döner', async () => {
      const { pool } = makeMockPool(() => ({ rows: [] }));
      const svc = new AuthorizationService(pool);
      await expect(
        svc.acceptInvitation({
          token: 'gecersiz',
          password: 'GucluParola123',
          passwordConfirm: 'GucluParola123',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('createRole — ücretsiz pakette max_custom_roles (K-02)', () => {
    it('rol oluşturur', async () => {
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        return { rows: [] };
      });
      const svc = new AuthorizationService(pool);
      const role = await svc.createRole('tenant-1', {
        name: 'Depo Sorumlusu',
        code: 'DEPO_SORUMLUSU',
      });
      expect(role).toBeTruthy();
      expect(executed.some((s) => s.includes('INSERT INTO roles'))).toBe(true);
    });
  });

  describe('assignUserRoles', () => {
    it('her rol için atama yazar (idempotent)', async () => {
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        return { rows: [] };
      });
      const svc = new AuthorizationService(pool);
      await svc.assignUserRoles('tenant-1', 'user-1', ['role-1', 'role-2']);
      const inserts = executed.filter((s) => s.includes('tenant_user_roles'));
      expect(inserts.length).toBeGreaterThanOrEqual(2);
    });

    it('rol ataması tenant auth_version artırır (SPEC §6.4)', async () => {
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        return { rows: [] };
      });
      const svc = new AuthorizationService(pool);
      await svc.assignUserRoles('tenant-1', 'user-1', ['role-1']);
      expect(executed.some((s) => s.includes('auth_version = auth_version + 1'))).toBe(true);
    });
  });

  describe('removeUserRole — rol düşürülmesi oturumda etkili (Faz 1 kabul kriteri)', () => {
    it('rol kaldırınca auth_version artar; eski token geçersizleşir', async () => {
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        return { rows: [] };
      });
      const svc = new AuthorizationService(pool);
      await svc.removeUserRole('tenant-1', 'user-1', 'role-1');
      expect(executed.some((s) => s.includes('DELETE FROM tenant_user_roles'))).toBe(true);
      expect(executed.some((s) => s.includes('auth_version = auth_version + 1'))).toBe(true);
    });
  });

  describe('assignPermissions — yetki değişikliği sürümlemesi', () => {
    it('izin ataması auth_version artırır ve created_at yazar', async () => {
      const executed: string[] = [];
      const { pool } = makeMockPool((sql: string) => {
        executed.push(sql);
        return { rows: [] };
      });
      const svc = new AuthorizationService(pool);
      await svc.assignPermissions('role-1', 'tenant-1', ['perm-1'], 'all');
      const insert = executed.find((s) => s.includes('INSERT INTO role_permissions'));
      expect(insert).toContain('created_at');
      expect(executed.some((s) => s.includes('auth_version = auth_version + 1'))).toBe(true);
    });
  });
});
