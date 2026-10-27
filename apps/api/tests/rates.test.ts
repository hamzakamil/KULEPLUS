import { describe, expect, it } from 'vitest';
import {
  RatesService,
  RATE_WATCHLIST,
  fallbackFromExchangeRates,
  mapGramhaneRates,
  type RatesFetchLike,
} from '../src/modules/management/rates.service';

/**
 * Döviz + altın kurları servisi (Gramhane canlı / TCMB yedek) — ROADMAP Faz 7.6.
 *
 * Ağ çağrısı yapılmaz: `fetchImpl` enjekte edilir ve Gramhane'nin gerçek yanıt
 * biçimi (`/v1/prices.json`, 15.10.2026'da canlıdan alınan örnek) taklit edilir.
 */

const NOW = Date.parse('2026-10-15T02:39:06Z');

/** Gramhane'nin canlı yanıtı (yalnızca kullanılan alanlar). */
const gramhanePayload = {
  meta: { status: 'success', tarih: '2026-10-15 05:39:06', yayin_sahibi: 'Gramhane' },
  kurlar: {
    ALTIN: { alis: 6564.6079, satis: 6605.8553, yuzde: 0 },
    USD: { alis: 49.3826, satis: 49.4794, yuzde: 0.12 },
    EUR: { alis: 55.3134, satis: 55.4868, yuzde: -0.31 },
    GBP: { alis: 65.0616, satis: 65.4744, yuzde: 0 },
    CHF: { alis: 59.0398, satis: 59.5252, yuzde: 0 },
    ONS: { alis: 4140.29, satis: 4145.23, yuzde: 0.45 },
    GUMUS: { alis: 83.22, satis: 90.72, yuzde: 1.2 },
    BANKA_USD: { alis: 48.9, satis: 50.1, yuzde: 0 },
  },
};

interface FakeOptions {
  payload?: unknown;
  status?: number;
  ok?: boolean;
  error?: Error;
}

/** Enjekte edilebilir fetch: kaç kez çağrıldığı ve görülen başlıklar kayıt edilir. */
function fakeFetch(options: FakeOptions = {}) {
  const calls: Array<{ url: string; init?: { headers?: Record<string, string> } }> = [];
  const fetchImpl: RatesFetchLike = async (url, init) => {
    calls.push({ url, init });
    if (options.error) throw options.error;
    const ok = options.ok ?? true;
    return {
      ok,
      status: options.status ?? (ok ? 200 : 500),
      json: async () => options.payload ?? {},
    };
  };
  return { fetchImpl, calls };
}

describe('mapGramhaneRates', () => {
  it('canlı yanıtı izleme listesi sırasıyla gösterim kalemlerine çevirir', () => {
    const items = mapGramhaneRates(gramhanePayload);
    // Şerit yalnızca Dolar/Euro/Gram altın gösterir; GBP, CHF, ONS, GUMUS atlanır.
    expect(items.map((item) => item.code)).toEqual(['USD', 'EUR', 'ALTIN']);
    const usd = items.find((item) => item.code === 'USD');
    expect(usd).toMatchObject({
      label: 'Dolar',
      kind: 'fx',
      unit: 'TRY',
      buy: 49.3826,
      sell: 49.4794,
      changePercent: 0.12,
      source: 'gramhane',
      asOf: '2026-10-15 05:39:06',
    });
    expect(items.find((item) => item.code === 'GBP')).toBeUndefined();
    expect(items.find((item) => item.code === 'CHF')).toBeUndefined();
    expect(items.find((item) => item.code === 'ONS')).toBeUndefined();
    expect(items.find((item) => item.code === 'GUMUS')).toBeUndefined();
    expect(items.find((item) => item.code === 'ALTIN')).toMatchObject({
      label: 'Gram altın',
      kind: 'gold',
      unit: 'TRY',
    });
  });

  it('bilinmeyen anahtarları ve boş satırları atlar', () => {
    // BANKA_USD listede yok; BTC tanımsız; JPY fiyatı null.
    const items = mapGramhaneRates({
      meta: { tarih: '2026-10-15 05:39:06' },
      kurlar: {
        BANKA_USD: { alis: 1, satis: 2 },
        BTC: { alis: 1, satis: 2 },
        JPY: { alis: null, satis: null },
        USD: { alis: '49,38', satis: '49,48', yuzde: '0,5' },
      },
    });
    expect(items.map((item) => item.code)).toEqual(['USD']);
    // Türkçe ondalık biçimi de ayrıştırılır.
    expect(items[0]).toMatchObject({ buy: 49.38, sell: 49.48, changePercent: 0.5 });
  });

  it('kurlar kökü yoksa düz nesneyi de okur; hiç kalem yoksa boş döner', () => {
    expect(mapGramhaneRates({ USD: { alis: 1, satis: 2 } })).toHaveLength(1);
    expect(mapGramhaneRates({})).toEqual([]);
    expect(mapGramhaneRates(null)).toEqual([]);
  });
});

