import { describe, expect, it } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/app';

/**
 * `trust proxy` — üretimde Caddy → nginx zinciri arkasında gerçek istemci IP'si.
 *
 * `req.ip` hız sınırı kova anahtarında ve denetim kaydında kullanılır. Express
 * `trust proxy` olmadan X-Forwarded-For'ı YOK SAYAR ve req.ip doğrudan TCP eşinin
 * (nginx konteyneri) adresi olur: tüm kullanıcılar tek kovaya düşer, denetim
 * kayıtları Docker IP'siyle dolar. Bu test o hatanın geri dönmesini engeller.
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

/** Geçersiz gövde: limitör doğrulamadan önce çalışır, veritabanına dokunulmaz. */
const invalidBody = { email: 'bot@example.com' };
const post = (xff?: string) => {
  const call = request(app).post('/api/v1/auth/register');
  return (xff ? call.set('X-Forwarded-For', xff) : call).send(invalidBody);
};

describe('trust proxy — proxy zinciri arkasında istemci kimliği', () => {
  it('ayarı yalnızca özel ağ eşleriyle sınırlıdır (genel IP güvenilmez)', () => {
    expect(app.get('trust proxy')).toBe('loopback, linklocal, uniquelocal');
  });

  it('X-Forwarded-For farklı istemcileri ayrı kovalaya ayırır', async () => {
    // A istemcisi pencereyi doldurur (kayıt limiti: 10/saat/IP).
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await post('203.0.113.10')).status).toBe(400);
    }
    expect((await post('203.0.113.10')).status).toBe(429);

    // B istemcisi A'nın dolu kovasından ETKİLENMEMELİ. `trust proxy` yoksa req.ip
    // her iki istekte de loopback olur ve bu satır 429 görerek kırılır.
    expect((await post('198.51.100.7')).status).toBe(400);
  });

  it('sahtelenmiş sol giriş, en sağındaki güvenilir olmayan girişi ezmez', async () => {
    // İstemci `1.2.3.4` taklidi yapsa da zincirin sağındaki gerçek eş belirleyicidir.
    const spoofed = await post('1.2.3.4, 203.0.113.77');
    expect(spoofed.status).toBe(400);
  });
});
