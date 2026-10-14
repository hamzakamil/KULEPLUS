import { describe, expect, it, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { Job } from 'bullmq';
import { createCurrencyImportHandler } from '../src/handlers';
import { getPool } from '@kuleplus/db';
import * as shared from '@kuleplus/shared';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(),
  withTenant: vi.fn(async (_pool: unknown, _tenantId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@kuleplus/shared', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, fetchTCMBRates: vi.fn(), upsertRates: vi.fn() };
});

/**
 * Worker — TCMB kur içe aktarma handler testleri (Faz 6.2, ROADMAP Faz 6).
 * Idempotent upsert (ADR-0020): aynı job tekrar çalışsa yeni yan etki üretmez.
 */

const logger = pino({ level: 'silent' });

function fakeJob<T>(data: T, id = 'job-cur-1') {
  return { id, data } as unknown as Job<T>;
}

const rate = {
  code: 'USD',
  name: 'ABD DOLARI',
  unit: 1,
  forexBuying: 36.45,
  forexSelling: 36.83,
  effectiveDate: '2026-10-14',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPool).mockReturnValue({ query: vi.fn() } as never);
});

describe('createCurrencyImportHandler', () => {
  it('tenantIds verilirse kurları çeker ve her tenant için upsert eder', async () => {
    vi.mocked(shared.fetchTCMBRates).mockResolvedValue([rate]);
    vi.mocked(shared.upsertRates).mockResolvedValue({ inserted: 1, updated: 0 });

    const handler = createCurrencyImportHandler({ logger });
    await handler(fakeJob({ tenantIds: ['t1', 't2'], rateDate: '2026-10-14' }));

    expect(shared.fetchTCMBRates).toHaveBeenCalledWith('2026-10-14');
    expect(shared.upsertRates).toHaveBeenCalledTimes(2);
    expect(shared.upsertRates).toHaveBeenCalledWith(expect.anything(), 't1', [rate], {
      userId: 'system',
    });
    expect(shared.upsertRates).toHaveBeenCalledWith(expect.anything(), 't2', [rate], {
      userId: 'system',
    });
  });

  it('tenantIds verilmezse aktif tenantları veritabanından çeker ve hepsine upsert eder', async () => {
    const pool = { query: vi.fn() as ReturnType<typeof vi.fn> };
    vi.mocked(getPool).mockReturnValue(pool as never);
    pool.query.mockResolvedValue({
      rows: [{ tenant_id: 'a' }, { tenant_id: 'b' }, { tenant_id: 'c' }],
    });
    vi.mocked(shared.fetchTCMBRates).mockResolvedValue([rate]);
    vi.mocked(shared.upsertRates).mockResolvedValue({ inserted: 1, updated: 0 });

    const handler = createCurrencyImportHandler({ logger });
    await handler(fakeJob({}));

    expect(pool.query).toHaveBeenCalledWith(
      'SELECT DISTINCT tenant_id FROM tenant_users WHERE tenant_id IS NOT NULL',
    );
    expect(shared.upsertRates).toHaveBeenCalledTimes(3);
  });

  it('TCMB boş sonuç dönerse upsert çağrılmaz (yan etki yok)', async () => {
    vi.mocked(shared.fetchTCMBRates).mockResolvedValue([]);

    const handler = createCurrencyImportHandler({ logger });
    await handler(fakeJob({ tenantIds: ['t1'] }));

    expect(shared.upsertRates).not.toHaveBeenCalled();
  });

  it('TCMB hatasında handler hatayı yeniden fırlatır (BullMQ retry)', async () => {
    vi.mocked(shared.fetchTCMBRates).mockRejectedValue(new Error('TCMB erişilemedi'));

    const handler = createCurrencyImportHandler({ logger });
    await expect(handler(fakeJob({ tenantIds: ['t1'] }))).rejects.toThrow('TCMB erişilemedi');
  });
});
