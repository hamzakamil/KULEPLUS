import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getPool } from '@kuleplus/db';
import {
  listRates,
  latestRates,
  importRates,
  revalueForeignBalances,
  getRate,
  getLatestRate,
  calculateRateDifference,
} from '../src/modules/cash-bank/currency.service';

const sharedMockQuery = vi.fn();
const sharedMockClient = { query: sharedMockQuery, release: vi.fn() };
const sharedMockPool = {
  query: sharedMockQuery,
  connect: vi.fn().mockResolvedValue(sharedMockClient),
};

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
  })),
}));

/**
 * Döviz kur servis testleri — Faz 6.2 (ROADMAP Faz 6, SPEC §9.1/§9.2).
 *
 * cash-bank.test.ts ile aynı desen: `pool.query` ile `client.query` aynı mock
 * referansına bağlanır; kontrol sorguları (BEGIN/COMMIT/ROLLBACK/set_config)
 * otomatik `{ rows: [] }` döner.
 */
function useSharedPool() {
  vi.mocked(getPool).mockReturnValue(sharedMockPool as never);
  const route = (sql: unknown) => {
    const s = String(sql).trim();
    if (
      s === 'BEGIN' ||
      s === 'COMMIT' ||
      s === 'ROLLBACK' ||
      s.includes('set_config') ||
      s.includes('current_tenant_id')
    ) {
      return Promise.resolve({ rows: [] });
    }
    return undefined;
  };
  sharedMockQuery.mockImplementation(route);
  return { mockQuery: sharedMockQuery, mockClient: sharedMockClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  sharedMockQuery.mockReset();
  sharedMockClient.query.mockReset();
  sharedMockClient.release.mockReset();
  sharedMockPool.connect.mockReset().mockResolvedValue(sharedMockClient);
  useSharedPool();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tcmbXml = `<Tarih_Date Tarih="14.10.2026">
  <Currency Kod="USD" CurrencyCode="USD"><Unit>1</Unit><Isim>ABD DOLARI</Isim><CurrencyName>US DOLLAR</CurrencyName><ForexBuying>36.4582</ForexBuying><ForexSelling>36.8365</ForexSelling></Currency>
  <Currency Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><Isim>AVRO</Isim><CurrencyName>EURO</CurrencyName><ForexBuying>40.1204</ForexBuying><ForexSelling>40.5143</ForexSelling></Currency>
  <Currency Kod="JPY" CurrencyCode="JPY"><Unit>100</Unit><Isim>JAPON YENI</Isim><CurrencyName>JAPANESE YEN</CurrencyName><ForexBuying>24.8246</ForexBuying><ForexSelling>25.0267</ForexSelling></Currency>
</Tarih_Date>`;

describe('listRates', () => {
  it('sayfalı kur listesi döner; rate sayıya çevrilir', async () => {
    sharedMockQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ total: '2' }] });
      }
      return Promise.resolve({
        rows: [
          {
            id: 'r1',
            rate_date: '2026-10-14',
            base_currency: 'TRY',
            target_currency: 'USD',
            rate: '0.02715',
            source: 'TCMB',
            created_at: '2026-10-14T13:00:00Z',
            updated_at: null,
          },
        ],
      });
    });

    const result = await listRates('t1', { page: 1, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.totalPages).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].rate).toBeCloseTo(0.02715, 8);
    expect(result.items[0].targetCurrency).toBe('USD');
    const select = sharedMockQuery.mock.calls.find((c) => String(c[0]).includes('ORDER BY'));
    expect(String(select?.[0])).toContain('tenant_id = $1');
    expect(String(select?.[0])).toContain('base_currency = $2');
  });

  it('tarih ve para birimi filtresi koşul listesine eklenir', async () => {
    sharedMockQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '0' }] });
      return Promise.resolve({ rows: [] });
    });

    await listRates('t1', { from: '2026-10-01', to: '2026-10-14', currency: 'USD' });

    const select = sharedMockQuery.mock.calls.find((c) => String(c[0]).includes('rate_date >='));
    expect(select).toBeTruthy();
    expect(String(select?.[0])).toContain('rate_date >= $3');
    expect(String(select?.[0])).toContain('target_currency = $5');
  });
});

describe('latestRates', () => {
  it('her para birimi için en son kuru ve asOf tarihini döner', async () => {
    sharedMockQuery.mockResolvedValue({
      rows: [
        { target_currency: 'EUR', rate: '0.0246', rate_date: '2026-10-14', source: 'TCMB' },
        { target_currency: 'USD', rate: '0.0271', rate_date: '2026-10-14', source: 'TCMB' },
      ],
    });

    const result = await latestRates('t1');

    expect(result.items).toHaveLength(2);
    expect(result.items[0].rate).toBeCloseTo(0.0246, 6);
    expect(result.asOf).toBe('2026-10-14');
    expect(String(sharedMockQuery.mock.calls[0][0])).toContain('DISTINCT ON (target_currency)');
  });
});

