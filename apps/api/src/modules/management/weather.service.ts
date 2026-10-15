import { AppError } from '@kuleplus/shared';
import { z } from 'zod';

/**
 * MGM (Meteoroloji Genel Müdürlüğü) hava durumu istemcisi — şehir bazlı tahmin.
 *
 * Neden burada? Kokpitteki "Hava durumu" bölümü şantiyelerin bulunduğu ile göre
 * tahmin göstermek zorundadır; şantiye kaydı `sites.province/district` taşır.
 *
 * Kaynak uçlar (MGM'nin kendi web istemcisinin kullandığı herkese açık servis):
 *  - `GET /web/merkezler?sorgu=<il|ilçe>`  → istasyon çözümlemesi (il/ilçe → istNo)
 *  - `GET /web/merkezler/iller`            → 81 il merkezi (il listesi)
 *  - `GET /web/tahminler/gunluk?merkezid=` → 5 günlük tahmin (en düşük/en yüksek)
 *  - `GET /web/tahminler/saatlik?istno=`   → saatlik tahmin (sıcaklık, nem, rüzgâr)
 *
 * KRİTİK: servis `Referer` + `Origin` başlıkları olmadan
 * `{"error":"ServerError","message":"Not allowed by MGM"}` döner (HTTP 500).
 * Başlıklar bu yüzden sabittir — kaldırılırsa tüm istekler 500 olur.
 *
 * Hadise (olay) kodları ve rüzgâr yönü kısaltmaları MGM'nin kendi web
 * istemcisindeki `convertHadise` / `convertruzgarYonuKisa` fonksiyonlarından
 * birebir alınmıştır (Scripts/ziko16_js/angularService/ililceler.js).
 *
 * Hata davranışı: ağ/MGM hatası çağıranı kilitlemez; `forecastForSites`
 * başarısız şantiyeyi `status: 'unavailable'` ile döndürür ve kokpit o bölümü
 * örnek veriye bırakır (kullanıcı boş ekran görmez).
 */

const MGM_BASE = 'https://servis.mgm.gov.tr/web';
const MGM_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  Referer: 'https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx',
  Origin: 'https://www.mgm.gov.tr',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'tr-TR,tr;q=0.9',
};

/** Vinç (kule vinci) rüzgâr eşikleri — kokpitteki gösterimle aynı kaynak. */
export const WIND_LIMIT_KPH = 45;
export const WIND_STOP_KPH = 40;
export const WIND_CAUTION_KPH = 30;

/** İstek zaman aşımı: kokpit yüklemesi MGM'yi beklemeden cevap verebilmelidir. */
const REQUEST_TIMEOUT_MS = 6_000;
const CENTER_TTL_MS = 24 * 60 * 60 * 1000;
const FORECAST_TTL_MS = 15 * 60 * 1000;
/** Kokpitteki toplam hava durumu bütçesi: bu süre aşılırsa kalan satırlar boş kalır. */
const SITES_BUDGET_MS = 7_000;
const CACHE_MAX_ENTRIES = 200;

/** Şantiye formundaki ilçe sorgusu (`GET /management/weather/districts?province=`). */
export const weatherDistrictsQuerySchema = z.object({
  province: z.string().trim().min(1, 'İl zorunlu').max(80),
});

/**
 * MGM hadise kodu → Türkçe ad (MGM `convertHadise` birebir kopyası).
 * Not: `GSY` "Gökgürültülü Sağanak Yağışlı"dır, "güneşli" DEĞİLDİR.
 */
