# ADR-0008: Gider Modeli — Ayrı `expenses` Tablosu

**Tarih:** 5 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §2 (`trade` satırı) · SPEC §8 (`trade.expenses`)

## Bağlam
Giderler fatura modelinin içine gömülebilirdi (negatif fatura) ya da ayrı bir entity
olabilirdi. Negatif fatura; KDV, tevkifat ve onay akışlarını bozar.

## Karar
- Giderler ayrı tablodadır: **`trade.expenses`** (+ `expense_categories`).
- Gider; satıcı cari bağlantısı, KDV ayrıntısı ve onaylanabilirlik taşır; fatura satırıyla
  karıştırılmaz.
- Yardım merkezi 10. makale ("Gider nasıl girilir?") bu modeli anlatır.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Negatif fatura | KDV/tevkifat/onay semantiği bozulur; düzeltme izi kirlenir |
| Müşterek "belge" tablosu | Faz 3 kapsamını şişirir; tip ayrımı her sorguda maliyet |

## Sonuçlar
- ➕ Temiz düzeltme izi, net KDV hesabı
- ➖ Fatura ↔ gider ilişki kuralları Faz 3'te tanımlanmalı

## Kapanış Kriteri
Faz 3'te `trade.expenses` migration'ı GOVERNANCE §2 `trade` satırına uygun (governance-check yeşil).
