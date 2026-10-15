/**
 * Döviz + altın kurları — Gramhane API (canlı) + TCMB (exchange_rates) yedeği.
 *
 * Neden ayrı bir servis? Kokpitteki "Döviz kuru" şeridi eskiden yalnızca
 * tenant'ın elle içe aktardığı TCMB satırlarını gösteriyordu; içe aktarım
 * yapılmamış bir şirkette kart hiç dolmuyordu ve altında altın da yoktu.
 * Gramhane tek istekte döviz + altın + gümüş verdiği için kokpit gösterimi
 * bu kaynaktan beslenir; **muhasebe kuralları değişmez** — fatura kuru, kur
 * farkı ve dönem sonu değerlemesi `exchange_rates` (TCMB) üzerinden yürür.
 *
 * Kaynak uç (ücretsiz, API key yok):
 *   GET https://api.gramhane.com/v1/prices.json
 *   → { meta: { status:'success', tarih:'2026-10-15 05:39:06' },
 *       kurlar: { USD:{alis,satis,yuzde}, EUR:{...}, GBP:{...}, CHF:{...},
 *                 ALTIN:{...}, ONS:{...}, GUMUS:{...} } }
 *
 * KRİTİK: `User-Agent` başlığı zorunludur; başlıksız istek reddedilir.
 * Kota IP başına dakikada 60 istek → 5 dakikalık önbellek + eşzamanlı istek
 * tekilleştirme ile art arda kokpit yenilemeleri tek ağ isteğine iner.
 *
 * Hata davranışı: ağ/zaman aşımı/bozuk yanıt fırlatmaz; `items: []` ve
 * `error` döner. Çağıran (kokpit) TCMB satırlarına düşer, onlar da yoksa
 * kart örnek veride kalır ve `sections.demo` bunu bildirir.
 */

import { getPool } from '@kuleplus/db';

const GRAMHANE_URL = 'https://api.gramhane.com/v1/prices.json';
/** Gramhane dokümantasyonu `User-Agent` zorunlu tutar (uygulama kimliği). */
const GRAMHANE_HEADERS: Record<string, string> = {
  'User-Agent': 'KulePlus/1.0 (muhasebe; kokpit-kurlari)',
  Accept: 'application/json',
};

/** Kokpit yenileme sıklığına göre güvenli önbellek (60 istek/dk kotası). */
const RATES_TTL_MS = 5 * 60 * 1000;
/** Kokpit kurları beklemez: 5 sn içinde yanıt gelmezse kart yedeğe düşer. */
const REQUEST_TIMEOUT_MS = 5_000;

/** Kalem türü — arayüz satır etiketini ve para birimini buna göre seçer. */
export type RateKind = 'fx' | 'gold' | 'metal';

export interface RateDefinition {
  /** Gösterim kodu (USD, ALTIN, ONS, GUMUS). */
  code: string;
  /** Türkçe gösterim adı. */
  label: string;
  kind: RateKind;
  /** Fiyatın para birimi (ons altın USD ile yayınlanıyor). */
  unit: 'TRY' | 'USD';
  /** Gramhane `kurlar` anahtarı. */
  gramhaneKey: string;
}

/**
 * Kokpit şeridinde gösterilen kalemler. Sıra önemlidir: döviz → altın → gümüş.
 * Gramhane bu yedi kalemi veriyor; genişletme yeni satır ekleyerek yapılır.
 */
export const RATE_WATCHLIST: ReadonlyArray<RateDefinition> = [
  { code: 'USD', label: 'Dolar', kind: 'fx', unit: 'TRY', gramhaneKey: 'USD' },
  { code: 'EUR', label: 'Euro', kind: 'fx', unit: 'TRY', gramhaneKey: 'EUR' },
  { code: 'GBP', label: 'Sterlin', kind: 'fx', unit: 'TRY', gramhaneKey: 'GBP' },
  { code: 'CHF', label: 'İsviçre Frangı', kind: 'fx', unit: 'TRY', gramhaneKey: 'CHF' },
  { code: 'ALTIN', label: 'Gram altın', kind: 'gold', unit: 'TRY', gramhaneKey: 'ALTIN' },
  { code: 'ONS', label: 'Ons altın', kind: 'gold', unit: 'USD', gramhaneKey: 'ONS' },
  { code: 'GUMUS', label: 'Gümüş (gram)', kind: 'metal', unit: 'TRY', gramhaneKey: 'GUMUS' },
];

