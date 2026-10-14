import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { SubscriptionService } from '../src/modules/subscription/service';
import { IyzicoPaymentProvider } from '@kuleplus/shared';

/**
 * İmzalı kamu webhook'u (K-08 sanal POS) testleri.
 *
 * iyzico JWT göndermez; yetkilendirme HAM gövde + X-IYZ-SIGNATURE-V3 imzasıyla.
 * Tenant çözümü RLS'li `payment_attempts` üzerinden MIGRATOR havuzuyla yapılır.
 * Burada gerçek iyzico imza anahtarıyla HAM payload imzalanır (kripto gerçek).
 */

const SECRET = 'test-secret-key';
const MERCHANT = 'MID123';

function signPayload(payload: Record<string, unknown>): string {
  const message =
    MERCHANT +
    SECRET +
    String(payload.iyziEventType) +
    String(payload.subscriptionReferenceCode) +
    String(payload.orderReferenceCode) +
    String(payload.customerReferenceCode);
  return createHmac('sha256', SECRET).update(message).digest('hex');
}

const migratorQuery = vi.fn();
const sharedMockQuery = vi.fn();
const sharedMockClient = { query: sharedMockQuery, release: vi.fn() };
const sharedMockPool = {
  query: sharedMockQuery,
  connect: vi.fn().mockResolvedValue(sharedMockClient),
};

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn((role?: string) => (role === 'migrator' ? mockPools.migrator : sharedMockPool)),
}));
// Rol → havuz haritası. `migrator` tenant çözümü için (RLS bypass); diğer paylaşılan mock.
const mockPools: { migrator: { query: typeof migratorQuery } } = {
  migrator: { query: migratorQuery },
};

function makeProvider() {
  return new IyzicoPaymentProvider({
    apiKey: 'key',
    secretKey: SECRET,
    merchantId: MERCHANT,
    pricingPlanReferenceCode: 'plan-ref',
  });
}

const GOOD_PAYLOAD = {
  iyziEventType: 'SUBSCRIPTION_AUTH',
  subscriptionReferenceCode: 'sub-ref-1',
  orderReferenceCode: 'order-ref-1',
  customerReferenceCode: 'cust-ref-1',
  status: 'SUCCESS',
};

describe('SubscriptionService — imzalı kamu webhook (K-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedMockQuery.mockReset().mockImplementation(() => Promise.resolve({ rows: [] }));
    sharedMockClient.query.mockReset().mockImplementation(() => Promise.resolve({ rows: [] }));
    sharedMockClient.release.mockReset();
    sharedMockPool.connect.mockReset().mockResolvedValue(sharedMockClient);
    migratorQuery.mockReset();
  });

  it('geçersiz imza → UNAUTHENTICATED (401), DB dokunulmaz', async () => {
    const service = new SubscriptionService({ paymentProvider: makeProvider() as never });
    const raw = JSON.stringify(GOOD_PAYLOAD);

    await expect(
      service.handleProviderWebhook({ provider: 'iyzico', rawBody: raw, signature: 'bad' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', httpStatus: 401 });
    expect(migratorQuery).not.toHaveBeenCalled();
    expect(sharedMockPool.connect).not.toHaveBeenCalled();
  });

  it('geçerli imza + bilinmeyen provider_ref → sessiz yutulur (retry önleme)', async () => {
    migratorQuery.mockResolvedValue({ rows: [] }); // payment_attempts eşleşmez
    const service = new SubscriptionService({ paymentProvider: makeProvider() as never });
    const raw = JSON.stringify(GOOD_PAYLOAD);

    const result = await service.handleProviderWebhook({
      provider: 'iyzico',
      rawBody: raw,
      signature: signPayload(GOOD_PAYLOAD),
    });

    expect(result).toEqual({ recorded: false, applied: false });
    // Tenant bulunamadı → RLS'li uygulama mantığı hiç koşmaz.
    expect(migratorQuery).toHaveBeenCalledTimes(1);
    expect(sharedMockPool.connect).not.toHaveBeenCalled();
  });

  it('geçerli imza + bilinen tenant → idempotent uygulama (migrator ile tenant çözümü)', async () => {
    migratorQuery.mockResolvedValue({ rows: [{ tenant_id: 'tenant-1' }] });
    // payment.succeeded akışı: attempt güncellenir (order_id döner), sonra order paid.
    sharedMockClient.query.mockImplementation((sql: string) => {
      if (String(sql).includes('provider_webhook_events')) return Promise.resolve({ rows: [] });
      if (String(sql).includes('UPDATE payment_attempts'))
        return Promise.resolve({ rows: [{ order_id: 'order-1' }] });
      return Promise.resolve({ rows: [] });
    });
    const service = new SubscriptionService({ paymentProvider: makeProvider() as never });
    const raw = JSON.stringify(GOOD_PAYLOAD);

    const result = await service.handleProviderWebhook({
      provider: 'iyzico',
      rawBody: raw,
      signature: signPayload(GOOD_PAYLOAD),
    });

    expect(result).toEqual({ recorded: true, applied: true });
    expect(migratorQuery).toHaveBeenCalledTimes(1);
    // Uygulama mantığı tenant bağlamıyla (withTenantClient) koştu.
    expect(sharedMockPool.connect).toHaveBeenCalled();
  });
});