export const HADISE_LABELS: Readonly<Record<string, string>> = {
  A: 'Açık',
  AB: 'Az Bulutlu',
  PB: 'Parçalı Bulutlu',
  CB: 'Çok Bulutlu',
  HY: 'Hafif Yağmurlu',
  Y: 'Yağmurlu',
  KY: 'Kuvvetli Yağmurlu',
  KKY: 'Karla Karışık Yağmurlu',
  HKY: 'Hafif Kar Yağışlı',
  K: 'Kar Yağışlı',
  KYK: 'Yoğun Kar Yağışlı',
  YKY: 'Yoğun Kar Yağışlı',
  HSY: 'Hafif Sağanak Yağışlı',
  SY: 'Sağanak Yağışlı',
  KSY: 'Kuvvetli Sağanak Yağışlı',
  MSY: 'Mevzi Sağanak Yağışlı',
  DY: 'Dolu',
  GSY: 'Gökgürültülü Sağanak Yağışlı',
  KGY: 'Kuvvetli Gökgürültülü Sağanak Yağışlı',
  SIS: 'Sisli',
  PUS: 'Puslu',
  DNM: 'Dumanlı',
  KF: 'Toz veya Kum Fırtınası',
  R: 'Rüzgarlı',
  GKR: 'Güneyli Kuvvetli Rüzgar',
  KKR: 'Kuzeyli Kuvvetli Rüzgar',
  SCK: 'Sıcak',
  SGK: 'Soğuk',
  HHY: 'Yağışlı',
};

/** Hadise kodunun Türkçe adı; bilinmeyen kod boş döner (MGM davranışı). */
export function hadiseLabel(code: unknown): string {
  const key = String(code ?? '').trim().toUpperCase();
  return HADISE_LABELS[key] ?? '';
}

const WIND_DIR_SHORT: ReadonlyArray<readonly [number, number, string]> = [
  [0, 22.5, 'K'],
  [22.5, 67.5, 'KD'],
  [67.5, 112.5, 'D'],
  [112.5, 157.5, 'GD'],
  [157.5, 202.5, 'G'],
  [202.5, 247.5, 'GB'],
  [247.5, 292.5, 'B'],
  [292.5, 337.5, 'KB'],
  [337.5, 361, 'K'],
];

/** Rüzgâr yönü (derece) → kısa yön kısaltması (MGM `convertruzgarYonuKisa`). */
export function windDirectionShort(deg: unknown): string {
  const value = Number(deg);
  if (!Number.isFinite(value)) return '';
  for (const [min, max, label] of WIND_DIR_SHORT) {
    if (value >= min && value < max) return label;
  }
  return '';
}

const WIND_DIR_LONG: Readonly<Record<string, string>> = {
  K: 'Kuzeyden',
  KD: 'Kuzeydoğudan',
  D: 'Doğudan',
  GD: 'Güneydoğudan',
  G: 'Güneyden',
  GB: 'Güneybatıdan',
  B: 'Batıdan',
  KB: 'KuzeyBatıdan',
};

/** Rüzgâr yönü (derece) → "Kuzeyden" biçimi (MGM `convertruzgarYonu`). */
export function windDirectionLong(deg: unknown): string {
  return WIND_DIR_LONG[windDirectionShort(deg)] ?? '';
}

/** Vinç rüzgâr risk seviyesi — `sites` hava kartındaki renk kuralının tek kaynağı. */
export function windRiskLevel(windKph: unknown): 'ok' | 'limit' | 'stop' {
  const value = Number(windKph);
  if (!Number.isFinite(value)) return 'ok';
  if (value >= WIND_STOP_KPH) return 'stop';
  if (value >= WIND_CAUTION_KPH) return 'limit';
  return 'ok';
}

/**
 * Türkçe duyarsız karşılaştırma anahtarı: "İSTANBUL" | "istanbul" → "istanbul",
 * "Keçiören" → "kecioren". Noktalı/noktasız i ayrımı ve aksan tekilleştirilir.
 */
