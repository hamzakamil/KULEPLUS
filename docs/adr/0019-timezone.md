# ADR-0019: Timezone — `Europe/Istanbul` Varsayılan, Tenant Bazlı

**Tarih:** 6 Ekim 2026
**Durum:** Kabul
**İlgili:** SPEC §4.4 (tenant_settings.timezone) · SPEC §3 (tr-TR locale)

## Bağlam
Türkiye'de tek timezone (`Europe/Istanbul`, DST yok) ama çok kiracılı sistemde tenant bazlı ayar gerekebilir.

## Karar
- **Sistem varsayılanı**: `Europe/Istanbul` (IANA tz veritabanı adı).
- **Tenant ayarı**: `tenant_settings.timezone` (IANA tz adı, örn: `Europe/Istanbul`, `UTC`).
- **Depolama**: Tüm `timestamptz` (UTC) olarak saklanır; gösterimde tenant timezone'ına çevrilir.
- **Girdi**: API `timestamptz` (ISO 8601 + offset) kabul eder; offset yoksa tenant timezone varsayılır.
- **Çıktı**: API `timestamptz` (ISO 8601, UTC/Z) döner; frontend tenant timezone'ında gösterir.
- **Raporlar/Export**: `tenant_settings.timezone` kullanılır (Excel/CSV tarih sütunları).
- **Seed/Default**: `tenant_settings.timezone` default `Europe/Istanbul`.

## Veritabanı
- Tüm zaman damgaları `timestamptz` (UTC saklar).
- `tenant_settings.timezone` text, default `'Europe/Istanbul'`.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| `timestamp` (tz'sız) + uygulama katmanında tz | Yanlış hesaplama riski; `timestamptz` standart |
| Her tenant ayrı DB | İşletim maliyeti; RLS yeterli |

## Sonuçlar
- ➕ Tek kaynak: `timestamptz` + tenant timezone
- ➕ Türkiye DST yok ama gelecekte değişirse IANA tz güncellemesi yeterli
- ➕ Frontend `Intl.DateTimeFormat('tr-TR', { timeZone: tenantTz })` ile gösterir

## Kapanış Kriteri
- `tenant_A` (Istanbul) ve `tenant_B` (UTC) aynı anki log kaydında farklı local zaman gösterir
- Export Excel'de tarihler tenant timezone'ında