import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { SignJWT } from 'jose';
import { authenticate, optionalAuth } from '../src/middleware/auth';
import type { AuthenticatedRequest } from '../src/middleware/auth';
import { AppError } from '@kuleplus/shared';

/**
 * Kimlik doğrulama middleware'i — SPEC §5 (güvenlik-kritik, %95 coverage hedefi).
 * Bearer token + jose imza doğrulama. Asenkron middleware HATA YÖNETİMİ kritik:
 * `throw` yerine HER ZAMAN `next(error)` çağrılır (aksi halde yakalanmamış
 * rejection tüm API'yi çökertir). optionalAuth token yoksa/geçersizse sessiz geçer.
 */

const SECRET = 'a'.repeat(32);
const res = {} as Response;

/** Belirtilen payload'la geçerli bir access token üret (aynı secret ile imzala). */
async function signToken(
  payload: Record<string, unknown>,
  opts: { expiresIn?: string; secret?: string } = {},
): Promise<string> {
  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '15m');
  return builder.sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

function makeReq(authorization?: string): Request {
  return { headers: authorization ? { authorization } : {} } as Request;
}

function nextError(next: NextFunction): AppError {
  const calls = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[0][0] as AppError;
}

describe('authenticate middleware (SPEC §5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  describe('authenticate — zorunlu doğrulama', () => {
    it('Authorization başlığı yok → UNAUTHENTICATED', async () => {
      const next = vi.fn() as unknown as NextFunction;
      await authenticate(makeReq(), res, next);
      const error = nextError(next);
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('UNAUTHENTICATED');
      expect(error.httpStatus).toBe(401);
    });

    it('Bearer öneki olmayan başlık → UNAUTHENTICATED', async () => {
      const next = vi.fn() as unknown as NextFunction;
      await authenticate(makeReq('Token abc'), res, next);
      expect(nextError(next).code).toBe('UNAUTHENTICATED');
    });

    it('geçerli token → req.user doldurulur, next() hatasız', async () => {
      const token = await signToken({
        sub: 'user-1',
        email: 'a@b.com',
        jti: 'jti-1',
        tenantId: 'tenant-1',
        authVersion: 3,
      });
      const req = makeReq(`Bearer ${token}`);
      const next = vi.fn() as unknown as NextFunction;

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect((req as AuthenticatedRequest).user).toEqual({
        sub: 'user-1',
        email: 'a@b.com',
        jti: 'jti-1',
        tenantId: 'tenant-1',
        authVersion: 3,
      });
    });

    it('yanlış secret ile imzalanmış token → UNAUTHENTICATED', async () => {
      const token = await signToken({ sub: 'u', email: 'a@b.com' }, { secret: 'x'.repeat(32) });
      const next = vi.fn() as unknown as NextFunction;
      await authenticate(makeReq(`Bearer ${token}`), res, next);
      expect(nextError(next).code).toBe('UNAUTHENTICATED');
    });

    it('süresi dolmuş token → UNAUTHENTICATED', async () => {
      const token = await signToken({ sub: 'u', email: 'a@b.com' }, { expiresIn: '-1m' });
      const next = vi.fn() as unknown as NextFunction;
      await authenticate(makeReq(`Bearer ${token}`), res, next);
      expect(nextError(next).code).toBe('UNAUTHENTICATED');
    });

    it('çöp token → UNAUTHENTICATED', async () => {
      const next = vi.fn() as unknown as NextFunction;
      await authenticate(makeReq('Bearer anlamsiz.token.degeri'), res, next);
      expect(nextError(next).code).toBe('UNAUTHENTICATED');
    });

    it('hata durumunda THROW etmez, next(error) ile iletir (yakalanmamış rejection yok)', async () => {
      const token = await signToken({ sub: 'u', email: 'a@b.com' }, { expiresIn: '-1m' });
      const next = vi.fn() as unknown as NextFunction;
      // Promise reddetmez; next(error) çağrısıyla tamamlanır.
      await expect(authenticate(makeReq(`Bearer ${token}`), res, next)).resolves.toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('optionalAuth — sessiz doğrulama', () => {
    it('Authorization başlığı yok → next() hatasız, req.user kurulmaz', async () => {
      const req = makeReq();
      const next = vi.fn() as unknown as NextFunction;
      await optionalAuth(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect((req as AuthenticatedRequest).user).toBeUndefined();
    });

    it('geçerli token → req.user kurulur', async () => {
      const token = await signToken({ sub: 'user-2', email: 'b@b.com', tenantId: 't-2' });
      const req = makeReq(`Bearer ${token}`);
      const next = vi.fn() as unknown as NextFunction;
      await optionalAuth(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect((req as AuthenticatedRequest).user?.sub).toBe('user-2');
    });

    it('geçersiz token → sessizce devam, next() hatasız, req.user kurulmaz', async () => {
      const req = makeReq('Bearer cop.token.deger');
      const next = vi.fn() as unknown as NextFunction;
      await optionalAuth(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect((req as AuthenticatedRequest).user).toBeUndefined();
    });

    it('Bearer öneki yoksa sessizce geçer', async () => {
      const req = makeReq('Token abc');
      const next = vi.fn() as unknown as NextFunction;
      await optionalAuth(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect((req as AuthenticatedRequest).user).toBeUndefined();
    });
  });
});
