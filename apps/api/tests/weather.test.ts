import { describe, expect, it } from 'vitest';
import {
  WeatherService,
  hadiseLabel,
  matchCenter,
  normalizeTr,
  windDirectionShort,
  windRiskLevel,
  type MgmCenter,
  type MgmFetchLike,
} from '../src/modules/management/weather.service';

/**
 * MGM hava durumu istemcisi — ROADMAP Faz 7.6.
 *
 * Ağ çağrısı yapılmaz: `fetchImpl` enjekte edilir ve MGM'nin gerçek yanıt
 * biçimleri (canlı servisten alınan örnekler) taklit edilir.
 */

const istanbulCenter: MgmCenter = {
  il: 'İstanbul',
  ilce: 'Bakırköy',
  merkezId: 93401,
  gunlukTahminIstNo: 93401,
  saatlikTahminIstNo: 17060,
  sondurumIstNo: 17060,
  enlem: 40.98,
  boylam: 28.82,
  oncelik: 1,
};
const basaksehirCenter: MgmCenter = {
  il: 'İstanbul',
  ilce: 'Başakşehir',
  merkezId: 93433,
  gunlukTahminIstNo: 93433,
  saatlikTahminIstNo: 17060,
  sondurumIstNo: 18402,
  enlem: 41.1,
  boylam: 28.8,
  oncelik: 1,
};

const NOW = Date.parse('2026-10-15T06:30:00Z');

const dailyResponse = [
  {
    enDusukGun1: 14,
    enYuksekGun1: 17,
    hadiseGun1: 'KGY',
    ruzgarHizGun1: 36,
    ruzgarYonGun1: 355,
    enDusukNemGun1: 68,
    tarihGun1: '2026-10-15T00:00:00Z',
    enDusukGun2: 13,
    enYuksekGun2: 15,
    hadiseGun2: 'GSY',
    ruzgarHizGun2: 19,
    ruzgarYonGun2: 357,
    tarihGun2: '2026-10-16T00:00:00Z',
    enDusukGun3: 11,
    enYuksekGun3: 16,
    hadiseGun3: 'PB',
    ruzgarHizGun3: 24,
    ruzgarYonGun3: 16,
    tarihGun3: '2026-10-17T00:00:00Z',
    istNo: 93401,
  },
];

const hourlyResponse = [
  {
    baslangicZamani: '2026-10-15T03:00:00Z',
    istNo: 17060,
    merkez: 'ISTANBUL',
    tahmin: [
      {
        tarih: '2026-10-15T03:00:00Z',
        hadise: 'KGY',
        sicaklik: 14,
        hissedilenSicaklik: 13,
        nem: 91,
        ruzgarYonu: 355,
        ruzgarHizi: 36,
        maksimumRuzgarHizi: 66,
      },
      {
        tarih: '2026-10-15T06:00:00Z',
        hadise: 'GSY',
        sicaklik: 15,
        hissedilenSicaklik: 15,
        nem: 85,
        ruzgarYonu: 356,
        ruzgarHizi: 34,
        maksimumRuzgarHizi: 67,
      },
      {
        tarih: '2026-10-15T09:00:00Z',
        hadise: 'PB',
        sicaklik: 16,
        hissedilenSicaklik: 16,
        nem: 79,
        ruzgarYonu: 0,
        ruzgarHizi: 20,
        maksimumRuzgarHizi: 55,
      },
    ],
  },
];

/** MGM uçlarını taklit eden fetch: `sorgu` araması, günlük ve saatlik tahmin. */
function makeFetch(overrides: { failAll?: boolean; centers?: MgmCenter[] } = {}) {
  const calls: string[] = [];
  const fetchImpl: MgmFetchLike = async (url) => {
    calls.push(url);
    if (overrides.failAll) {
      return { ok: false, status: 500, json: async () => ({ error: 'ServerError' }) };
    }
    const centers = overrides.centers ?? [istanbulCenter, basaksehirCenter];
    const respond = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (url.includes('/merkezler/iller')) return respond(centers);
    if (url.includes('/merkezler?sorgu=')) {
      const query = normalizeTr(decodeURIComponent(url.split('sorgu=')[1] ?? ''));
      const matched = centers.filter(
        (center) =>
          normalizeTr(center.il).includes(query) || normalizeTr(center.ilce).includes(query),
      );
      return respond(matched);
    }
    if (url.includes('/tahminler/gunluk')) return respond(dailyResponse);
    if (url.includes('/tahminler/saatlik')) return respond(hourlyResponse);
    return respond([]);
  };
  return { fetchImpl, calls };
}

