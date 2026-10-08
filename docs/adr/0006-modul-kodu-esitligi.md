# ADR-0006: Modül Kodu = Permission Öneki = Klasör = Entitlement

**Tarih:** 5 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §2 · SPEC §2, §6.5 · ROADMAP T-1.10

## Bağlam
Modül adlandırmaları dokümanlarda dağınık kullanılıyordu (`crm.*`, `purchasing.*`,
`logistics.*`, `accounting.invoice.*` gibi artık önekler vardı). Permission, klasör,
entitlement ve katalog senkronu manueldi.

## Karar
- `permission_prefix` = klasör adı = entitlement kodu = GOVERNANCE §2'deki `module_code`
  (`core`, `platform`, `contacts`, `stock`, `trade`, `cashbank`, `einvoice`, `subscription`,
  `accounting`, `cheque`, `reports_plus`, `management`, `sms`, `integrations`).
- Permission formatı: `module.resource.action` (SPEC §6.1).
- Yasak önekler: `crm.*` (→ `contacts.*`), `purchasing.*`, `logistics.*`,
  `accounting.invoice.*` (→ `trade.invoice.*`, ADR-0007).
- Kod tarafında tek kaynak: `packages/shared/permissions.ts`; katalog
  `docs/api/permissions-catalog.md` buradan üretilir, CI'da senkron kontrolü yapılır.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| SPEC içine gömme (katalog) | Üretilebilirlik ve CI kontrolü kaybedilir |
| Serbest adlandırma | Senkron maliyeti; yetki denetiminde tutarsızlık |

## Sonuçlar
- ➕ `scripts/governance-check.mjs` tablo ↔ modül eşleşmesini CI'da zorlar
- ➖ Yeni modül için GOVERNANCE §2 + ADR zorunluluğu (bilinçli bürokrasi)

## Kapanış Kriteri
"Yeni tablo GOVERNANCE §2'de yoksa CI reddeder" — governance-check yeşil.
