import { describe, expect, it, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { Job } from 'bullmq';
import { createLifecycleHandler, type WorkerHandlerDeps } from '../src/handlers';
import { getPool, withTenant } from '@kuleplus/db';

/**
 * `billing-lifecycle` handler testleri — aktif tenant'ları tarar ve paylaşılan
 * kernel `applyLifecycleStep`'i her tenant kapsamında çağırır (SPEC §8.7/§8.8).
 * `@kuleplus/db` mock'lanır: `getPool` sahte havuz, `withTenant` aynı client
 * üzerinden kernel'ı çalıştırır (RLS kapsamı simüle edilir).
 */

vi.mock('@kuleplus/db', () => ({ getPool: vi.fn(), withTenant: vi.fn() }));

const logger = pino({ level: 'silent' });

const poolQuery = vi.fn();
const clientQuery = vi.fn();
const mockClient = { query: clientQuery, release: vi.fn() };
const mockPool = { query: poolQuery, connect: vi.fn().mockResolvedValue(mockClient) };

function fakeJob<T>(data: T, id = 'job-1') {
  return { id, data } as unknown as Job<T>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPool).mockReturnValue(mockPool as never);
  vi.mocked(withTenant).mockImplementation(async (_pool, _tenantId, fn) => fn(mockClient as never));
  // applyLifecycleStep: yalnız suspended geçişi RETURNING satır döndürür;
  // cancelled geçişi ve entitlement güncellemeleri boş kalır.
  clientQuery.mockImplementation((sql: string) => {
    if (/SET status = 'suspended'/.test(sql)) return Promise.resolve({ rows: [{ id: 's1' }] });
    return Promise.resolve({ rows: [] });
  });
});

describe('createLifecycleHandler', () => {
  it('aktif tenantları tarar ve her birinde yaşam döngüsü kesinleştirmesi uygular', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 't1' }, { id: 't2' }] });
    const handler = createLifecycleHandler({ logger } as WorkerHandlerDeps);

    await handler(fakeJob({}));

    // Aktif tenant sorgusu (tenants tablosu, status=active).
    const tenantSql = String(poolQuery.mock.calls[0][0]);
    expect(tenantSql).toContain('FROM tenants');
    expect(tenantSql).toContain("status = 'active'");
    // Her tenant için withTenant + kernel çağrısı.
    expect(withTenant).toHaveBeenCalledTimes(2);
    expect(withTenant).toHaveBeenCalledWith(mockPool, 't1', expect.any(Function));
    expect(withTenant).toHaveBeenCalledWith(mockPool, 't2', expect.any(Function));
    // Her tenant: suspended UPDATE (RETURNING) + cancelled UPDATE + entitlement UPDATE = 3 sorgu.
    expect(clientQuery).toHaveBeenCalledTimes(6);
    const entCalls = clientQuery.mock.calls.filter((c) =>
      /UPDATE tenant_entitlements/.test(String(c[0])),
    );
    expect(entCalls).toHaveLength(2); // 2 tenant × core harici entitlement kapatma
  });

  it('aktif tenant yoksa hiçbir işlem yapmaz', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    const handler = createLifecycleHandler({ logger } as WorkerHandlerDeps);

    await handler(fakeJob({}));

    expect(withTenant).not.toHaveBeenCalled();
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('tenantIds filtresi yalnızca hedef tenantları tarar (SQL koşulu)', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    const handler = createLifecycleHandler({ logger } as WorkerHandlerDeps);

    await handler(fakeJob({ tenantIds: ['t1'] }));

    const tenantSql = String(poolQuery.mock.calls[0][0]);
    expect(tenantSql).toContain('id = ANY($1::uuid[])');
    expect(poolQuery.mock.calls[0][1]).toEqual([['t1']]);
  });
});
