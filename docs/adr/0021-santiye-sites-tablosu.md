# ADR-0021: Şantiye (saha) kayıtları — `sites` tablosu ve MGM hava durumu

**Tarih:** 15 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §2 (management modülü) · SPEC §7 (RLS) · ROADMAP Faz 7 (Yönetim Paketi)

## Bağlam
Yönetici kokpitindeki "Şantiye" ve "Hava durumu" kartları örnek veriydi. İstenen davranış:
havanın **Meteoroloji Genel Müdürlüğü (MGM)** verisinden ve **şantiyenin bulunduğu ile göre**
gelmesi. Ancak ürün veri modelinde şantiye/konum kaydı yoktu:

- `project_tags` (proje etiketi) belge boyutudur; konum alanı taşımaz,
- `contact_addresses.province/district` cari adresidir (müşteri/tedarikçi), şantiye değildir,
- `tenants` kimlik/vergi alanları taşır, adres taşımaz.

## Karar
1. **`sites` tablosu** (management modülü): `code`, `name`, `province` (zorunlu), `district`,
   `address`, `contact_id` (işveren), `status` (`active|paused|completed|archived`),
   `sort_order`, `notes` + RLS politikası (`app.current_tenant_id()`).
2. **İzinler**: `management.site.read|create|update|delete` — kaynak
   `packages/shared/src/permissions.ts`; `management` modülü + entitlement kapısı kullanılır
   (yeni modül kodu açılmaz → GOVERNANCE §2 kuralı korunur).
3. **MGM istemcisi** (`modules/management/weather.service.ts`) MGM'nin kendi web istemcisinin
   kullandığı herkese açık uçları kullanır:
   - `GET /web/merkezler?sorgu=<il|ilçe>` → istasyon çözümleme (`merkezId`, `saatlikTahminIstNo`),
   - `GET /web/tahminler/gunluk?merkezid=` → 5 günlük (3 günü gösterilir),
   - `GET /web/tahminler/saatlik?istno=` → saatlik sıcaklık/nem/rüzgâr.
4. **Vekil (proxy) uçları**: tarayıcı MGM'yi doğrudan çağıramaz (CORS yok; istek `Referer` +
   `Origin` başlıkları gerektirir) → il/ilçe listeleri `GET /api/v1/management/weather/{provinces,districts}`
   üzerinden gelir.
5. **Kokpit sözleşmesi**: `GET /api/v1/management/cockpit` yanıtına `sites` ve `weather`
   dizileri eklenir; `sections.live`/`demo` etiketleri `santiye` ve `hava-durumu` için dinamik olur.
6. **Dayanıklılık**: MGM erişilemezse şantiye satırı `status: 'unavailable'`, il bulunamazsa
   `'unresolved'` döner; kokpit örnek veriye düşer ve bunu ekranda söyler (boş ekran yok).
   İstasyon araması 24 saat, tahmin 15 dakika önbelleklenir; toplam tahmin bütçesi 7 sn'dir.

## Alternatifler ve neden seçilmedi
- **`tenant_settings` içinde JSON şantiye listesi**: konum bilgisi sorgulanabilir/raporlanabilir
  olmaz, il/ilçe doğrulaması ve tenant izolasyonu zayıflardı.
- **Cari adresinden (`contact_addresses`) türetmek**: müşteri adresi ile saha konumu aynı şey
  değil; yanlış il/ilçe → yanlış vinç kararı üretir.
- **Doğrudan tarayıcıdan MGM**: CORS + başlık zorunluluğu nedeniyle çalışmaz; ayrıca önbellek
  ve tek noktadan hata yönetimi kaybolur.

## Çıkarılanlar
- Kamera yayını (HLS/WebRTC) entegrasyonu **kapsam dışı**; kokpitteki kamera kartı örnek veri
  kalmaya devam eder ve etiketinde bunu söyler.
- Şantiye ilerleme/personel/bütçe alanları eklenmez (kaynağı olan üretim modülü yok).

## Kapanış Kriteri
- `npm run typecheck` (api + web) temiz, `apps/api/tests/{sites,weather}.test.ts` yeşil,
  `scripts/governance-check.mjs` temiz (GOVERNANCE §2 + permission formatı),
  Playwright: şantiye kaydı kokpitte canlı şantiye + MGM hava satırı üretir.
