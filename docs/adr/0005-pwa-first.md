# ADR-0005: Mobil — PWA-first, Flutter Koşullu

**Tarih:** 5 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §6 · SPEC §25 · ROADMAP Faz 2/Faz 9

## Bağlam
Native mobil (Flutter) ilk sürümde kaynak dağılımını büyütür; oysa KOBİ kullanıcıları
için mobil erişim şarttır.

## Karar
- **PWA-first**: Faz 2'den itibaren responsive + PWA (manifest, service worker).
- **Flutter Faz 9'da, koşullu** (§6 tetikleyicileri: mobil trafik eşiği, offline ihtiyacı).
- `apps/mobile/` klasörü **yoktur**; Faz 9'da açılır.
- Çevrimdışı finansal belge yalnızca **taslak** olarak tutulur; kesinleştirme çevrimiçi
  yapılır (SPEC §25). SPEC §25.1'deki Keystore/Keychain detayları Faz 9'a ertelidir.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Flutter ile başlama | Çift kod tabanı maliyeti; Faz 0-8 kaynağını böler |
| Sadece responsive (PWA yok) | Yüklenebilirlik ve temel offline kaybı |

## Sonuçlar
- ➕ Tek kod tabanı, erken mobil erişim, bakım maliyeti düşük
- ➖ Push/offline derinliği sınırlı (tetiklenirse Faz 9)

## Kapanış Kriteri
Faz 2'de `apps/web` manifest + service worker ile yüklenebilir; "çevrimdışı kesinleştirme yok" testi yeşil.
