import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  computeRateRevaluation,
  fetchTCMBRates,
  getLatestRate,
  getRate,
  upsertRates,
  calculateRateDifference,
} from '../src/currency';

/**
 * Döviz kuru yardımcıları — Faz 6.2 (SPEC §9.1/§9.2).
 *
 * `fetchTCMBRates` gerçek TCMB XML formatını temel alan örnek XML ile test edilir
 * (global `fetch` stub'lanır). DB fonksiyonları sahte pool/client üzerinde doğrulanır.
 */

/** TCMB günlük kur XML'i — today.xml ile aynı yapı (USD/EUR/JPY + kur olmayan altın satırı). */
function tcmbXml(date = '14.10.2026'): string {
  return `<Tarih_Date Tarih="${date}">
  <Currency Kod="USD" CurrencyCode="USD">
    <Unit>1</Unit>
    <Isim>ABD DOLARI</Isim>
    <CurrencyName>US DOLLAR</CurrencyName>
    <ForexBuying>36.4582</ForexBuying>
    <ForexSelling>36.8365</ForexSelling>
    <BanknoteBuying>36.4242</BanknoteBuying>
    <BanknoteSelling>36.8622</BanknoteSelling>
  </Currency>
  <Currency Kod="EUR" CurrencyCode="EUR">
    <Unit>1</Unit>
    <Isim>AVRO</Isim>
    <CurrencyName>EURO</CurrencyName>
    <ForexBuying>40.1204</ForexBuying>
    <ForexSelling>40.5143</ForexSelling>
    <BanknoteBuying>40.0762</BanknoteBuying>
    <BanknoteSelling>40.5354</BanknoteSelling>
  </Currency>
  <Currency Kod="JPY" CurrencyCode="JPY">
    <Unit>100</Unit>
    <Isim>JAPON YENI</Isim>
    <CurrencyName>JAPANESE YEN</CurrencyName>
    <ForexBuying>24.8246</ForexBuying>
    <ForexSelling>25.0267</ForexSelling>
    <BanknoteBuying>24.8132</BanknoteBuying>
    <BanknoteSelling>25.0396</BanknoteSelling>
  </Currency>
  <Currency Kod="XAU" CurrencyCode="XAU">
    <Unit>1</Unit>
    <Isim>GRAM ALTIN</Isim>
    <CurrencyName>GRAM GOLD</CurrencyName>
    <ForexBuying></ForexBuying>
    <ForexSelling></ForexSelling>
    <BanknoteBuying></BanknoteBuying>
    <BanknoteSelling></BanknoteSelling>
  </Currency>
</Tarih_Date>`;
}

