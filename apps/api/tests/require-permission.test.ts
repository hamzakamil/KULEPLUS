import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requirePermission } from '../src/middleware/require-permission';
import type { TenantRequest } from '../src/middleware/tenant';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';

/**
 * RBAC kapısı — SPEC §6.3 değerlendirme zinciri.
 * Entegrasyon route'ları da dahil TÜM modüller bu middleware'i kullanır
 * (`integrations.integration.read/manage` gibi kodlarla). Güvenlik-kritik:
 * sahiplik bypass'ı, eksik izin reddi, "ALL" semantiği ve istek-içi önbellek.
 */

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

const mockQuery = vi.fn();
const res = {} as Response;

/** Sahte bir istek — log'u sustur, middleware req.log?.warn kullanır. */
function makeReq(overrides: Partial<TenantRequest> = {}): Request {
  return {
    tenantId: 'tenant-1',
    user: { sub: 'user-1', email: 'a@b.com', tenantId: 'tenant-1' },
    log: { warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as unknown as Request;
}

/** Owner sorgusu (is_owner) ve/veya izin sorgusu (code) için sahte satırlar. */
function setupPool(opts: { isOwner: boolean; codes?: string[] }) {
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes('SELECT is_owner FROM tenant_users')) {
      return Promise.resolve({ rows: opts.isOwner ? [{ is_owner: true }] : [{ is_owner: false }] });
    }
    if (sql.includes('SELECT DISTINCT p.code')) {
      return Promise.resolve({ rows: (opts.codes ?? []).map((code) => ({ code })) });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('requirePermission middleware (SPEC §6.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    const mockPool = { query: mockQuery };
    vi.mocked(getPool).mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);
  });

  it('sahip (owner) tüm izinleri taşır → next() hatasız', async () => {
    setupPool({ isOwner: true });
    const next = vi.fn() as unknown as NextFunction;

    await requirePermission('integrations.integration.manage')(makeReq(), res, next);

    expect(next).toHaveBeenCalledWith();
    // Owner tespitinden sonra izin sorgusu ÇALIŞMAZ (erken geçiş).
    const permCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('SELECT DISTINCT p.code'));
    expect(permCall).toBeUndefined();
  });

  it('gerekli izne sahip olmayan kullanıcı → FORBIDDEN', async () => {
    setupPool({ isOwner: false, codes: ['integrations.integration.read'] });
    const next = vi.fn() as unknown as NextFunction;

    await requirePermission('integrations.integration.manage')(makeReq(), res, next);

    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('FORBIDDEN');
    expect((error as AppError).httpStatus).toBe(403);
  });

  it('tüm gerekli izinlere sahipse → next() hatasız', async () => {
    setupPool({ isOwner: false, codes: ['integrations.integration.read', 'integrations.integration.manage'] });
    const next = vi.fn() as unknown as NextFunction;

    await requirePermission('integrations.integration.read', 'integrations.integration.manage')(
      makeReq(),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('"ALL" semantiği: kodlardan biri eksikse bile reddeder', async () => {
    setupPool({ isOwner: false, codes: ['integrations.integration.read'] });
    const next = vi.fn() as unknown as NextFunction;

    await requirePermission('integrations.integration.read', 'integrations.integration.manage')(
      makeReq(),
      res,
      next,
    );

    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect((error as AppError).code).toBe('FORBIDDEN');
  });

  it('tenant + kullanıcı bağlamı yok → UNAUTHENTICATED', async () => {
    setupPool({ isOwner: false });
    const next = vi.fn() as unknown as NextFunction;
    const req = {} as Request;

    await requirePermission('integrations.integration.read')(req, res, next);

    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect((error as AppError).code).toBe('UNAUTHENTICATED');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('aynı istekte birden fazla kapı izin sorgusunu bir kez çalıştırır (önbellek)', async () => {
    setupPool({ isOwner: false, codes: ['integrations.integration.read'] });
    const next = vi.fn() as unknown as NextFunction;
    const req = makeReq();

    // Aynı req nesnesiyle iki kapı — ikisi de owner kontrolü + izin çözümünü paylaşır.
    await requirePermission('integrations.integration.read')(req, res, next);
    await requirePermission('integrations.integration.read')(req, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenNthCalledWith(1);
    expect(next).toHaveBeenNthCalledWith(2);
    const ownerCalls = mockQuery.mock.calls.filter((c) => String(c[0]).includes('SELECT is_owner FROM tenant_users'));
    expect(ownerCalls).toHaveLength(1);
  });

  it('sorgu hatası → next(error) iletilir', async () => {
    const dbError = new Error('db down');
    mockQuery.mockRejectedValueOnce(dbError);
    const next = vi.fn() as unknown as NextFunction;

    await requirePermission('integrations.integration.read')(makeReq(), res, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});