export function normalizeTr(value: unknown): string {
  return String(value ?? '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/Ş/g, 's')
    .replace(/ş/g, 's')
    .replace(/Ğ/g, 'g')
    .replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u')
    .replace(/ü/g, 'u')
    .replace(/Ö/g, 'o')
    .replace(/ö/g, 'o')
    .replace(/Ç/g, 'c')
    .replace(/ç/g, 'c')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** MGM istasyon kaydı — `merkezler` uçlarının döndürdüğü alanların kullanılan kısmı. */
export interface MgmCenter {
  il: string;
  ilce: string | null;
  /** Günlük tahmin istasyonu (= `gunlukTahminIstNo`). */
  merkezId: number | null;
  gunlukTahminIstNo: number | null;
  saatlikTahminIstNo: number | null;
  sondurumIstNo: number | null;
  enlem: number | null;
  boylam: number | null;
  oncelik?: number | null;
}

/** Günlük tahmin satırı (kokpitte 3 gün gösterilir). */
export interface SiteWeatherDay {
  /** `YYYY-MM-DD` (Europe/Istanbul). */
  date: string;
  /** "Bugün" | "Yarın" | "Çar" — yerel etiket. */
  label: string;
  min: number | null;
  max: number | null;
  condition: string;
  conditionLabel: string;
  windKph: number | null;
  windDirShort: string;
}

/** Bir şantiyenin hava durumu — kokpit `weather` dizisinin elemanı. */
export interface SiteWeather {
  siteId: string;
  siteName: string;
  province: string;
  district: string | null;
  /** `ok`: tahmin var · `unresolved`: il/ilçe MGM'de yok · `unavailable`: MGM'ye ulaşılamadı. */
  status: 'ok' | 'unresolved' | 'unavailable';
  /** Kullanıcıya gösterilecek kısa açıklama (hata durumunda). */
  message: string | null;
  station: { il: string; ilce: string | null; merkezId: number | null } | null;
  /** MGM verisinin üretim zamanı (saatlik tahmin `baslangicZamani`). */
  updatedAt: string | null;
  temp: number | null;
  feelsLike: number | null;
  humidity: number | null;
  condition: string;
  conditionLabel: string;
  windKph: number | null;
  windGustKph: number | null;
  windDirDeg: number | null;
  windDirShort: string;
  windDirLong: string;
  /** Vinç çalışma kararı (WIND_* eşikleri). */
  windRisk: 'ok' | 'limit' | 'stop';
  daily: SiteWeatherDay[];
}

/** Test/DI için enjekte edilebilir fetch (Node 18+ global fetch ile uyumlu). */
export type MgmFetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface WeatherServiceOptions {
  fetchImpl?: MgmFetchLike;
  /** Test için sahte saat. */
  now?: () => number;
  centerTtlMs?: number;
  forecastTtlMs?: number;
  timeoutMs?: number;
}

const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const strOrNull = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
};

/** En küçük `oncelik` değeri kazanan istasyonu seçer. */
function pickBest(centers: MgmCenter[]): MgmCenter | null {
  if (centers.length === 0) return null;
  return [...centers].sort((a, b) => (a.oncelik ?? 99) - (b.oncelik ?? 99))[0] ?? null;
}

/**
 * Verilen MGM istasyon listesinden il/ilçe eşleşmesini seçer.
 *
 * Sıra: (1) il + ilçe tam eşleşme, (2) ilin merkez istasyonu (ilçesi boş kayıt),
 * (3) ilin ilk istasyonu. İl hiç yoksa `null` — çağıran "unresolved" der.
 */
export function matchCenter(
  centers: MgmCenter[],
  province: string,
  district?: string | null,
): MgmCenter | null {
  const provinceKey = normalizeTr(province);
  const districtKey = normalizeTr(district);
  const sameProvince = centers.filter((center) => normalizeTr(center.il) === provinceKey);
  if (sameProvince.length === 0) return null;

  if (districtKey) {
    const exact = sameProvince.filter((center) => normalizeTr(center.ilce) === districtKey);
    if (exact.length > 0) return pickBest(exact);
  }
  const centerStation = sameProvince.filter((center) => !normalizeTr(center.ilce));
  if (centerStation.length > 0) return pickBest(centerStation);
  return pickBest(sameProvince);
}

/** Bugünün Europe/Istanbul tarihi (`YYYY-MM-DD`) — gün etiketleri için. */
function istanbulToday(now: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

/** Tahmin günü etiketi: Bugün / Yarın / kısa gün adı (Europe/Istanbul). */
function dayLabel(dateIso: string, todayIso: string, now: number): string {
  if (dateIso === todayIso) return 'Bugün';
  if (dateIso === istanbulToday(now + 24 * 60 * 60 * 1000)) return 'Yarın';
  const date = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
  }).format(date);
}

/** Şantiye kimliği dışındaki tahmin gövdesi (kokpit dizi elemanına eklenir). */
export type SiteWeatherCore = Omit<SiteWeather, 'siteId' | 'siteName' | 'province' | 'district'>;

/** Günlük + saatlik tahminin ortak önbellek paketi. */
interface ForecastBundle {
  dailyRoot: Record<string, unknown> | null;
  hourlyRoot: Record<string, unknown> | null;
}

