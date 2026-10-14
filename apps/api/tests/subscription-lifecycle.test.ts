import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SubscriptionService } from '../src/modules/subscription/service';
import { applyLifecycleStep } from '@kuleplus/shared';
import { getPool } from '@kuleplus/db';
import type { PaymentProvider, WebhookEvent } from '@kuleplus/shared';

/**
 * Abonelik yaşam döngüsü testleri (SPEC §8.7/§8.8) — dunning'in ulaşamadığı
 * zaman-bağımlı geçişler: grace sonrası suspend + dönem sonu iptali + premium
 * entitlement kapatma (core hariç).
 *
 * `withTenantClient` → `pool.connect()` → `client.query` akışı; transaction/oturum
 * sorguları otomatik `{ rows: [] }` ile geçer, veri sorguları özelleştirilir.
 * SQL koşulları (grace<=now, cancel_at_period_end, ...) ayrıca metin düzeyinde
 * kilitlenir; böylece "koşul sağlanmazsa dokunmama" garantisi regresyona karşı korunur.
 */

const mockQuery = vi.fn();
const mockClient = { query: mockQuery, release: vi.fn() };
const mockPool = {
  query: mockQuery,
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock('@kuleplus/db', () => ({ getPool: vi.fn() }));

/** Mock provider — processLifecycle harici I/O yapmaz; kalıp yalnızca constructor için. */
const provider: PaymentProvider = {
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

describe('SubscriptionService — yaşam döngüsü (SPEC §8.7/§8.8)', () => {
  beforeEach(resetPool);

  describe('applyLifecycleStep — SQL koşulları (dokunmama garantisi)', () => {
    it('suspended geçişi grace + açık deneme yokluğu koşullarını içerir', async () => {
      const sqls: string[] = [];
      const q = (async (text: string) => {
        sqls.push(String(text));
        return { rows: [] };
      }) as never;
      await applyLifecycleStep(q);

      const subUpdates = sqls.filter((s) => s.includes('UPDATE subscriptions'));
      expect(subUpdates).toHaveLength(2);
      // 1. geçiş — past_due → suspended (yalnız koşullar sağlanıyorsa)
      expect(subUpdates[0]).toContain("SET status = 'suspended'");
      expect(subUpdates[0]).toContain("status = 'past_due'");
      expect(subUpdates[0]).toContain('grace_period_until IS NOT NULL');
      expect(subUpdates[0]).toContain('grace_period_until <= now()');
      expect(subUpdates[0]).toContain('NOT EXISTS');
      expect(subUpdates[0]).toContain("da.status IN ('pending', 'processing')");
      expect(subUpdates[0]).toContain('tenant_id = current_tenant_id()');
      // 2. geçiş — active + dönem sonu → cancelled (yalnız koşullar sağlanıyorsa)
      expect(subUpdates[1]).toContain("SET status = 'cancelled'");
      expect(subUpdates[1]).toContain("status = 'active'");
      expect(subUpdates[1]).toContain('cancel_at_period_end = true');
      expect(subUpdates[1]).toContain('current_period_end IS NOT NULL');
      expect(subUpdates[1]).toContain('current_period_end <= now()');
      expect(subUpdates[1]).toContain('tenant_id = current_tenant_id()');
    });

    it('entitlement kapatma yalnız premium (core hariç) + yalnız aktif satırları hedefler', async () => {
      const sqls: string[] = [];
      const q = (async (text: string) => {
        sqls.push(String(text));
        // Her iki geçişte de RETURNING satır döndür → entitlement deaktivasyonu tetiklensin.
        if (text.includes('UPDATE subscriptions')) return { rows: [{ id: 'sub-x' }] };
        return { rows: [] };
      }) as never;
      await applyLifecycleStep(q);

      const entSqls = sqls.filter((s) => s.includes('UPDATE tenant_entitlements'));
      expect(entSqls).toHaveLength(2);
      for (const sql of entSqls) {
        expect(sql).toContain("module_code <> 'core'");
        expect(sql).toContain("status = 'active'");
        expect(sql).toContain('tenant_id = current_tenant_id()');
      }
    });
  });

  describe('processLifecycle', () => {
    it('grace sonrası past_due → suspended + premium entitlement kapatıldı (core hariç)', async () => {
      const service = new SubscriptionService({
        pool: mockPool as never,
        paymentProvider: provider,
      });
      mockQuery.mockImplementation((sql: string) => {
        if (/SET status = 'suspended'/.test(sql))
          return Promise.resolve({ rows: [{ id: 'sub-1' }] });
        if (/SET status = 'cancelled'/.test(sql)) return Promise.resolve({ rows: [] });
        if (/UPDATE tenant_entitlements/.test(sql)) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      const result = await service.processLifecycle('t1');

      expect(result).toEqual({ suspended: 1, cancelled: 0 });
      const ent = mockQuery.mock.calls.find((c) => /UPDATE tenant_entitlements/.test(String(c[0])));
      expect(ent).toBeTruthy();
      expect(String(ent![0])).toContain("module_code <> 'core'");
      expect((ent![1] as unknown[])[0]).toBe('suspended');
    });

    it('dönem sonu iptali → cancelled + premium entitlement kapatıldı', async () => {
      const service = new SubscriptionService({
        pool: mockPool as never,
        paymentProvider: provider,
      });
      mockQuery.mockImplementation((sql: string) => {
        if (/SET status = 'suspended'/.test(sql)) return Promise.resolve({ rows: [] });
        if (/SET status = 'cancelled'/.test(sql))
          return Promise.resolve({ rows: [{ id: 'sub-2' }] });
        if (/UPDATE tenant_entitlements/.test(sql)) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      const result = await service.processLifecycle('t1');

      expect(result).toEqual({ suspended: 0, cancelled: 1 });
      const ent = mockQuery.mock.calls.find((c) => /UPDATE tenant_entitlements/.test(String(c[0])));
      expect(ent).toBeTruthy();
      expect((ent![1] as unknown[])[0]).toBe('cancelled');
    });

    it('koşul sağlanan geçiş yoksa dokunmaz + entitlement çağrılmaz (idempotent)', async () => {
      const service = new SubscriptionService({
        pool: mockPool as never,
        paymentProvider: provider,
      });
      // Varsayılan mock her sorguya `{ rows: [] }` döner → RETURNING satırı yok.

      const result = await service.processLifecycle('t1');

      expect(result).toEqual({ suspended: 0, cancelled: 0 });
      const entCalled = mockQuery.mock.calls.some((c) =>
        /UPDATE tenant_entitlements/.test(String(c[0])),
      );
      expect(entCalled).toBe(false);
    });
  });
});
