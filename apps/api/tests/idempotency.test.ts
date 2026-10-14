import { describe, expect, it, vi, beforeEach } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { idempotency } from '../src/middleware/idempotency';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@kuleplus/db', () => ({ getPool: vi.fn(() => ({ query: queryMock })) }));

function appWithTenant() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { tenantId: string }).tenantId = 't1';
    next();
  });
  app.post('/x', idempotency(), (_req, res) => {
    res.json({ ok: true });
  });
  // AppError → JSON (gerçek uygulamadaki merkezi hata middleware'inin minik taklidi)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { httpStatus?: number }).httpStatus ?? 500;
    res
      .status(status)
      .json({ error: { code: (err as { code?: string }).code ?? 'INTERNAL_ERROR' } });
  });
  return app;
}

describe('idempotency middleware (SPEC §22.2)', () => {
  beforeEach(() => {
    queryMock.mockReset().mockResolvedValue({ rows: [] });
  });

  it('Idempotency-Key yoksa → 400', async () => {
    const res = await request(appWithTenant()).post('/x').send({ a: 1 });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('ilk istek → geçer, anahtar kaydedilir', async () => {
    const res = await request(appWithTenant())
      .post('/x')
      .set('Idempotency-Key', 'abcdefgh')
      .send({ a: 1 });
    expect(res.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('INSERT INTO idempotency_keys');
  });

  it('aynı key tekrar (unique violation 23505) → 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = await request(appWithTenant())
      .post('/x')
      .set('Idempotency-Key', 'abcdefgh')
      .send({ a: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('çok kısa key → 400', async () => {
    const res = await request(appWithTenant())
      .post('/x')
      .set('Idempotency-Key', 'abc')
      .send({ a: 1 });
    expect(res.status).toBe(400);
  });
});