describe('fallbackFromExchangeRates', () => {
  it('yalnızca döviz satırlarını TCMB kaynağıyla üretir', () => {
    const items = fallbackFromExchangeRates([
      { code: 'usd', rate: 49.3, date: '2026-10-14' },
      { code: 'EUR', rate: 55.2, date: '2026-10-14' },
      { code: 'XAU', rate: 6500, date: '2026-10-14' },
      { code: 'ALTIN', rate: 6500, date: '2026-10-14' },
    ]);
    expect(items.map((item) => item.code)).toEqual(['USD', 'EUR']);
    expect(items[0]).toMatchObject({
      source: 'TCMB',
      buy: 49.3,
      sell: 49.3,
      changePercent: null,
      asOf: '2026-10-14',
    });
  });

  it('geçersiz tutarları ve boş listeyi eler', () => {
    expect(fallbackFromExchangeRates([{ code: 'USD', rate: Number.NaN, date: '' }])).toEqual([]);
    expect(fallbackFromExchangeRates([])).toEqual([]);
  });

  it('izleme listesiyle tutarlı kalır (yeni satır eklenirse kırılmasın)', () => {
    const codes = RATE_WATCHLIST.map((item) => item.code);
    expect(codes).toContain('ALTIN');
    // Şeritte Sterlin/Ons altın yok (kokpit yalnızca Dolar, Euro, Gram altın).
    expect(codes).not.toContain('ONS');
    expect(RATE_WATCHLIST.filter((item) => item.kind === 'fx').every((i) => i.unit === 'TRY')).toBe(
      true,
    );
  });
});

