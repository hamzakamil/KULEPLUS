# ADR-0003: Platform Yönetimi — platform_owner + Roller + support_access_grants

**Tarih:** 5 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §4 · SPEC §5.1 · ROADMAP Faz 1

## Bağlam
Platform (şirket/abonelik/tahsilat yönetimi) için tek "Super Admin" hesabı hem güvenlik
riski (tek hata noktası) hem de denetim körlüğü yaratır. Çapraz tenant erişiminin kuralı
netleşmemişti.

## Karar
- Tek **`platform_owner`** vardır (`platform_users.is_platform_owner = TRUE` üzerinde
  kısmi unique index). "Super Admin singleton" ilkesi bu karşılığa sahiptir.
- Diğer platform rolleri: `platform_support`, `platform_sales`, `platform_finance`,
  `platform_readonly` (`platform_roles` tablosunda).
- **Çapraz tenant erişimi** yalnızca `support_access_grants` kaydıyla, süreli ve gerekçeli
  yapılır. Grant olmadan hiçbir platform kullanıcısı tenant verisi göremez; her kullanım audit'lidir.
- `platform_settings` singleton **değildir**; ayarlar `platform_settings (key, value)` anahtar-değer tablosundadır.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Tek Super Admin singleton | Ölçeklenmez, tek hata noktası; ayrım yok |
| Serbest çapraz erişim | KVKK ve denetim açısından kabul edilemez |

## Sonuçlar
- ➕ Denetlenebilir destek erişimi, rol ayrımı, kurtarma prosedürü yazılabilirliği
- ➖ Grant yönetimi için platform paneli ekranı gerekir (Faz 1)

## Kapanış Kriteri
"Grant'sız platform kullanıcısı tenant verisi göremez; grant kullanımı audit'te görünür" testi yeşil.
