# Açılış Stoğu İçe Aktarma Şablonu

**Durum:** İskelet — Faz 2'de doldurulacak

## Kolonlar
| Kolon | Tip | Zorunlu | Örnek |
|-------|-----|---------|-------|
| sku | metin | ✅ | VIDA-M4 |
| warehouse | metin | ✅ | Merkez |
| quantity | decimal | ✅ | 100 |
| unit_cost | decimal | — | 8.00 |
| date | GG.AA.YYYY | ✅ | 01.01.2026 |

## Kurallar
- Ürün + depo önce var olmalı.
- Açılış stoğu `stock_movements`'a `opening` tipiyle yazılır; maliyet hareketli ortalamaya dahil edilir.