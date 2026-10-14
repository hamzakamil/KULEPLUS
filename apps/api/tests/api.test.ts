import { describe, expect, it } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/app';

function testEnv() {
  return loadEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://app_user:CHANGE_ME@localhost:5432/erp_db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  });
}

const logger = pino({ level: 'silent' });

describe('env.ts — Zod doğrulama (Faz 0: eksikse başlamaz)', () => {
  it('geçerli ortam parse edilir', () => {
    const env = testEnv();
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3000);
  });

  it('eksik secret hata fırlatır', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://x',
        REDIS_URL: 'redis://x',
        JWT_ACCESS_SECRET: 'kisa',
        JWT_REFRESH_SECRET: 'b'.repeat(32),
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('eksik DATABASE_URL hata fırlatır', () => {
    expect(() =>
      loadEnv({
        REDIS_URL: 'redis://x',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
      }),
    ).toThrow(/DATABASE_URL/);
  });
});

describe('API — health ve hata sözleşmesi (SPEC §22.1)', () => {
  const app = createApp({ env: testEnv(), logger, testRoutes: true });

  it('GET /healthz → 200 ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /readyz → 200 ready', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('x-request-id korunur ve yanıtta döner', async () => {
    const res = await request(app).get('/healthz').set('x-request-id', 'req-123');
    expect(res.headers['x-request-id']).toBe('req-123');
  });

  it('bilinmeyen rota → 404 + error contract', async () => {
    const res = await request(app).get('/olmayan-yol');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('AppError → ilgili HTTP durumu + code', async () => {
    const res = await request(app).get('/_test/forbidden');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_FORBIDDEN');
  });

  it('bilinmeyen hata → 500 INTERNAL_ERROR, stack sızdırılmaz (test ortamı)', async () => {
    const res = await request(app).get('/_test/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('stack');
  });

  it('pg 22P02 (uuid sözdizimi) → 404 NOT_FOUND, ayrıntı loga gider', async () => {
    const res = await request(app).get('/_test/pg-invalid-uuid');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain('22P02');
  });
});