/** Önbellek satırı — TTL sonunda okuma anında düşer. */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class WeatherService {
  private readonly fetchImpl: MgmFetchLike;
  private readonly now: () => number;
  private readonly centerTtlMs: number;
  private readonly forecastTtlMs: number;
  private readonly timeoutMs: number;
  private readonly centerCache = new Map<string, CacheEntry<MgmCenter[]>>();
  private readonly forecastCache = new Map<string, CacheEntry<ForecastBundle>>();
  private readonly provinceCache = new Map<
    string,
    CacheEntry<Array<{ il: string; ilPlaka: number | null }>>
  >();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(options: WeatherServiceOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<MgmFetchLike>);
    this.now = options.now ?? (() => Date.now());
    this.centerTtlMs = options.centerTtlMs ?? CENTER_TTL_MS;
    this.forecastTtlMs = options.forecastTtlMs ?? FORECAST_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  private readCache<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
    const hit = store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= this.now()) {
      store.delete(key);
      return null;
    }
    return hit.value;
  }

  private writeCache<T>(
    store: Map<string, CacheEntry<T>>,
    key: string,
    value: T,
    ttlMs: number,
  ): void {
    if (store.size >= CACHE_MAX_ENTRIES) store.clear();
    store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  /** MGM JSON ucu — her zaman dizi döner; durum kodunda/hata biçiminde fırlatır. */
  private async getJson(url: string): Promise<unknown[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: MGM_HEADERS,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MGM yanıtı başarısız (HTTP ${response.status})`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('MGM beklenmeyen yanıt biçimi');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Aynı anahtarlı eşzamanlı istekleri tekilleştirir + TTL ile önbellekler. */
  private async cached<T>(
    store: Map<string, CacheEntry<T>>,
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cachedValue = this.readCache(store, key);
    if (cachedValue) return cachedValue;
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const promise = loader()
      .then((value) => {
        this.writeCache(store, key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  private toCenter(raw: Record<string, unknown>): MgmCenter {
    return {
      il: String(raw.il ?? ''),
      ilce: strOrNull(raw.ilce),
      merkezId: numOrNull(raw.merkezId),
      gunlukTahminIstNo: numOrNull(raw.gunlukTahminIstNo),
      saatlikTahminIstNo: numOrNull(raw.saatlikTahminIstNo),
      sondurumIstNo: numOrNull(raw.sondurumIstNo),
      enlem: numOrNull(raw.enlem),
      boylam: numOrNull(raw.boylam),
      oncelik: numOrNull(raw.oncelik),
    };
  }

  /** İl/ilçe araması (`GET /merkezler?sorgu=`) — 24 saat önbellekli. */
  async searchCenters(query: string): Promise<MgmCenter[]> {
    const term = String(query ?? '').trim();
    if (term.length === 0) return [];
    const key = `centers:${normalizeTr(term)}`;
    return this.cached(this.centerCache, key, this.centerTtlMs, async () => {
      const rows = await this.getJson(`${MGM_BASE}/merkezler?sorgu=${encodeURIComponent(term)}`);
      return (rows as Record<string, unknown>[]).map((row) => this.toCenter(row));
    });
  }

  /** 81 il (plaka kodu ile) — şantiye formundaki il listesi. */
  async listProvinces(): Promise<Array<{ il: string; ilPlaka: number | null }>> {
    return this.cached(this.provinceCache, 'provinces', this.centerTtlMs, async () => {
      const rows = await this.getJson(`${MGM_BASE}/merkezler/iller`);
      const seen = new Map<string, { il: string; ilPlaka: number | null }>();
      for (const row of rows as Record<string, unknown>[]) {
        const il = String(row.il ?? '').trim();
        if (!il || seen.has(il)) continue;
        seen.set(il, { il, ilPlaka: numOrNull(row.ilPlaka) });
      }
      return [...seen.values()].sort((a, b) => a.il.localeCompare(b.il, 'tr'));
    });
  }

  /** İlin MGM istasyon ilçeleri — şantiye formundaki ilçe seçenekleri. */
  async listDistricts(province: string): Promise<string[]> {
    const centers = await this.searchCenters(province);
    const provinceKey = normalizeTr(province);
    const districts = centers
      .filter((center) => normalizeTr(center.il) === provinceKey && center.ilce)
      .map((center) => String(center.ilce));
    return [...new Set(districts)].sort((a, b) => a.localeCompare(b, 'tr'));
  }

  /**
   * İl/ilçe → MGM istasyonu. İlçe bulunamazsa il merkezine düşer; il de yoksa
   * `null` (çağıran "unresolved" olarak işaretler).
   */
  async resolveCenter(province: string, district?: string | null): Promise<MgmCenter | null> {
    const provinceName = String(province ?? '').trim();
    if (provinceName.length === 0) return null;
    const districtName = String(district ?? '').trim();

    if (districtName.length > 0) {
      const byDistrict = matchCenter(
        await this.searchCenters(districtName),
        provinceName,
        districtName,
      );
      if (byDistrict) return byDistrict;
    }
    return matchCenter(await this.searchCenters(provinceName), provinceName, null);
  }

  /** Günlük tahmin yanıtından 3 günlük özet üretir (Gun1..Gun3 = bugün..+2). */
  private buildDaily(daily: Record<string, unknown>, now: number): SiteWeatherDay[] {
    const todayIso = istanbulToday(now);
    const days: SiteWeatherDay[] = [];
    for (let day = 1; day <= 3; day++) {
      const rawDate = strOrNull(daily[`tarihGun${day}`]);
      const dateIso = rawDate ? rawDate.slice(0, 10) : '';
      const condition = String(daily[`hadiseGun${day}`] ?? '');
      days.push({
        date: dateIso || todayIso,
        label: dateIso ? dayLabel(dateIso, todayIso, now) : `+${day} gün`,
        min: numOrNull(daily[`enDusukGun${day}`]),
        max: numOrNull(daily[`enYuksekGun${day}`]),
        condition,
        conditionLabel: hadiseLabel(condition),
        windKph: numOrNull(daily[`ruzgarHizGun${day}`]),
        windDirShort: windDirectionShort(daily[`ruzgarYonGun${day}`]),
      });
    }
    return days;
  }

  /** Saatlik tahminden şimdiye en yakın (yoksa ilk) saati seçer. */
  private pickHourly(
    hourlyRoot: Record<string, unknown> | null,
    now: number,
  ): Record<string, unknown> | null {
    const list = Array.isArray(hourlyRoot?.tahmin)
      ? (hourlyRoot?.tahmin as Record<string, unknown>[])
      : [];
    if (list.length === 0) return null;
    const threshold = now - 30 * 60 * 1000;
    const upcoming = list.find((hour) => {
      const time = Date.parse(String(hour.tarih ?? ''));
      return Number.isFinite(time) && time >= threshold;
    });
    return upcoming ?? list[0] ?? null;
  }

  /**
   * Tek şantiye için MGM tahmini. Günlük + saatlik paralel çekilir; en az biri
   * gelirse sonuç üretilir, ikisi de başarısızsa fırlatır (çağıran yakalar).
   */
  async forecast(province: string, district?: string | null): Promise<SiteWeatherCore> {
    const center = await this.resolveCenter(province, district);
    if (!center) {
      return {
        status: 'unresolved',
        message: `MGM'de istasyon bulunamadı: ${province}${district ? ' · ' + district : ''}`,
        station: null,
        updatedAt: null,
        temp: null,
        feelsLike: null,
        humidity: null,
        condition: '',
        conditionLabel: '',
        windKph: null,
        windGustKph: null,
        windDirDeg: null,
        windDirShort: '',
        windDirLong: '',
        windRisk: 'ok',
        daily: [],
      };
    }

    const dailyId = center.gunlukTahminIstNo ?? center.merkezId;
    const hourlyId = center.saatlikTahminIstNo ?? center.sondurumIstNo;
    const cacheKey = `forecast:${dailyId ?? '-'}:${hourlyId ?? '-'}`;
    const bundle = await this.cached(this.forecastCache, cacheKey, this.forecastTtlMs, async () => {
      const [dailyResult, hourlyResult] = await Promise.allSettled([
        dailyId
          ? this.getJson(`${MGM_BASE}/tahminler/gunluk?merkezid=${dailyId}`)
          : Promise.reject(new Error('günlük tahmin istasyonu yok')),
        hourlyId
          ? this.getJson(`${MGM_BASE}/tahminler/saatlik?istno=${hourlyId}`)
          : Promise.reject(new Error('saatlik tahmin istasyonu yok')),
      ]);
      const dailyRoot =
        dailyResult.status === 'fulfilled'
          ? ((dailyResult.value[0] as Record<string, unknown> | undefined) ?? null)
          : null;
      const hourlyRoot =
        hourlyResult.status === 'fulfilled'
          ? ((hourlyResult.value[0] as Record<string, unknown> | undefined) ?? null)
          : null;
      if (!dailyRoot && !hourlyRoot) {
        const reason =
          dailyResult.status === 'rejected'
            ? dailyResult.reason
            : hourlyResult.status === 'rejected'
              ? hourlyResult.reason
              : new Error('MGM verisi yok');
        throw reason instanceof Error ? reason : new Error(String(reason));
      }
      return { dailyRoot, hourlyRoot } satisfies ForecastBundle;
    });

    const now = this.now();
    const hour = this.pickHourly(bundle.hourlyRoot, now);
    const condition = String(hour?.hadise ?? bundle.dailyRoot?.hadiseGun1 ?? '');
    const windDirDeg = numOrNull(hour?.ruzgarYonu ?? bundle.dailyRoot?.ruzgarYonGun1);
    const windKph = numOrNull(hour?.ruzgarHizi ?? bundle.dailyRoot?.ruzgarHizGun1);

    return {
      status: 'ok',
      message: null,
      station: { il: center.il, ilce: center.ilce, merkezId: center.merkezId },
      updatedAt: strOrNull(bundle.hourlyRoot?.baslangicZamani) ?? new Date(now).toISOString(),
      temp: numOrNull(hour?.sicaklik ?? bundle.dailyRoot?.enYuksekGun1),
      feelsLike: numOrNull(hour?.hissedilenSicaklik),
      humidity: numOrNull(hour?.nem ?? bundle.dailyRoot?.enDusukNemGun1),
      condition,
      conditionLabel: hadiseLabel(condition),
      windKph,
      windGustKph: numOrNull(hour?.maksimumRuzgarHizi),
      windDirDeg,
      windDirShort: windDirectionShort(windDirDeg),
      windDirLong: windDirectionLong(windDirDeg),
      windRisk: windRiskLevel(windKph),
      daily: bundle.dailyRoot ? this.buildDaily(bundle.dailyRoot, now) : [],
    };
  }

  /** Promise'i süre sınırına bağlar; süre dolarsa `onTimeout` çalışır. */
  private async withDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => never): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            try {
              onTimeout();
            } catch (error) {
              reject(error as Error);
            }
          }, ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Şantiye listesi için tahminler — paralel çalışır; tek şantiyenin hatası tüm
   * kokpiti düşürmez (`status: 'unavailable'` ile o satır boş kalır).
   */
  async forecastForSites(
    sites: Array<{ id: string; name: string; province: string; district?: string | null }>,
    options: { budgetMs?: number } = {},
  ): Promise<SiteWeather[]> {
    const deadline = this.now() + (options.budgetMs ?? SITES_BUDGET_MS);
    return Promise.all(
      sites.map(async (site) => {
        const base = {
          siteId: site.id,
          siteName: site.name,
          province: site.province,
          district: site.district ?? null,
        };
        const budgetLeft = Math.max(500, deadline - this.now());
        try {
          const result = await this.withDeadline(
            this.forecast(site.province, site.district),
            budgetLeft,
            () => {
              throw new Error('MGM yanıtı zaman aşımına uğradı');
            },
          );
          return { ...base, ...result };
        } catch (error) {
          return {
            ...base,
            status: 'unavailable' as const,
            message: `MGM verisi alınamadı: ${error instanceof Error ? error.message : String(error)}`,
            station: null,
            updatedAt: null,
            temp: null,
            feelsLike: null,
            humidity: null,
            condition: '',
            conditionLabel: '',
            windKph: null,
            windGustKph: null,
            windDirDeg: null,
            windDirShort: '',
            windDirLong: '',
            windRisk: 'ok' as const,
            daily: [],
          };
        }
      }),
    );
  }
}