function mockFetchOnce(xml: string, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockPool() {
  const client = { query: vi.fn(), release: vi.fn() } as unknown as PoolClient;
  const pool = { query: vi.fn(), connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { pool, client };
}

/** `client.query` üzerinde çalışan tüm SQL metinlerini sırayla döner. */
function sqlCalls(client: PoolClient): string[] {
  return (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
}

describe('fetchTCMBRates — TCMB XML parse', () => {
  it('satış kurunu (ForexSelling) çözer; birimi 1 olmayanlarda (JPY) korur', async () => {
    mockFetchOnce(tcmbXml());
    const rates = await fetchTCMBRates();

    expect(rates).toHaveLength(3); // XAU satış+buying boş → atlanır
    const usd = rates.find((r) => r.code === 'USD');
    expect(usd?.forexSelling).toBe(36.8365);
    expect(usd?.forexBuying).toBe(36.4582);
    expect(usd?.unit).toBe(1);

    const jpy = rates.find((r) => r.code === 'JPY');
    expect(jpy?.forexSelling).toBe(25.0267);
    expect(jpy?.unit).toBe(100);
  });

  it('hem alış hem satış kuru boş olan satırı atlar (XAU)', async () => {
    mockFetchOnce(tcmbXml());
    const rates = await fetchTCMBRates();
    expect(rates.find((r) => r.code === 'XAU')).toBeUndefined();
  });

  it('tarih verilirse tarihli XML URL kullanılır (ggaayyyy biçimi)', async () => {
    mockFetchOnce(tcmbXml('14.10.2026'));
    await fetchTCMBRates('2026-10-14');
    const called = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(called).toContain('14102026.xml');
  });

  it('HTTP hatasında EXTERNAL_SERVICE_ERROR kodlu AppError fırlatır', async () => {
    mockFetchOnce('', 503);
    const err = await fetchTCMBRates().catch((e) => e);
    expect(err).toMatchObject({ code: 'EXTERNAL_SERVICE_ERROR' });
  });
});

describe('upsertRates — Pool modu (kendi transaction ve tenant bağlamını kurar)', () => {
  it('BEGIN → set_config → INSERT ON CONFLICT → COMMIT akışını yürütür; inserted/updated sayar', async () => {
    const { pool, client } = mockPool();
    let row = -1;
    (client.query as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if (String(sql).includes('ON CONFLICT')) {
        row += 1;
        return Promise.resolve({ rows: [{ inserted: row === 0 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const out = await upsertRates(pool, 'tenant-1', [
      {
        code: 'USD',
        name: 'ABD DOLARI',
        unit: 1,
        forexBuying: 36.45,
        forexSelling: 36.83,
        effectiveDate: '2026-10-14',
      },
      {
        code: 'EUR',
        name: 'AVRO',
        unit: 1,
        forexBuying: 40.12,
        forexSelling: 40.51,
        effectiveDate: '2026-10-14',
      },
    ]);

    const calls = sqlCalls(client);
    expect(calls[0]).toBe('BEGIN');
    expect(calls.some((s) => s.includes('set_config'))).toBe(true);
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(out).toEqual({ inserted: 1, updated: 1 });
  });

  it('kur değerini 1 base = rate hedef biçiminde yazar (unit/selling)', async () => {
    const { pool, client } = mockPool();
    (client.query as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) =>
      String(sql).includes('ON CONFLICT')
        ? Promise.resolve({ rows: [{ inserted: true }] })
        : Promise.resolve({ rows: [] }),
    );

    await upsertRates(pool, 't1', [
      {
        code: 'USD',
        name: '',
        unit: 1,
        forexBuying: 36.45,
        forexSelling: 36.83,
        effectiveDate: '2026-10-14',
      },
    ]);

    const call = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes('ON CONFLICT'),
    );
    // rateValue = unit / selling = 1 / 36.83 ≈ 0.02715
    const params = call?.[1] as unknown[];
    expect(Number(params?.[4])).toBeCloseTo(1 / 36.83, 8);
  });

  it('hata durumunda ROLLBACK yapar ve hatayı yeniden fırlatır', async () => {
    const { pool, client } = mockPool();
    (client.query as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if (String(sql).includes('ON CONFLICT')) throw new Error('constraint ihlali');
      return Promise.resolve({ rows: [] });
    });

    await expect(
      upsertRates(pool, 't1', [
        {
          code: 'USD',
          name: '',
          unit: 1,
          forexBuying: 1,
          forexSelling: 2,
          effectiveDate: '2026-10-14',
        },
      ]),
    ).rejects.toThrow('constraint ihlali');
    expect(sqlCalls(client)).toContain('ROLLBACK');
  });
});

describe('upsertRates — PoolClient modu (dış transaction kullanır)', () => {
  it('connect/BEGIN/COMMIT/set_config/release çağırmaz; yalnızca INSERT yürütür', async () => {
    const client = { query: vi.fn(), release: vi.fn() } as unknown as PoolClient;
    (client.query as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) =>
      String(sql).includes('ON CONFLICT')
        ? Promise.resolve({ rows: [{ inserted: true }] })
        : Promise.resolve({ rows: [] }),
    );

    const out = await upsertRates(client, 'tenant-1', [
      {
        code: 'USD',
        name: '',
        unit: 1,
        forexBuying: 1,
        forexSelling: 2,
        effectiveDate: '2026-10-14',
      },
    ]);

    const calls = sqlCalls(client);
    expect(calls.some((s) => s.includes('BEGIN'))).toBe(false);
    expect(calls.some((s) => s.includes('COMMIT'))).toBe(false);
    expect(calls.some((s) => s.includes('set_config'))).toBe(false);
    expect(client.release).not.toHaveBeenCalled();
    expect(out).toEqual({ inserted: 1, updated: 0 });
  });
});

describe('getRate / getLatestRate / calculateRateDifference', () => {
  function mockQueryPool() {
    const pool = { query: vi.fn() } as unknown as Pool;
    return { pool, query: pool.query as unknown as ReturnType<typeof vi.fn> };
  }

  it('getRate kayıt yoksa null, varsa Number döner; rate_date $2 olarak bağlanır', async () => {
    const { pool, query } = mockQueryPool();
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getRate(pool, 't1', 'USD', '2026-10-14')).toBeNull();

    query.mockResolvedValueOnce({ rows: [{ rate: '0.02715' }] });
    expect(await getRate(pool, 't1', 'USD', '2026-10-14')).toBeCloseTo(0.02715, 8);
    expect(String(query.mock.calls[1][0])).toContain('rate_date = $2');
  });

  it('getLatestRate tarihe göre sıralar ve en son kur + tarihi döner', async () => {
    const { pool, query } = mockQueryPool();
    query.mockResolvedValue({ rows: [{ rate: '0.03', rate_date: '2026-10-13' }] });
    const out = await getLatestRate(pool, 't1', 'USD');
    expect(out).toEqual({ rate: 0.03, date: '2026-10-13' });
    expect(String(query.mock.calls[0][0])).toContain('ORDER BY rate_date DESC');
  });

  it('calculateRateDifference iki tarihte tam kur yoksa null döner', async () => {
    const { pool, query } = mockQueryPool();
    query.mockResolvedValue({ rows: [{ rate: '0.02', rate_date: '2026-10-01' }] });
    expect(await calculateRateDifference(pool, 't1', 'USD', '2026-10-01', '2026-10-14')).toBeNull();
  });

  it('calculateRateDifference yüzde farkı hesaplar', async () => {
    const { pool, query } = mockQueryPool();
    query.mockResolvedValue({
      rows: [
        { rate: '0.02', rate_date: '2026-10-01' },
        { rate: '0.021', rate_date: '2026-10-14' },
      ],
    });
    const out = await calculateRateDifference(pool, 't1', 'USD', '2026-10-01', '2026-10-14');
    expect(out).not.toBeNull();
    expect(out!.fromRate).toBe(0.02);
    expect(out!.toRate).toBe(0.021);
    expect(out!.diffPercent).toBeCloseTo(5, 6);
  });
});

describe('computeRateRevaluation — dönem sonu değerleme çekirdeği (saf)', () => {
  it('dövizli pozisyon: yeni TL karşılığı = foreign / kur; kur farkını hesaplar', () => {
    // 100 USD; mevcut kayıt 3.700 TRY; son kur 0.0271 (1 TRY = 0.0271 USD)
    const out = computeRateRevaluation({
      foreignPosition: 100,
      currentBaseValue: 3700,
      latestRate: 0.0271,
    });
    expect(out.newBaseValue).toBeCloseTo(100 / 0.0271, 6);
    expect(out.diff).toBeCloseTo(100 / 0.0271 - 3700, 6);
    expect(out.rateAvailable).toBe(true);
  });

  it('kur yoksa/sıfırsa değerleme yapmaz (diff=0, mevcut değer korunur)', () => {
    const zero = computeRateRevaluation({
      foreignPosition: 100,
      currentBaseValue: 3700,
      latestRate: 0,
    });
    expect(zero.rateAvailable).toBe(false);
    expect(zero.newBaseValue).toBe(3700);
    expect(zero.diff).toBe(0);

    const nan = computeRateRevaluation({
      foreignPosition: 100,
      currentBaseValue: 3700,
      latestRate: Number.NaN,
    });
    expect(nan.rateAvailable).toBe(false);
    expect(nan.diff).toBe(0);
  });
});
