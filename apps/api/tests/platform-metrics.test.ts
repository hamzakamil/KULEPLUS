import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildSnapshot,
  computeDailySnapshot,
  getMetricsSummary,
  listSnapshots,
} from '../src/modules/platform/metrics.service';
import { getPool } from '@kuleplus/db';

/** Rol bazlı havuz mock'u: metrik okuması `migrator` (RLS bypass) ile yapılır. */
const { migratorQuery, appQuery } = vi.hoisted(() => ({
  migratorQuery: vi.fn(),
  appQuery: vi.fn(),
}));

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn((role: string) =>
    role === 'migrator' ? { query: migratorQuery } : { query: appQuery },
  ),
}));

describe('Platform gelir metrikleri (SPEC §8.9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    migratorQuery.mockResolvedValue({ rows: [] });
    appQuery.mockResolvedValue({ rows: [] });
  });

  /** Aktif abonelik sorgusu + hareket sorgusu yanıtlarını kurar. */
  function primeMigrator(opts?: {
    plans?: { plan_code: string; active_count: number; mrr: string; currency: string | null }[];
    movements?: { new_count: number; churned_count: number };
  }) {
    migratorQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM subscriptions s')) return Promise.resolve({ rows: opts?.plans ?? [] });
      if (sql.includes('started_at::date')) {
        return Promise.resolve({ rows: [opts?.movements ?? { new_count: 0, churned_count: 0 }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  it('MRR/ARR hesaplar ve plan dağılımını üretir (RLS bypass: migrator havuzu)', async () => {
    primeMigrator({
      plans: [
        { plan_code: 'core_plus', active_count: 3, mrr: '897.00', currency: 'TRY' },
        { plan_code: 'enterprise', active_count: 1, mrr: '799.00', currency: 'TRY' },
      ],
      movements: { new_count: 2, churned_count: 1 },
    });

    const snapshot = await buildSnapshot('2026-10-14');

    expect(getPool).toHaveBeenCalledWith('migrator');
    expect(snapshot.mrr).toBe(1696);
    expect(snapshot.arr).toBe(20352);
    expect(snapshot.activeSubscriptions).toBe(4);
    expect(snapshot.newSubscriptions).toBe(2);
    expect(snapshot.churnedSubscriptions).toBe(1);
    expect(snapshot.currency).toBe('TRY');
    expect(snapshot.planBreakdown).toEqual({
      core_plus: { activeCount: 3, mrr: 897 },
      enterprise: { activeCount: 1, mrr: 799 },
    });
    expect(snapshot.metricDate).toBe('2026-10-14');
  });

  it('abonelik yoksa sıfır metrik ve boş dağılım döner', async () => {
    primeMigrator({ plans: [] });

    const snapshot = await buildSnapshot();

    expect(snapshot.mrr).toBe(0);
    expect(snapshot.arr).toBe(0);
    expect(snapshot.activeSubscriptions).toBe(0);
    expect(snapshot.planBreakdown).toEqual({});
  });

  it('snapshot upsert eder ve hesaplanan değeri döner', async () => {
    primeMigrator({
      plans: [{ plan_code: 'core_plus', active_count: 1, mrr: '299.00', currency: 'TRY' }],
      movements: { new_count: 1, churned_count: 0 },
    });

    const snapshot = await computeDailySnapshot('2026-10-14');

    expect(snapshot.mrr).toBe(299);
    expect(appQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = appQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO platform_metrics_daily');
    expect(sql).toContain('ON CONFLICT (metric_date) DO UPDATE');
    expect(params[0]).toBe('2026-10-14');
    expect(params[2]).toBe(299); // mrr
    expect(params[3]).toBe(3588); // arr
  });

  it('geçmiş snapshot satırlarını camelCase modele çevirir ve limiti 365 ile sınırlar', async () => {
    appQuery.mockResolvedValue({
      rows: [
        {
          metric_date: '2026-10-14',
          currency: 'TRY',
          mrr: '1696.00',
          arr: '20352.00',
          active_subscriptions: 4,
          new_subscriptions: 2,
          churned_subscriptions: 1,
          plan_breakdown: { core_plus: { activeCount: 3, mrr: 897 } },
          computed_at: '2026-10-14T06:00:00.000Z',
        },
      ],
    });

    const series = await listSnapshots(500);

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      metricDate: '2026-10-14',
      mrr: 1696,
      activeSubscriptions: 4,
    });
    const [, params] = appQuery.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(365);
  });

  it('özet: canlı hesap + seri birlikte döner', async () => {
    primeMigrator({
      plans: [{ plan_code: 'enterprise', active_count: 2, mrr: '1598.00', currency: 'TRY' }],
    });
    appQuery.mockResolvedValue({ rows: [] });

    const summary = await getMetricsSummary(7);

    expect(summary.current.mrr).toBe(1598);
    expect(summary.series).toEqual([]);
  });
});
