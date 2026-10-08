# ADR-0009: Contact Alt Tablolar Tek Doğruluk Kaynağıdır

**Tarih:** 5 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §2 (`contacts` satırı) · SPEC §11 (Contact/Cari)

## Bağlam
Cari kartta adres/telefon/e-posta hem `contacts` üzerinde inline kolon hem de ayrı
tablolarda tutuluyordu; güncelleme çakışması ve tutarsızlık riski vardı.

## Karar
- Tek doğruluk kaynağı alt tablolardır: `contact_addresses`, `contact_phones`,
  `contact_emails`, `contact_roles`, `contact_relations`.
- `contacts` üzerindeki eşdeğer **inline alanlar kaldırıldı**; kart görünümü alt
  tablolardan derlenir.
- `party_accounts` ve `party_ledger_entries` bakiye/borç-alacak kaynağı olmaya devam eder
  (SPEC §11.2: bakiye kesinleşmiş hareketlerden üretilir).

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Inline alanları tutma | Çift yazma, tutarsızlık, denetim maliyeti |
| Yalnızca JSONB | Adres geçmişi/sorgulanabilirlik kaybı |

## Sonuçlar
- ➕ Tek yazma yolu, denetlenebilir değişiklik
- ➖ Kart okuma join maliyeti (read-model/index ile yönetilir)

## Kapanış Kriteri
Faz 2'de cari kart şeması inline adres/telefon/e-posta içermez (governance-check + review).
