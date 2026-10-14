import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SubscriptionService } from '../src/modules/subscription/service';
import { getPool } from '@kuleplus/db';
import type { PaymentProvider, WebhookEvent } from '@kuleplus/shared';

/**
 * Dunning testleri (SPEC §8.7/§8.8) — başarısız tahsilat sonrası yeniden deneme.
 *
 * `withTenantClient` → `pool.connect()` → `client.query` akışı; transaction/oturum
 * sorguları otomatik `{ rows: [] }` ile geçer, veri sorguları özelleştirilir.
 * `paymentProvider` sync succeeded dönen mock ile enjekte edilir.
 */

const mockQuery = vi.fn();
const mockClient = { query: mockQuery, release: vi.fn() };
const mockPool = {
  query: mockQuery,
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock('@kuleplus/db', () => ({ getPool: vi.fn() }));

/** Mock provider: `charge` sync `succeeded` (direct akış — mock iyzico hosted değil). */
const syncProvider: PaymentProvider = {
  createCustomer: async () => ({ providerCustomerRef: 'cust-1' }),
  charge: async () => ({ providerRef: 'ref-1', status: 'succeeded', redirectUrl: null }),
  refund: async (providerRef: string) => ({ providerRef, status: 'refunded' }),
  status: async (providerRef: string) => ({ providerRef, status: 'succeeded' }),
  parseWebhook: (_raw: string, _sig?: string): WebhookEvent | null => null,
};

function resetPool() {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockReset().mockResolvedValue(mockClient);
  vi.mocked(getPool).mockReturnValue(mockPool as never);
  mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
}

describe('SubscriptionService — dunning (SPEC §8.7/§8.8)', () => {
  beforeEach(resetPool);

  describe('scheduleDunning (writeDunning)', () => {
    it('aboneliği past_due yapar, 3 deneme (1/3/7 gün) açar, ek süre raporlar', async () => {
      const service = new SubscriptionService({
        pool: mockPool as never,
        paymentProvider: syncProvider,
      });

      const result = await service.scheduleDunning({
        orderId: 'order-1',
        subscriptionId: 'sub-1',
        tenantId: 't1',
      });

      expect(result.attemptCount).toBe(3);
      expect(result.gracePeriodUntil).toBeTruthy();
      // Ek süre bugün + 10 gün.
      const graceMs = new Date(result.gracePeriodUntil).getTime() - Date.now();
      expect(graceMs).toBeGreaterThan(9 * 24 * 3600 * 1000);
      expect(graceMs).toBeLessThan(11 * 24 * 3600 * 1000);

      // Abonelik past_due + grace_period_until set edildi.
      const subUpdate = mockQuery.mock.calls.find((c) => /UPDATE subscriptions/.test(String(c[0])));
      expect(subUpdate).toBeTruthy();
      expect(String(subUpdate![0])).toContain('past_due');
      // 3 dunning denemesi insert edildi (attempt_no 1/2/3).
      const inserts = mockQuery.mock.calls.filter((c) =>
        /INSERT INTO dunning_attempts/.test(String(c[0])),
      );
      expect(inserts).toHaveLength(3);
      const attemptNos = inserts.map((c) => (c[1] as unknown[])[4]);
      expect(attemptNos).toEqual([1, 2, 3]);
    });
  });

  describe('claimDueDunning', () => {
    it('vadesi gelmiş ilk bekleyen denemeyi kilitleyip processing yapar', async () => {
      const service = new SubscriptionService({
        pool: mockPool as never,
        paymentProvider: syncProvider,
      });
      const dueRow = {
        id: 'd1',
        subscription_id: 'sub-1',
        order_id: 'order-1',
        attempt_no: 1,
        amount: '149.90',
        currency: 'TRY',
      };
      mockQuery.mockImplementation((sql: string) => {
        if (/FOR UPDATE OF da SKIP LOCKED/.test(sql)) return Promise.resolve({ rows: [dueRow] });
        if (/SET status = 'processing'/.test(sql)) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      // private metod: any cast ile eriş (iç implementasyon doğrudan test edilir).
      const claimed = await (
        service as unknown as { claimDueDunning(t: string): Promise<typeof dueRow | null> }
      ).claimDueDunning('t1');

      expect(claimed).toEqual(dueRow);
      const lock = mockQuery.mock.calls.find((c) =>
        /FOR UPDATE OF da SKIP LOCKED/.test(String(c[0])),
      );
      expect(String(lock![0])).toContain("da.status = 'pending'");
      expect(String(lock![0])).toContain('da.scheduled_at <= now()');
    });

    it('bekleyen deneme yoksa null döner (işlenecek bir şey yok)', async () => {
      const service = new SubscriptionService({
        pool: mockPool as never,
        paymentProvider: syncProvider,
      });
      const claimed = await (
        service as unknown as { claimDueDunning(t: string): Promise<null> }
      ).claimDueDunning('t1');
      expect(claimed).toBeNull();
    });
  });

  describe('processDueDunning', () => {
    it('başarılı yeniden tahsilat → deneme succeeded, kalanlar skipped, abonelik active, sipariş paid', async () => {
      const service = new SubscriptionService({
        pool: mockPool as never,
        paymentProvider: syncProvider,
      });
      const dueRow = {
        id: 'd1',
        subscription_id: 'sub-1',
        order_id: 'order-1',
        attempt_no: 1,
        amount: '149.90',
        currency: 'TRY',
      };
      mockQuery.mockImplementation((sql: string) => {
        if (/FOR UPDATE OF da SKIP LOCKED/.test(sql)) return Promise.resolve({ rows: [dueRow] });
        if (/SET status = 'processing'/.test(sql)) return Promise.resolve({ rows: [] });
        if (/UPDATE dunning_attempts/.test(sql)) return Promise.resolve({ rows: [] });
        if (/UPDATE subscriptions/.test(sql)) return Promise.resolve({ rows: [] });
        if (/UPDATE commercial_orders/.test(sql)) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      const result = await service.processDueDunning('t1');

      expect(result).toEqual({ processed: 1, succeeded: 1, suspended: 0 });
      const orderUpdate = mockQuery.mock.calls.find((c) =>
        /UPDATE commercial_orders SET status = 'paid'/.test(String(c[0])),
      );
      expect(orderUpdate).toBeTruthy();
      const skip = mockQuery.mock.calls.find((c) => /SET status = 'skipped'/.test(String(c[0])));
      expect(skip).toBeTruthy();
    });

    it('işlenecek deneme yoksa sıfır sayım döner', async () => {
      const service = new SubscriptionService({
        pool: mockPool as never,
        paymentProvider: syncProvider,
      });
      const result = await service.processDueDunning('t1');
      expect(result).toEqual({ processed: 0, succeeded: 0, suspended: 0 });
    });
  });
});
