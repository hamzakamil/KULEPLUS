# ROADMAP v4.1.0 Çelişki Çözüm Logu

**Arşiv tarihi:** 5 Ekim 2026
**Kaynak:** ROADMAP v4.1.0 düzeltme notu (kullanıcı tarafından sağlandı)
**Durum:** v5.1.0'a işlendi

## Çelişki → Çözüm Tablosu

| # | Çelişki | Çözüm |
|---|---------|-------|
| §1 | SPEC §33 vs ROADMAP | SPEC §33 silindi; hiyerarşi GOVERNANCE §1'e bağlandı |
| §2 | Modül taksonomisi | GOVERNANCE §2 tek tablo; SPEC §2 buraya referans |
| §3 | Platform yöneticisi | ADR-0003: platform_owner + roller + support_access_grants |
| §4 | Rol listeleri | SPEC §6.6 güncellendi; IK/URETIM çıkarıldı |
| §5 | Onboarding | ADR-0004: varsayılan manual; onboarding_mode eklendi |
| §6 | Mobil | ADR-0005: PWA-first; Flutter Faz 9 |
| §7 | Çoklu para birimi | ROADMAP T-3.1 + iş listesi senkronize; Faz 6 |
| §8 | RPO/RTO | SPEC §30.3: 1 saat / 4 saat |
| §9 | UUID | ADR-0002: UUID v7; SPEC §0.1 |
| §10 | Tablo adları | GOVERNANCE §2; plan_features + plan_limits ayrı |
| §11 | e-Belge | SPEC §21: entegratör; UBL-TR cümlesi kaldırıldı |
| §12 | Repo yapısı | SPEC §1.2 tek kaynak; apps/site var, apps/mobile yok |

## v5.1.0'da Ek Yapılanlar
- GOVERNANCE.md (v1.0.0 → v1.1.0)
- outbox_events.tenant_id
- stock_cost_entries kilit mekanizması
- exchange_rates tablosu
- Hata kodu kataloğu yeri
- İşletim bölümü (SPEC §30.7)
- Tenant kapanış durum makinesi (SPEC §27.5)
- legal_texts/acceptances core modülüne taşındı (ADR-0011)
- apps/site = Astro (ADR-0012)
- OpenAPI Zod'dan üretim (ADR-0013)