/** Tek kalem — kokpit `rates` dizisinin elemanı. */
export interface RateItem {
  code: string;
  label: string;
  kind: RateKind;
  unit: 'TRY' | 'USD';
  buy: number | null;
  sell: number | null;
  /** Günlük değişim yüzdesi; kaynak vermiyorsa null. */
  changePercent: number | null;
  /** `gramhane`: canlı piyasa · `TCMB`: tenant'ın içe aktardığı resmî kur. */
  source: 'gramhane' | 'TCMB';
  /** Kaynak verisinin üretim zamanı (Gramhane `meta.tarih` veya kur tarihi). */
  asOf: string | null;
}

export interface RatesResult {
  items: RateItem[];
  /** Hiçbir kaynak kullanılamadıysa `none`. */
  source: 'gramhane' | 'TCMB' | 'none';
  asOf: string | null;
  /** Canlı kaynak hatasının kullanıcıya gösterilecek kısa özeti. */
  error: string | null;
}

/** Test/DI enjeksiyonu — Node 18+ global fetch ile uyumlu. */
export type RatesFetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface RatesServiceOptions {
  fetchImpl?: RatesFetchLike;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
}

const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const strOrNull = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
};

/**
 * Gramhane yanıtını (`kurlar`) gösterim kalemlerine çevirir.
 * Bilinmeyen/eksik anahtarlar atlanır; hiç kalem yoksa boş dizi döner.
 * `kurlar` kökünde yoksa düz `{USD:{...}}` biçimi de kabul edilir.
 */
export function mapGramhaneRates(raw: unknown): RateItem[] {
  const payload = (raw ?? {}) as Record<string, unknown>;
  const table = (payload.kurlar ?? payload) as Record<string, unknown>;
  const meta = (payload.meta ?? {}) as Record<string, unknown>;
  const asOf = strOrNull(meta.tarih);

  const items: RateItem[] = [];
  for (const definition of RATE_WATCHLIST) {
    const row = table?.[definition.gramhaneKey];
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const buy = numOrNull(record.alis);
    const sell = numOrNull(record.satis);
    if (buy === null && sell === null) continue;
    items.push({
      code: definition.code,
      label: definition.label,
      kind: definition.kind,
      unit: definition.unit,
      buy,
      sell,
      changePercent: numOrNull(record.yuzde),
      source: 'gramhane',
      asOf,
    });
  }
  return items;
}

/**
 * Yedek kaynak: tenant'ın `exchange_rates` (TCMB) satırları.
 * Altın/gümüş TCMB günlük kur bülteninde yayınlanmadığı için yalnızca döviz
 * üretilir (canlı altın isteniyorsa tek kaynak Gramhane'dir).
 */
export function fallbackFromExchangeRates(
  rows: Array<{ code: string; rate: number; date: string }>,
): RateItem[] {
  const items: RateItem[] = [];
  for (const row of rows ?? []) {
    const code = String(row?.code ?? '').trim().toUpperCase();
    const definition = RATE_WATCHLIST.find((item) => item.code === code && item.kind === 'fx');
    if (!definition) continue;
    const rate = numOrNull(row.rate);
    if (rate === null) continue;
    items.push({
      code: definition.code,
      label: definition.label,
      kind: definition.kind,
      unit: definition.unit,
      buy: rate,
      sell: rate,
      changePercent: null,
      source: 'TCMB',
      asOf: strOrNull(row.date),
    });
  }
  return items;
}


interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const failResult = (error: string): RatesResult => ({
  items: [],
  source: 'none',
  asOf: null,
  error,
});

export class RatesService {
  private readonly fetchImpl: RatesFetchLike;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private cache: CacheEntry<RatesResult> | null = null;
  private inflight: Promise<RatesResult> | null = null;