describe('importRates', () => {
  it('TCMB XML çeker, upsert eder; count/inserted/updated döner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(tcmbXml, { status: 200 })));
    sharedMockQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('ON CONFLICT')) {
        return Promise.resolve({ rows: [{ inserted: true }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await importRates('t1', 'u1', '2026-10-14');

    expect(result).toEqual({ count: 3, inserted: 3, updated: 0 });
    const calls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toBe('BEGIN');
    expect(calls.some((s) => s.includes('set_config'))).toBe(true);
    expect(calls[calls.length - 1]).toBe('COMMIT');
  });

  it('TCMB boş sonuç dönerse EXTERNAL_SERVICE_ERROR fırlatır ve yazma yapmaz', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<Tarih_Date></Tarih_Date>', { status: 200 })),
    );

    const err = await importRates('t1', 'u1', '2026-10-14').catch((e) => e);
    expect(err).toMatchObject({ code: 'EXTERNAL_SERVICE_ERROR' });
    expect(sharedMockQuery.mock.calls.some((c) => String(c[0]).includes('ON CONFLICT'))).toBe(
      false,
    );
  });
});

describe('revalueForeignBalances', () => {
  it('dövizli hesabın pozisyonunu son kura göre değerler; kur farkını hesaplar', async () => {
    sharedMockQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes('cash_bank_accounts')) {
        return Promise.resolve({
          rows: [
            {
              id: 'a1',
              account_name: 'Dolar Kasası',
              currency: 'USD',
              opening_balance: '100',
              balance: '3500',
            },
          ],
        });
      }
      if (s.includes('SUM(CASE WHEN movement_type')) {
        return Promise.resolve({ rows: [{ net: '20' }] });
      }
      if (s.includes('ORDER BY rate_date DESC')) {
        return Promise.resolve({ rows: [{ rate: '0.027', rate_date: '2026-10-14' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const out = await revalueForeignBalances('t1', '2026-10-31', 'u1');

    expect(out.entries).toHaveLength(1);
    const e = out.entries[0];
    expect(e.accountName).toBe('Dolar Kasası');
    expect(e.currency).toBe('USD');
    // pozisyon = opening(100) + net hareket(20) = 120 USD
    expect(e.foreignPosition).toBe(120);
    // yeni TL karşılığı = 120 / 0.027
    expect(e.newBaseValue).toBeCloseTo(120 / 0.027, 6);
    expect(e.diff).toBeCloseTo(120 / 0.027 - 3500, 6);
    expect(e.rateAvailable).toBe(true);
    expect(e.rateDate).toBe('2026-10-14');
    expect(out.totalDiff).toBeCloseTo(e.diff, 6);
  });

  it('dövizli hesap yoksa boş liste ve sıfır fark döner', async () => {
    const out = await revalueForeignBalances('t1', '2026-10-31', 'u1');
    expect(out.entries).toEqual([]);
    expect(out.totalDiff).toBe(0);
  });
});

describe('getRate / getLatestRate / calculateRateDifference (API sarmalayıcıları)', () => {
  it('getLatestRate tenant bağlamını kurar ve son kuru döner', async () => {
    sharedMockQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('ORDER BY rate_date DESC')) {
        return Promise.resolve({ rows: [{ rate: '0.0271', rate_date: '2026-10-14' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const out = await getLatestRate('t1', 'USD');
    expect(out).toEqual({ rate: 0.0271, date: '2026-10-14' });
    const calls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((s) => s.includes('set_config'))).toBe(true);
  });

  it('getRate kayıt yoksa null döner', async () => {
    sharedMockQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('rate_date')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    expect(await getRate('t1', 'USD', '2026-10-14')).toBeNull();
  });

  it('calculateRateDifference iki tarih arası yüzde farkı döner', async () => {
    sharedMockQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('rate_date IN')) {
        return Promise.resolve({
          rows: [
            { rate: '0.02', rate_date: '2026-10-01' },
            { rate: '0.021', rate_date: '2026-10-14' },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const out = await calculateRateDifference('t1', 'USD', '2026-10-01', '2026-10-14');
    expect(out).not.toBeNull();
    expect(out!.diffPercent).toBeCloseTo(5, 6);
  });
});
