import { describe, expect, it, vi, beforeEach } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { loadEnv } from '../src/config/env';
import { createApp } from '../src/app';

/** Outbox gerçek DB'ye yazmasın — servis mock'lanır. */
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));

vi.mock('../src/modules/outbox/service.js', () => ({
  OutboxService: class {
    enqueue = enqueueMock;
    processItem = vi.fn();
    list = vi.fn();
    markAsSent = vi.fn();
    markAsFailed = vi.fn();
    cleanup = vi.fn();
  },
}));

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

describe('Public — iletişim formu (ROADMAP Faz 2)', () => {
  const app = createApp({ env: testEnv(), logger });
  const valid = {
    name: 'Ayşe Yılmaz',
    email: 'ayse@ornek.com',
    subject: 'Demo talebi',
    message: 'Ürünü denemek istiyorum, lütfen dönüş yapın.',
  };

  beforeEach(() => {
    enqueueMock.mockReset().mockResolvedValue({ id: 'ob-1' });
  });

  it('geçerli form → 202 + outbox kuyruğuna e-posta', async () => {
    const res = await request(app).post('/api/v1/public/contact').send(valid);
    expect(res.status).toBe(202);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0][0];
    expect(arg.to).toBeTruthy();
    expect(arg.subject).toContain('Demo talebi');
    // XSS önlemi: kullanıcı girdisi kaçışlanır
    expect(arg.html).toContain('Ayşe Yılmaz');
  });

  it('kullanıcı girdisindeki HTML kaçışlanır', async () => {
    await request(app)
      .post('/api/v1/public/contact')
      .send({ ...valid, name: '<script>alert(1)</script>' });
    const arg = enqueueMock.mock.calls[0][0];
    expect(arg.html).not.toContain('<script>');
    expect(arg.html).toContain('&lt;script&gt;');
  });

  it('geçersiz gövde (kısa mesaj) → 400', async () => {
    const res = await request(app)
      .post('/api/v1/public/contact')
      .send({ name: 'A', email: 'gecersiz', message: 'kısa' });
    expect(res.status).toBe(400);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
