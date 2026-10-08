# ADR-0014: Pagination Kuralı — Cursor vs Offset

**Tarih:** 6 Ekim 2026
**Durum:** Kabul
**İlgili:** SPEC §22.2 · ROADMAP Faz 1

## Bağlam
Hareket tabloları (fatura, stok hareketi, muhasebe fişi) milyonlarca satıra ulaşabilir.
Offset tabanlı sayfalama (`LIMIT 50 OFFSET 1000000`) performans sorunu yaratır.

## Karar
- **Hareket tabloları** (append-only, sıralı): **Cursor-based pagination** (keyset pagination)
  - İstemci son gördüğü kaydın `id` (veya `created_at` + `id` composite) değerini gönderir
  - Sorgu: `WHERE id > $cursor ORDER BY id LIMIT $pageSize`
  - Index-friendly, consistent performance
- **Kart/listeler** (cari, ürün, kullanıcı): **Offset pagination** kabul edilebilir
  - Veri kümesi küçük (< 10k), arama/filtreleme ile birlikte kullanılır
  - `LIMIT $pageSize OFFSET $offset`

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Her yerde offset | Hareket tablolarında yüksek offset'te sequentional scan |
| Her yerde cursor | Kart listelerinde kullanıcı deneyimi (sayfa numarası) zayıflar |

## Sonuçlar
- ➕ Hareket tablolarında O(1) sayfalama
- ➖ İstemci tarafında cursor state yönetimi gerekir

## Kapanış Kriteri
- `GET /api/v1/contacts?limit=50&offset=0` (offset)
- `GET /api/v1/stock/movements?limit=50&cursor=<uuid>` (cursor) — her ikisi test ediliyor