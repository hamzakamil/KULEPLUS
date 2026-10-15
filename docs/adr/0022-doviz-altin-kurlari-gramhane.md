# ADR-0022: Döviz + altın kurları — Gramhane API canlı, TCMB yedek

**Tarih:** 15 Ekim 2026
**Durum:** Kabul
**İlgili:** ADR-0021 (kokpit kart deseni) · GOVERNANCE §2 (management modülü) · SPEC §9.1/§9.2 (kur) · ROADMAP Faz 6.2 + Faz 7

## Bağlam

Kokpitin başlık şeridindeki "Döviz kuru" alanı yalnızca tenant'ın **elle içe aktardığı**
TCMB satırlarını (`exchange_rates`) okuyordu. İki sorun:

1. İçe aktarım yapılmamış bir şirkette kart hiç dolmuyor, "Örnek veri" etiketi kalıyordu.
2. Altın (gram/ons) ve gümüş hiçbir yerde yoktu; yönetim ekranında altın pozisyonu
   takip edilemiyordu. TCMB'nin günlük kur bülteni (`kurlar/today.xml`) **altın yayınlamaz**
   (canlı kontrol edildi: USD/EUR/GBP/CHF… var, `XAU`/ALTIN yok).

## Karar

1. **Canlı kaynak: Gramhane API** — `GET https://api.gramhane.com/v1/prices.json`
   (ücretsiz, API key yok, IP başına 60 istek/dk). Tek yanıtta 7 kalem gelir:
   `USD, EUR, GBP, CHF, ALTIN (gram), ONS (ons altın, USD), GUMUS (gram gümüş)`.
   **`User-Agent` başlığı zorunludur**; başlıksız istek reddedilir.
2. **Yedek kaynak: `exchange_rates` (TCMB)** — Gramhane'ye ulaşılamazsa tenant'ın son
   içe aktardığı resmî kurlar çizilir. Altın/gümüş TCMB'de olmadığı için yedekte yalnızca
   döviz vardır; arayüz bunu tooltip'te söyler.
3. **Muhasebe kuralları değişmez**: fatura kuru, kur farkı ve dönem sonu değerlemesi
   ADR/§9.2 uyarınca `exchange_rates` (kaynak `TCMB`) üzerinden yürümeye devam eder.
   Gramhane fiyatları **yalnızca gösterimdir** ve `exchange_rates`'e yazılmaz.
4. **`modules/management/rates.service.ts`**: `RATE_WATCHLIST` (kod/etiket/tür/para birimi),
   `mapGramhaneRates()` (saf dönüştürme), `fallbackFromExchangeRates()`, `RatesService`
   (5 dk önbellek + eşzamanlı istek tekilleştirme + 5 sn zaman aşımı) ve
   `ratesForCockpit(fallback)` birleşik sonucu döner.
5. **Kokpit sözleşmesi**: `GET /api/v1/management/cockpit` yanıtına `rates` +
   `ratesMeta {source, asOf, error}` eklendi; `doviz-kuru` bölümü `rates` doluysa
   `sections.live`'a geçer. `fx` alanı (resmî TCMB kaydı) gerisinin uyumluluğu için durur.
6. **Vekil uç**: `GET /api/v1/management/rates` (`management.dashboard.read`) — kartı
   bağımsız yenilemek için; tarayıcı Gramhane'yi doğrudan çağırmaz (kota tek noktada,
   önbellek sunucuda).

## Alternatifler ve neden seçilmedi

- **Yalnızca TCMB**: altın/gümüş yok, ayrıca kur ancak elle içe aktarıldığında ekrana
  geliyor; yöneticinin sabah baktığı şerit boş kalıyordu.
- **EVDS (TCMB) API anahtarı ile altın serisi**: anahtar/abonelik gerektirir, seriler
  günlük ve gecikmeli; kokpit "şu anki fiyat" bekler.
- **`doviz.com`/diğer site ekranı kazıma (scraping)**: HTML yapısı değişince kırılır,
  kullanım koşulları belirsiz; Gramhane'nin resmi JSON ucu buna göre daha dayanıklı.
- **Kurları `exchange_rates`'e `source='provider'` olarak yazmak**: çift kaynak muhasebe
  mutabakatını bozar (hangi kur resmî?), tek doğruluk kaynağını bulanıklaştırır.

## Çıkarılanlar

- Gramhane yalnızca 7 kalem veriyor; kripto/banka bazlı fiyatlamalar kapsam dışı.
- Kur geçmişi/grafik tutulmaz (canlı gösterim + TCMB arşivi yeterlidir).
- `RATE_WATCHLIST` genişletilirken `unit` alanına dikkat: ons altın **USD**, diğerleri TRY.

## Kapanış Kriteri

- `npm run typecheck` (api + web) temiz, `apps/api/tests/rates.test.ts` yeşil
  (16 test: eşleştirme, önbellek/TTL, hata ve yedek yolları),
- `scripts/governance-check.mjs` temiz (yeni tablo/izin yok — mevcut
  `management.dashboard.read` kullanılır),
- Playwright: canlı modda şerit "Kaynak: Gramhane" + Dolar/Euro + Gram altın/Ons altın gösterir.
