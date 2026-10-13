import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Response } from 'express';
import { requirePlatformUser, requirePlatformOwner, requirePlatformRole } from '../src/middleware/platform';
import type { PlatformRequest } from '../src/middleware/platform';
import { AppError } from '@kuleplus/shared';

/**
 * Platform yetkilendirme middleware'i — SPEC §5.1, ADR-0003 (güvenlik-kritik).
 * İki aşamalı: (1) aktif platform üyeliği, (2) owner/rol. PlatformService
 * mock'lanır; middleware'in yalnızca karar mantığı doğrulanır. Hata her
 * zaman next(error) iletilir (asenkron middleware).
 */

const { getPlatformUserByUserIdMock, getPlatformRolesMock } = vi.hoisted(() => ({
  getPlatformUserByUserIdMock: vi.fn(),
  getPlatformRolesMock: vi.fn(),
}));

vi.mock('../src/modules/platform/service', () => ({
  PlatformService: class {
    getPlatformUserByUserId = getPlatformUserByUserIdMock;
    getPlatformRoles = getPlatformRolesMock;
  },
}));

const res = {} as Response;

function makeReq(userSub?: string, platformUser?: PlatformRequest['platformUser']): PlatformRequest {
  return {
    user: userSub ? { sub: userSub, email: 'a@b.com' } : undefined,
    platformUser,
  } as PlatformRequest;
}

function nextError(next: NextFunction): AppError {
  const calls = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[0][0] as AppError;
}

describe('platform yetkilendirme middleware (SPEC §5.1, ADR-0003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requirePlatformUser', () => {
    it('kimlik doğrulama yok → UNAUTHENTICATED', async () => {
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformUser()(makeReq(), res, next);
      expect(nextError(next).code).toBe('UNAUTHENTICATED');
      expect(getPlatformUserByUserIdMock).not.toHaveBeenCalled();
    });

    it('platform kullanıcısı değil → FORBIDDEN', async () => {
      getPlatformUserByUserIdMock.mockResolvedValue(null);
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformUser()(makeReq('user-1'), res, next);
      expect(nextError(next).code).toBe('FORBIDDEN');
    });

    it('üyelik active değil → FORBIDDEN', async () => {
      getPlatformUserByUserIdMock.mockResolvedValue({ id: 'pu-1', user_id: 'u-1', is_platform_owner: false, status: 'suspended' });
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformUser()(makeReq('user-1'), res, next);
      expect(nextError(next).code).toBe('FORBIDDEN');
    });

    it('aktif platform kullanıcısı → req.platformUser kurulur, roller yüklenir', async () => {
      getPlatformUserByUserIdMock.mockResolvedValue({ id: 'pu-1', user_id: 'u-1', is_platform_owner: false, status: 'active' });
      getPlatformRolesMock.mockResolvedValue(['platform_support']);
      const req = makeReq('user-1');
      const next = vi.fn() as unknown as NextFunction;

      await requirePlatformUser()(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.platformUser).toEqual({
        id: 'pu-1',
        userId: 'u-1',
        isOwner: false,
        roles: ['platform_support'],
      });
    });

    it('servis hatası → next(error) iletilir', async () => {
      const boom = new Error('db down');
      getPlatformUserByUserIdMock.mockRejectedValue(boom);
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformUser()(makeReq('user-1'), res, next);
      expect(next).toHaveBeenCalledWith(boom);
    });
  });

  describe('requirePlatformOwner', () => {
    it('req.platformUser yok → FORBIDDEN', async () => {
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformOwner()(makeReq('user-1'), res, next);
      expect(nextError(next).code).toBe('FORBIDDEN');
    });

    it('owner değil → FORBIDDEN', async () => {
      const req = makeReq('user-1', { id: 'pu-1', userId: 'u-1', isOwner: false, roles: [] });
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformOwner()(req, res, next);
      expect(nextError(next).code).toBe('FORBIDDEN');
    });

    it('owner → next() hatasız', async () => {
      const req = makeReq('user-1', { id: 'pu-1', userId: 'u-1', isOwner: true, roles: [] });
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformOwner()(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('requirePlatformRole', () => {
    it('req.platformUser yok → FORBIDDEN', async () => {
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformRole('platform_support')(makeReq('user-1'), res, next);
      expect(nextError(next).code).toBe('FORBIDDEN');
    });

    it('rolü taşımıyor → FORBIDDEN', async () => {
      const req = makeReq('user-1', { id: 'pu-1', userId: 'u-1', isOwner: false, roles: ['platform_billing'] });
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformRole('platform_support')(req, res, next);
      expect(nextError(next).code).toBe('FORBIDDEN');
    });

    it('gerekli role sahip → next() hatasız', async () => {
      const req = makeReq('user-1', { id: 'pu-1', userId: 'u-1', isOwner: false, roles: ['platform_support'] });
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformRole('platform_support')(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('owner her rolü geçer (isOwner bypass)', async () => {
      const req = makeReq('user-1', { id: 'pu-1', userId: 'u-1', isOwner: true, roles: [] });
      const next = vi.fn() as unknown as NextFunction;
      await requirePlatformRole('platform_support')(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
