import { describe, expect, it } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/app';

/**
 * Kayıt ucunun oran sınırı — uçtan uca (ADR-0023).
 *
 * Bu dosya YALNIZCA bu senaryoyu çalıştırır: `rateLimit` sayacı rota modülünde
 * (modül düzeyinde) yaşar, bu yüzden aynı dosyaya başka `/auth/register` isteği
 * koyulursa pencere önceden dolar ve sayaç beklentisi bozulur.
 */

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

const app = createApp({ env: testEnv(), logger: pino({ level: 'silent' }), testRoutes: true });

/** Geçersiz gövde: limitör doğrulamadan ÖNCE çalışır, veritabanına hiç dokunulmaz. */
const invalidBody = { email: 'bot@example.com' };

describe('POST /v1/auth/register — IP başına pencere (ADR-0023)', () => {
  it('10 istekten sonra 429 + RATE_LIMITED + Retry-After döner', async () => {
    // Pencere: 10 istek/saat/IP (`routes.ts` → signupRateLimit)
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const res = await request(app).post('/api/v1/auth/register').send(invalidBody);
      expect(res.status, `${attempt}. istek limit dışında olmamalı`).toBe(400);
    }

    const blocked = await request(app).post('/api/v1/auth/register').send(invalidBody);

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    // İstemci ve proxy'ler için standart alan
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
