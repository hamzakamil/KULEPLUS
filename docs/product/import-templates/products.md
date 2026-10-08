# Ürün İçe Aktarma Şablonu

**Durum:** İskelet — Faz 2'de doldurulacak

## Kolonlar
| Kolon | Tip | Zorunlu | Örnek |
|-------|-----|---------|-------|
| name | metin | ✅ | Vida M4 |
| sku | metin | — | VIDA-M4 |
| barcode | metin | — | 8691234567890 |
| unit | metin | ✅ | ADET |
| category | metin | — | Hırdavat |
| vat_rate | sayı | — | 20 |
| sale_price | sayı (decimal) | — | 12.50 |
| purchase_price | sayı (decimal) | — | 8.00 |
| initial_stock | sayı | — | 100 |

## Kurallar
- FLOAT/DOUBLE yasak; metin olarak decimal string kabul edilir.
- `unit` katalogda yoksa otomatik oluşturulur + uyarı verilir.