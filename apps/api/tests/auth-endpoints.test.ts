import { describe, expect, it, afterEach, vi } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/app';

/**
 * Auth uçlarının sözleşme testleri (ADR-0023) — doğrulama kapıları ve Google
 * özellik anahtarı. Veritabanına dokunmayan yollar: sınır aşılmadan reddedilen
 * istekler servise hiç ulaşmaz.
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

describe('GET /v1/auth/google/config — özellik anahtarı (ADR-0023)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('GOOGLE_CLIENT_ID tanımsızsa sosyal giriş kapalı döner', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');

    const res = await request(app).get('/api/v1/auth/google/config');

    // Frontend bu yanıtla butonu HİÇ basmaz → ölü buton değil, gizli buton
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, clientId: null });
  });

  it('GOOGLE_CLIENT_ID tanımlıysa public client id döner', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '1234567890.apps.googleusercontent.com');

    const res = await request(app).get('/api/v1/auth/google/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: true,
      clientId: '1234567890.apps.googleusercontent.com',
    });
  });
});

describe('auth uçları — girdi kapıları (ADR-0023)', () => {
  it('kısa `credential` doğrulamadan döner, Google’a istek gitmez', async () => {
    const res = await request(app).post('/api/v1/auth/google').send({ credential: 'kisa' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('KVKK kabulü olmayan kayıt reddedilir (ADR-0011)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'a@b.com', password: 'guclu-parola-123', name: 'Deneme Kullanıcı' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).toContain('KVKK');
  });

  it('8 karakter altı parola kayıtta reddedilir', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'a@b.com', password: 'kisa12', name: 'Deneme Kullanıcı', acceptTerms: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('bilinmeyen `startingModule` reddedilir', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'a@b.com',
      password: 'guclu-parola-123',
      name: 'Deneme Kullanıcı',
      startingModule: 'e-fatura',
      acceptTerms: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
