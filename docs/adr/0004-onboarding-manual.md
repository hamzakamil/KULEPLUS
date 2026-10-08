# ADR-0004: Onboarding — Varsayılan `manual`

**Tarih:** 5 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §5 · SPEC §4.3 · ROADMAP Faz 1 (T-1.1)

## Bağlam
Şirket açılışında üç mod vardı: `auto` (anında aktif), `manual` (platform incelemeli),
`hybrid` (risk skoruna göre). Beta öncesi sahte/yanlış şirket kayıtları riski vardı.

## Karar
- `tenant_settings.onboarding_mode` enum: `auto | manual | hybrid`; **varsayılan: `manual`**.
- Onay, tek kilitli transaction içinde yürütülür (başvuru → tenant → OWNER → roller →
  ücretsiz haklar → modüller + audit + outbox). Başvuru ↔ tenant ilişkisi benzersizdir.
- Beta sonrası veriye göre `hybrid`'e geçiş **ayrı bir ADR** ile değerlendirilir (T-1.1).

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| `auto` ile başlama | Sahte/hatalı şirket riski; inceleme maliyeti sonradan daha yüksek |
| `hybrid` ile başlama | Risk skoru modeli için beta verisi yok |

## Sonuçlar
- ➕ Kontrollü büyüme, inceleme ekranı zorunluluğu net (platform paneli v0)
- ➖ Başvuru → aktivasyon arası bekleme süresi (iletişim şablonuyla yönetilir)

## Kapanış Kriteri
"Şirket başvurusu onaylanmadan tenant oluşmaz; aynı başvurunun çift onayı tek tenant üretir" testi yeşil.
