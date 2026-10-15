import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@kuleplus/shared';
import { rateLimit } from '../src/middleware/rate-limit';

/**
 * `rateLimit` birim testleri (ADR-0023).
 *
 * Saat enjekte edilerek test edilir: gerçek süre beklenmeden pencere kaydırılır.
 * Ara katman gövde yazmaz — kararı `next(err)` ile verir, bu yüzden sahte `res`
 * yalnızca `setHeader` kaydeder (Retry-After denetimi için).
 */

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string | number) {
      headers[name] = String(value);
    },
  };
}

function call(
  middleware: ReturnType<typeof rateLimit>,
  req: Partial<Request>,
  res = makeRes(),
): { errors: unknown[]; res: ReturnType<typeof makeRes> } {
  const errors: unknown[] = [];
  const next: NextFunction = (err?: unknown) => {
    errors.push(err);
  };
  middleware(req as Request, res as unknown as Response, next);
  // next() hatasız çağrıda undefined iter — yalnızca gerçek hataları say
  return { errors: errors.filter(Boolean), res };
}

describe('rateLimit — kayan pencere (ADR-0023)', () => {
  it('pencere içinde max isteğe izin verir, sonrakini RATE_LIMITED ile reddeder', () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 3, key: 'test', now: () => 0 });

    for (let i = 0; i < 3; i += 1) {
      expect(call(middleware, { ip: '10.0.0.1' }).errors).toHaveLength(0);
    }

    const blocked = call(middleware, { ip: '10.0.0.1' });
    expect(blocked.errors).toHaveLength(1);
    expect(blocked.errors[0]).toBeInstanceOf(AppError);
    expect((blocked.errors[0] as AppError).code).toBe('RATE_LIMITED');
  });

  it('reddedilen isteğe Retry-After başlığı koyar', () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 1, key: 'test', now: () => 0 });

    expect(call(middleware, { ip: '10.0.0.2' }).errors).toHaveLength(0);
    const blocked = call(middleware, { ip: '10.0.0.2' });
    // Pencerenin tamamı duruyor: 60 sn
    expect(blocked.res.headers['Retry-After']).toBe('60');
  });

  it('pencere dolunca sayaç sıfırlanır (kayan pencere)', () => {
    let now = 0;
    const middleware = rateLimit({ windowMs: 1_000, max: 1, key: 'test', now: () => now });

    expect(call(middleware, { ip: '10.0.0.3' }).errors).toHaveLength(0);
    expect(call(middleware, { ip: '10.0.0.3' }).errors).toHaveLength(1);

    now = 1_000; // pencere kapandı
    expect(call(middleware, { ip: '10.0.0.3' }).errors).toHaveLength(0);
  });

  it('her IP ayrı kova sayar — bir IP diğerini bloklayamaz', () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 1, key: 'test', now: () => 0 });

    expect(call(middleware, { ip: '10.0.0.4' }).errors).toHaveLength(0);
    // Başka bir makine aynı uçta ilk hakkını kullanır
    expect(call(middleware, { ip: '10.0.0.5' }).errors).toHaveLength(0);
    expect(call(middleware, { ip: '10.0.0.4' }).errors).toHaveLength(1);
  });

  it('farklı `key` uçları birbirinden bağımsız sayar', () => {
    const register = rateLimit({ windowMs: 60_000, max: 1, key: 'auth.register', now: () => 0 });
    const google = rateLimit({ windowMs: 60_000, max: 1, key: 'auth.google', now: () => 0 });

    expect(call(register, { ip: '10.0.0.6' }).errors).toHaveLength(0);
    // Kayıt kotası dolmuşken sosyal giriş kendi hakkını kullanır
    expect(call(google, { ip: '10.0.0.6' }).errors).toHaveLength(0);
  });

  it('IP çözülemezse tek kovanda toplanır (fail-closed)', () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 1, key: 'test', now: () => 0 });

    expect(call(middleware, {}).errors).toHaveLength(0);
    expect(call(middleware, {}).errors).toHaveLength(1);
  });
});
