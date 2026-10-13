import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../src/middleware/validate';
import { AppError } from '@kuleplus/shared';

/**
 * Girdi doğrulama middleware'i — Zod şemasıyla body/query/params parse eder.
 * Parse edilen değer GERİ yazılır (kozu strip edilir, gereksiz alanlar temizlenir);
 * hata durumunda VALIDATION_ERROR (400) fırlatılır.
 */

const res = {} as Response;

/** Kullanıcı oluşturma şeması — ekstra alan reddedilir, kısıtlamalar sınanır. */
const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(80),
});

function makeReq(data: unknown) {
  return { body: data, query: data, params: data } as Request;
}

describe('validate middleware', () => {
  it('geçerli body → next() hatasız, parsed değer geri yazılır', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = makeReq({ email: 'a@b.com', name: 'Ayşe' });

    validate(userSchema)(req, res, next);

    expect(next).toHaveBeenCalledWith();
    // Zod nesnesi geri yazılır (tipli, koşullu alanlar çözülmüş)
    expect(req.body).toEqual({ email: 'a@b.com', name: 'Ayşe' });
  });

  it('eksik/geçersiz alan → VALIDATION_ERROR (400) fırlatılır', () => {
    // validate senkrondur; ZodError'ı VALIDATION_ERROR'a çevirip THROW eder
    // (Express senkron middleware hatasını otomatik yakalar → next(error)).
    const next = vi.fn() as unknown as NextFunction;
    const req = makeReq({ email: 'gecersiz-email', name: 'A' });

    let thrown: unknown;
    try {
      validate(userSchema)(req, res, next);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('VALIDATION_ERROR');
    expect((thrown as AppError).httpStatus).toBe(400);
    // Zod alan yolları hata mesajında toplanır
    expect((thrown as AppError).message).toContain('email');
    expect((thrown as AppError).message).toContain('name');
    expect(next).not.toHaveBeenCalled();
  });

  it('body dışı kaynak (query) doğrulanıp geri yazılır', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = makeReq({ email: 'a@b.com', name: 'Ayşe' });

    validate(userSchema, 'query')(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ email: 'a@b.com', name: 'Ayşe' });
  });

  it('Zod olmayan beklenmeyen hata olduğu gibi yeniden fırlatılır', () => {
    const next = vi.fn() as unknown as NextFunction;
    const boom = new Error('beklenmeyen');
    const throwingSchema = { parse: () => { throw boom; } } as unknown as z.ZodType;

    // validate senkrondur; olduğu gibi fırlatır → test onu yakalar
    expect(() => validate(throwingSchema)(makeReq({}), res, next)).toThrow(boom);
    expect(next).not.toHaveBeenCalled();
  });
});