  constructor(options: RatesServiceOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ??
      ((url, init) => fetch(url, init) as unknown as ReturnType<RatesFetchLike>);
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? RATES_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** Önbellek anahtarı yalnızca canlı kaynak içindir (piyasa geneli, tenant'sız). */
  private isFresh(): boolean {
    return this.cache !== null && this.cache.expiresAt > this.now();
  }

  /**
   * Canlı kurlar. Hata asla fırlatılmaz: `{ items: [], source: 'none', error }`.
   * TTL dolmadıysa ağa çıkmaz; eşzamanlı çağrılar aynı isteği paylaşır.
   */
  async liveRates(): Promise<RatesResult> {
    if (this.isFresh()) return this.cache!.value;
    if (this.inflight) return this.inflight;

    const request = this.fetchRates()
      .then((result) => {
        // Başarısız denemeyi kısa süre tutarız: kokpit yeniden denesin, ama
        // art arda tıklamalar Gramhane kotasını tüketmesin.
        const ttl = result.items.length > 0 ? this.ttlMs : Math.min(this.ttlMs, 30_000);
        this.cache = { value: result, expiresAt: this.now() + ttl };
        return result;
      })
      .finally(() => {
        this.inflight = null;
      });

    this.inflight = request;
    return request;
  }

  /**
   * Kokpit için birleşik sonuç: önce Gramhane (canlı, altın dahil), o yoksa
   * tenant'ın TCMB satırları. `fallback` boşsa ve canlı da yoksa `source:'none'`.
   */
  async ratesForCockpit(
    fallback: Array<{ code: string; rate: number; date: string }> = [],
  ): Promise<RatesResult> {
    const live = await this.liveRates();
    if (live.items.length > 0) return live;
    const items = fallbackFromExchangeRates(fallback);
    if (items.length > 0) {
      return { items, source: 'TCMB', asOf: items[0]?.asOf ?? null, error: live.error };
    }
    return failResult(live.error ?? 'Kur kaynağı bulunamadı');
  }

  private async fetchRates(): Promise<RatesResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(GRAMHANE_URL, {
        headers: GRAMHANE_HEADERS,
        signal: controller.signal,
      });
      if (!response.ok) return failResult(`Gramhane yanıtı başarısız (HTTP ${response.status})`);

      const payload = await response.json();
      const meta = ((payload ?? {}) as Record<string, unknown>).meta as
        | Record<string, unknown>
        | undefined;
      const status = String(meta?.status ?? '').trim().toLowerCase();
      if (status.length > 0 && status !== 'success') {
        return failResult(`Gramhane durumu beklenmeyen (${String(meta?.status)})`);
      }

      const items = mapGramhaneRates(payload);
      if (items.length === 0) return failResult('Gramhane yanıtında kalem bulunamadı');
      return { items, source: 'gramhane', asOf: items[0]?.asOf ?? null, error: null };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? 'zaman aşımı'
          : error instanceof Error
            ? error.message
            : 'bilinmeyen hata';
      return failResult(`Gramhane kurları alınamadı (${reason})`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Modül düzeyi tekil örnek — tüm kokpit istekleri aynı önbelleği paylaşır. */
export const ratesService = new RatesService();

/**
 * Tenant'ın `exchange_rates` (TCMB) son kur satırları — canlı kaynak
 * erişilemediğinde kartın düştüğü yedek. RLS GUC'si elle kurulur (servis
 * katmanı deseni: currency.service.ts).
 */
export async function latestExchangeRateRows(
  tenantId: string,
): Promise<Array<{ code: string; rate: number; date: string }>> {
  const pool = getPool('app');
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const codes = RATE_WATCHLIST.filter((item) => item.kind === 'fx').map((item) => item.code);
    const result = await client.query(
      `SELECT DISTINCT ON (target_currency) target_currency::text AS code,
              rate::float8 AS rate, rate_date::text AS date
         FROM exchange_rates
        WHERE tenant_id = current_tenant_id() AND base_currency = 'TRY'
          AND target_currency::text = ANY($1::text[])
        ORDER BY target_currency, rate_date DESC`,
      [codes],
    );
    return result.rows.map((row) => ({
      code: String(row.code),
      rate: Number(row.rate),
      date: String(row.date),
    }));
  } finally {
    client.release();
  }
}

