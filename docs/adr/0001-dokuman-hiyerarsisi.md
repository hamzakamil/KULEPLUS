# ADR-0001: Doküman Hiyerarşisi ve Çelişki Çözümü

**Tarih:** 5 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §1, §7 · README v4.1.0 · SPEC · ROADMAP v5.1.0

## Bağlam
README, TECHNICAL_SPEC, ROADMAP ve ADR'ler aynı konuları farklı açılardan anlatır.
Çelişki çıktığında hangi dokümanın esas alınacağı belirsizdi; ajanlar ve geliştiriciler
için uygulanabilir bir prosedür gerekiyordu.

## Karar
- **Konu bazlı yetki hiyerarşisi** uygulanır: ürün önceliği/faz sırası/çıkış kapıları → **ROADMAP**;
  kullanıcıya sunum/modül kodları/paket/kurulum → **README**;
  domain sınırı/veri modeli/permission/RLS/güvenlik/finansal standart → **TECHNICAL_SPEC**;
  yeni karar → **ADR**.
- "TECHNICAL_SPEC esas alınır" ifadesi **yalnızca teknik kural** içindir; ürün sırası için ROADMAP esastır.
- GOVERNANCE §7 prosedürü: çelişki → `docs/adr/NNNN-<slug>.md` → aynı PR'da tüm dokümanların
  güncellenmesi → ADR'de test edilebilir kapanış kriteri → review'da §1 kontrolü.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Tek dokümanda birleştirme | Okunabilirlik ve sahiplik kaybolur; inceleme imkânsızlaşır |
| "Her zaman SPEC esas" | Ürün önceliği teknik kural değildir; faz sırası SPEC'in konusu değil |

## Sonuçlar
- ➕ Çelişki çözüm prosedürü otomatikleştirilebilir (CI doküman senkron kontrolü)
- ➖ Her karar değişikliği birden fazla dokümanın aynı PR'da güncellenmesini gerektirir

## Kapanış Kriteri
`scripts/governance-check.mjs` GOVERNANCE §2 ve SPEC §6.1 kurallarını CI'da zorlar.