describe('RatesService.liveRates', () => {
  it('Gramhane uçunu User-Agent başlığıyla çağırır (başlıksız istek reddedilir)', async () => {
    const { fetchImpl, calls } = fakeFetch({ payload: gramhanePayload });
    const service = new RatesService({ fetchImpl, now: () => NOW });

    const result = await service.liveRates();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.gramhane.com/v1/prices.json');
    expect(calls[0].init?.headers?.['User-Agent']).toBeTruthy();
    expect(result.source).toBe('gramhane');
    expect(result.error).toBeNull();
    expect(result.asOf).toBe('2026-10-15 05:39:06');
    expect(result.items).toHaveLength(3);
  });

  it('TTL dolana kadar önbellekten döner, eşzamanlı çağrılar tek isteğe iner', async () => {
    const { fetchImpl, calls } = fakeFetch({ payload: gramhanePayload });
    let clock = NOW;
    const service = new RatesService({ fetchImpl, now: () => clock, ttlMs: 60_000 });

    const [a, b] = await Promise.all([service.liveRates(), service.liveRates()]);
    expect(calls).toHaveLength(1);
    expect(a.items).toBe(b.items);

    clock = NOW + 59_000;
    await service.liveRates();
    expect(calls).toHaveLength(1);

    clock = NOW + 61_000;
    await service.liveRates();
    expect(calls).toHaveLength(2);
  });

  it('HTTP hatasında fırlatmaz; hata özetiyle boş liste döner', async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 503 });
    const service = new RatesService({ fetchImpl, now: () => NOW });

    const result = await service.liveRates();
    expect(result).toMatchObject({ items: [], source: 'none' });
    expect(result.error).toContain('503');
  });

  it('meta.status başarısız olduğunda kalemleri kullanmaz', async () => {
    const { fetchImpl } = fakeFetch({ payload: { meta: { status: 'error' }, kurlar: {} } });
    const service = new RatesService({ fetchImpl, now: () => NOW });

    const result = await service.liveRates();
    expect(result.items).toEqual([]);
    expect(result.error).toContain('beklenmeyen');
  });

  it('boş yanıt "kalem bulunamadı" olarak raporlanır', async () => {
    const { fetchImpl } = fakeFetch({ payload: { meta: { status: 'success' }, kurlar: {} } });
    const service = new RatesService({ fetchImpl, now: () => NOW });

    const result = await service.liveRates();
    expect(result.error).toContain('kalem bulunamadı');
  });

  it('ağ hatası ve zaman aşımı kokpiti kırmadan yedeğe bırakır', async () => {
    const down = new RatesService({
      fetchImpl: fakeFetch({ error: new Error('fetch failed') }).fetchImpl,
      now: () => NOW,
    });
    expect((await down.liveRates()).error).toContain('Gramhane kurları alınamadı');

    const timeout = new RatesService({
      fetchImpl: () =>
        new Promise<never>((_resolve, reject) => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }),
      now: () => NOW,
    });
    expect((await timeout.liveRates()).error).toContain('zaman aşımı');
  });

  it('başarısız denemeyi kısa süre tutar (kota dostu), sonra yeniden dener', async () => {
    const { fetchImpl, calls } = fakeFetch({ ok: false, status: 500 });
    let clock = NOW;
    const service = new RatesService({ fetchImpl, now: () => clock, ttlMs: 300_000 });

    await service.liveRates();
    clock = NOW + 10_000;
    await service.liveRates();
    expect(calls).toHaveLength(1); // negatif sonuç 30 sn boyunca tekrar denenmez

    clock = NOW + 31_000;
    await service.liveRates();
    expect(calls).toHaveLength(2);
  });
});

describe('RatesService.ratesForCockpit', () => {
  const tcmbRows = [
    { code: 'USD', rate: 49.3041, date: '2026-10-14' },
    { code: 'EUR', rate: 55.2462, date: '2026-10-14' },
  ];

  it('canlı kaynak çalışırken TCMB yedeğini kullanmaz', async () => {
    const { fetchImpl } = fakeFetch({ payload: gramhanePayload });
    const service = new RatesService({ fetchImpl, now: () => NOW });

    const result = await service.ratesForCockpit(tcmbRows);
    expect(result.source).toBe('gramhane');
    expect(result.items.some((item) => item.code === 'ALTIN')).toBe(true);
  });

  it('Gramhane erişilemezse TCMB satırlarına düşer ve hatayı taşır', async () => {
    const { fetchImpl } = fakeFetch({ error: new Error('ECONNREFUSED') });
    const service = new RatesService({ fetchImpl, now: () => NOW });

    const result = await service.ratesForCockpit(tcmbRows);
    expect(result.source).toBe('TCMB');
    expect(result.items.map((item) => item.code)).toEqual(['USD', 'EUR']);
    expect(result.items.every((item) => item.source === 'TCMB')).toBe(true);
    expect(result.error).toContain('ECONNREFUSED');
    // Altın/yedek ayrımı: TCMB bülteninde altın yoktur.
    expect(result.items.some((item) => item.kind !== 'fx')).toBe(false);
  });

  it('iki kaynak da yoksa kaynak "none"dır (kart örnek veride kalır)', async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 500 });
    const service = new RatesService({ fetchImpl, now: () => NOW });

    const result = await service.ratesForCockpit([]);
    expect(result).toMatchObject({ items: [], source: 'none' });
    expect(result.error).toContain('500');
  });
});
