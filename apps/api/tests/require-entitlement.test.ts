import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Response } from 'express';
import { requireEntitlement } from '../src/middleware/require-entitlement';
import type { TenantRequest } from '../src/middleware/tenant';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
  })),
}));

/**
 * Entitlement kapısı — SPEC §8.5, TECHNICAL_SPEC §5.1.
 * Kilitli modülde endpoint MODULE_NOT_ENTITLED döner; aktif modülde geçer.
 */
describe('requireEntitlement middleware', () => {
  const mockQuery = vi.fn();
  const res = {} as Response;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockPool = { query: mockQuery };
    vi.mocked(getPool).mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);
  });

  it('aktif entitlement → next() hatasız çağrılır', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
    const req = { tenantId: 'tenant-1' } as TenantRequest;
    const next = vi.fn() as unknown as NextFunction;

    await requireEntitlement('contacts')(req, res, next);

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('tenant_entitlements'), [
      'tenant-1',
      'contacts',
    ]);
    expect(next).toHaveBeenCalledWith();
  });

  it('entitlement yok → MODULE_NOT_ENTITLED', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = { tenantId: 'tenant-1' } as TenantRequest;
    const next = vi.fn() as unknown as NextFunction;

    await requireEntitlement('stock')(req, res, next);

    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('MODULE_NOT_ENTITLED');
    expect((error as AppError).httpStatus).toBe(403);
  });

  it('expired entitlement → MODULE_NOT_ENTITLED', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'expired' }] });
    const req = { tenantId: 'tenant-1' } as TenantRequest;
    const next = vi.fn() as unknown as NextFunction;

    await requireEntitlement('stock')(req, res, next);

    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect((error as AppError).code).toBe('MODULE_NOT_ENTITLED');
  });

  it('tenant bağlamı yok → UNAUTHENTICATED', async () => {
    const req = {} as TenantRequest;
    const next = vi.fn() as unknown as NextFunction;

    await requireEntitlement('contacts')(req, res, next);

    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect((error as AppError).code).toBe('UNAUTHENTICATED');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('tenantId yoksa user.tenantId kullanılır', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
    const req = { user: { sub: 'u1', email: 'a@b.com', tenantId: 'tenant-2' } } as TenantRequest;
    const next = vi.fn() as unknown as NextFunction;

    await requireEntitlement('contacts')(req, res, next);

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['tenant-2', 'contacts']);
    expect(next).toHaveBeenCalledWith();
  });

  it('sorgu hatası → next(error) iletilir', async () => {
    const dbError = new Error('db down');
    mockQuery.mockRejectedValueOnce(dbError);
    const req = { tenantId: 'tenant-1' } as TenantRequest;
    const next = vi.fn() as unknown as NextFunction;

    await requireEntitlement('contacts')(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});
