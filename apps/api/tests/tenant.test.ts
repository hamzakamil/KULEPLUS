import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { tenantContext } from '../src/middleware/tenant';
import type { AuthenticatedRequest } from '../src/middleware/auth';
import { getPool, beginTenantScope, runWithTenantScope } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';

/**
 * Tenant bağlam middleware'i — SPEC §7.1.
 * Multi-tenant izolasyonun kalbi: JWT'deki tenantId'nin GERÇEK bir üyelik
 * olduğunu doğrular (aksi halde çıkarılmış kullanıcı veri görür → sızıntı),
 * istek-scoped transaction+GUC kurar, yanıt kapanınca COMMIT/ROLLBACK yapar.
 * Hata sözleşmesi: UNAUTHENTICATED (bağlam yok) / TENANT_FORBIDDEN (üyelik yok).
 */

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({ query: vi.fn() })),
  beginTenantScope: vi.fn(),
  // Kapsam içindeki callback'i hemen çalıştır (ALS gerçekten sarar ama burada
  // next() çağrısını doğrudan gözlemlemek yeterli).
  runWithTenantScope: vi.fn((_scope: unknown, fn: () => void) => fn()),
}));

const membershipQuery = vi.fn();
const finish = vi.fn(async () => {});

/** Express Response taklidi — 'close' olayını elle tetikleyebilmek için. */
function makeRes(statusCode = 200) {
  const handlers: Record<string, () => void> = {};
  const res = {
    statusCode,
    on: vi.fn((event: string, cb: () => void) => {
      handlers[event] = cb;
      return res;
    }),
  };
  return {
    res: res as unknown as Response,
    emitClose: () => handlers.close?.(),
    statusCode: () => res.statusCode,
  };
}

function makeReq(overrides: Partial<AuthenticatedRequest['user']> = {}) {
  return { user: { sub: 'user-1', email: 'a@b.com', tenantId: 'tenant-1', ...overrides } } as Request;
}

/** async IIFE'nin (void (async()=>{})()) bitmesini bekle. */
function flush() {
  return new Promise((r) => setImmediate(r));
}

function expectAppError(arg: unknown, code: string) {
  expect(arg).toBeInstanceOf(AppError);
  expect((arg as AppError).code).toBe(code);
}

describe('tenantContext middleware (SPEC §7.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipQuery.mockReset();
    vi.mocked(getPool).mockReturnValue({ query: membershipQuery } as unknown as ReturnType<typeof getPool>);
    vi.mocked(beginTenantScope).mockResolvedValue({
      scope: { client: {}, tenantId: 'tenant-1' },
      finish,
    });
    vi.mocked(runWithTenantScope).mockImplementation((_scope, fn) => fn());
  });

  it('kullanıcı bağlamı yok → UNAUTHENTICATED', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();

    tenantContext({} as Request, res, next);
    await flush();

    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expectAppError(error, 'UNAUTHENTICATED');
    expect(membershipQuery).not.toHaveBeenCalled();
    expect(beginTenantScope).not.toHaveBeenCalled();
  });

  it('tenantId yok → UNAUTHENTICATED', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();

    tenantContext(makeReq({ tenantId: undefined }), res, next);
    await flush();

    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expectAppError(error, 'UNAUTHENTICATED');
  });

  it('üyelik doğrulanamaz (rowCount 0) → TENANT_FORBIDDEN', async () => {
    membershipQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();

    tenantContext(makeReq(), res, next);
    await flush();

    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expectAppError(error, 'TENANT_FORBIDDEN');
    expect((error as AppError).httpStatus).toBe(403);
    expect(beginTenantScope).not.toHaveBeenCalled();
  });

  it('geçerli üyelik → req.tenantId kurulur, next() kapsam içinde çağrılır', async () => {
    membershipQuery.mockResolvedValue({ rows: [{}], rowCount: 1 });
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    const req = makeReq();

    tenantContext(req, res, next);
    await flush();

    expect((req as { tenantId?: string }).tenantId).toBe('tenant-1');
    expect(beginTenantScope).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
    expect(runWithTenantScope).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('2xx yanıtta close → transaction COMMIT (finish(true))', async () => {
    membershipQuery.mockResolvedValue({ rows: [{}], rowCount: 1 });
    const next = vi.fn() as unknown as NextFunction;
    const { res, emitClose } = makeRes(200);

    tenantContext(makeReq(), res, next);
    await flush();
    emitClose();
    await flush();

    expect(finish).toHaveBeenCalledWith(true);
  });

  it('4xx yanıtta close → transaction ROLLBACK (finish(false))', async () => {
    membershipQuery.mockResolvedValue({ rows: [{}], rowCount: 1 });
    const next = vi.fn() as unknown as NextFunction;
    const { res, emitClose } = makeRes(403);

    tenantContext(makeReq(), res, next);
    await flush();
    emitClose();
    await flush();

    expect(finish).toHaveBeenCalledWith(false);
  });

  it('üyelik sorgusu hata verirse → next(error)', async () => {
    const dbError = new Error('db down');
    membershipQuery.mockRejectedValueOnce(dbError);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();

    tenantContext(makeReq(), res, next);
    await flush();

    expect(next).toHaveBeenCalledWith(dbError);
    expect(beginTenantScope).not.toHaveBeenCalled();
  });
});