describe('WeatherService (MGM)', () => {
  describe('saf yardımcılar', () => {
    it('hadise kodu MGM sözlüğüne göre çevrilir (GSY gök gürültülü, güneşli DEĞİL)', () => {
      expect(hadiseLabel('KGY')).toBe('Kuvvetli Gökgürültülü Sağanak Yağışlı');
      expect(hadiseLabel('GSY')).toBe('Gökgürültülü Sağanak Yağışlı');
      expect(hadiseLabel('kky')).toBe('Karla Karışık Yağmurlu');
      expect(hadiseLabel('YOK')).toBe('');
    });

    it('rüzgâr yönü derece → kısa yön', () => {
      expect(windDirectionShort(355)).toBe('K');
      expect(windDirectionShort(45)).toBe('KD');
      expect(windDirectionShort(200)).toBe('G');
      expect(windDirectionShort(300)).toBe('KB');
      expect(windDirectionShort(undefined)).toBe('');
    });

    it('vinç rüzgâr eşikleri: 30 km/s sınır, 40 km/s durdur', () => {
      expect(windRiskLevel(29)).toBe('ok');
      expect(windRiskLevel(30)).toBe('limit');
      expect(windRiskLevel(39)).toBe('limit');
      expect(windRiskLevel(40)).toBe('stop');
      expect(windRiskLevel(null)).toBe('ok');
    });

    it('Türkçe duyarsız normalizasyon', () => {
      expect(normalizeTr('İSTANBUL')).toBe('istanbul');
      expect(normalizeTr('Keçiören')).toBe('kecioren');
      expect(normalizeTr(' Kartalkaya  Kayak ')).toBe('kartalkaya kayak');
    });

    it('matchCenter: önce ilçe tam eşleşmesi, yoksa il merkezi', () => {
      const centers: MgmCenter[] = [istanbulCenter, basaksehirCenter];
      expect(matchCenter(centers, 'istanbul', 'basaksehir')?.merkezId).toBe(93433);
      expect(matchCenter(centers, 'İSTANBUL', 'Kartal')?.merkezId).toBe(93401);
      expect(matchCenter(centers, 'İzmir')).toBeNull();
    });
  });

  describe('forecast', () => {
    it('il/ilçe → istasyon, saatlik veriyi ve 3 günlük tahmini döner', async () => {
      const { fetchImpl, calls } = makeFetch();
      const service = new WeatherService({ fetchImpl, now: () => NOW });

      const result = await service.forecast('İstanbul', 'Başakşehir');

      expect(result.status).toBe('ok');
      expect(result.station).toEqual({ il: 'İstanbul', ilce: 'Başakşehir', merkezId: 93433 });
      // 06:30'da 30 dk toleransla 06:00 tahmini seçilir.
      expect(result.temp).toBe(15);
      expect(result.humidity).toBe(85);
      expect(result.windKph).toBe(34);
      expect(result.windGustKph).toBe(67);
      expect(result.windDirShort).toBe('K');
      expect(result.windDirLong).toBe('Kuzeyden');
      expect(result.windRisk).toBe('limit');
      expect(result.condition).toBe('GSY');
      expect(result.conditionLabel).toBe('Gökgürültülü Sağanak Yağışlı');
      expect(result.updatedAt).toBe('2026-10-15T03:00:00Z');
      expect(result.daily.map((day) => day.label)).toEqual(['Bugün', 'Yarın', 'Cmt']);
      expect(result.daily[0]).toMatchObject({ min: 14, max: 17, condition: 'KGY', windKph: 36 });
      // MGM yalnızca doğru istasyon numaralarıyla veri verir.
      expect(calls.some((url) => url.includes('tahminler/saatlik?istno=17060'))).toBe(true);
      expect(calls.some((url) => url.includes('tahminler/gunluk?merkezid=93433'))).toBe(true);
    });

    it('MGM isteği Referer + Origin başlıklarıyla gider', async () => {
      const seen: Record<string, string>[] = [];
      const fetchImpl: MgmFetchLike = async (url, init) => {
        seen.push(init?.headers ?? {});
        const data = url.includes('tahminler')
          ? url.includes('saatlik')
            ? hourlyResponse
            : dailyResponse
          : [basaksehirCenter];
        return { ok: true, status: 200, json: async () => data };
      };
      const service = new WeatherService({ fetchImpl, now: () => NOW });

      await service.forecast('İstanbul', 'Başakşehir');

      expect(seen.length).toBeGreaterThan(0);
      for (const headers of seen) {
        expect(headers.Referer).toContain('mgm.gov.tr');
        expect(headers.Origin).toBe('https://www.mgm.gov.tr');
      }
    });

    it('ilçe MGM’de yoksa il merkezine düşer', async () => {
      const { fetchImpl } = makeFetch({ centers: [istanbulCenter] });
      const service = new WeatherService({ fetchImpl, now: () => NOW });

      const result = await service.forecast('İstanbul', 'Olmayan İlçe');

      expect(result.status).toBe('ok');
      expect(result.station?.ilce).toBe('Bakırköy');
    });

    it('il MGM’de yoksa `unresolved` döner ve tahmin çekilmez', async () => {
      const { fetchImpl, calls } = makeFetch();
      const service = new WeatherService({ fetchImpl, now: () => NOW });

      const result = await service.forecast('Atlantis');

      expect(result.status).toBe('unresolved');
      expect(result.temp).toBeNull();
      expect(calls.some((url) => url.includes('tahminler/'))).toBe(false);
    });

    it('aynı istasyon için ikinci çağrı MGM’ye tekrar gitmez (önbellek)', async () => {
      const { fetchImpl, calls } = makeFetch();
      const service = new WeatherService({ fetchImpl, now: () => NOW });

      await service.forecast('İstanbul', 'Başakşehir');
      const afterFirst = calls.length;
      await service.forecast('İstanbul', 'Başakşehir');

      expect(calls.length).toBe(afterFirst);
    });
  });

  describe('forecastForSites', () => {
    it('MGM erişilemezse satır `unavailable` olur, hata tüm listeyi düşürmez', async () => {
      const { fetchImpl } = makeFetch({ failAll: true });
      const service = new WeatherService({ fetchImpl, now: () => NOW });

      const rows = await service.forecastForSites([
        { id: 'a', name: 'Vadi Rezidans', province: 'İstanbul', district: 'Başakşehir' },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        siteId: 'a',
        siteName: 'Vadi Rezidans',
        status: 'unavailable',
        windRisk: 'ok',
        daily: [],
      });
      expect(rows[0]?.message).toContain('MGM');
    });

    it('farklı şehirler farklı istasyondan farklı rüzgâr üretir', async () => {
      const ankaraHourly = [
        {
          baslangicZamani: '2026-10-15T03:00:00Z',
          tahmin: [
            {
              tarih: '2026-10-15T06:00:00Z',
              hadise: 'GSY',
              sicaklik: 11,
              nem: 96,
              ruzgarYonu: 40,
              ruzgarHizi: 3,
            },
          ],
        },
      ];
      const fetchImpl: MgmFetchLike = async (url) => {
        const respond = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
        if (url.includes('/merkezler?')) {
          return respond(
            url.includes('Ankara')
              ? [
                  {
                    ...istanbulCenter,
                    il: 'Ankara',
                    ilce: 'Çankaya',
                    merkezId: 90614,
                    gunlukTahminIstNo: 90614,
                    saatlikTahminIstNo: 17130,
                  },
                ]
              : [istanbulCenter, basaksehirCenter],
          );
        }
        if (url.includes('gunluk')) return respond(dailyResponse);
        if (url.includes('saatlik?istno=17130')) return respond(ankaraHourly);
        return respond(hourlyResponse);
      };
      const service = new WeatherService({ fetchImpl, now: () => NOW });

      const rows = await service.forecastForSites([
        { id: 'a', name: 'İstanbul Şantiye', province: 'İstanbul', district: 'Başakşehir' },
        { id: 'b', name: 'Ankara Şantiye', province: 'Ankara', district: 'Çankaya' },
      ]);

      expect(rows[0]?.windKph).toBe(34);
      expect(rows[0]?.windRisk).toBe('limit');
      expect(rows[1]?.windKph).toBe(3);
      expect(rows[1]?.windRisk).toBe('ok');
      expect(rows[1]?.station?.merkezId).toBe(90614);
    });
  });
});
