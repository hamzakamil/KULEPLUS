# Açılış Bakiyesi İçe Aktarma Şablonu

**Durum:** İskelet — Faz 2'de doldurulacak

## Kolonlar
| Kolon | Tip | Zorunlu | Örnek |
|-------|-----|---------|-------|
| contact_tax_number | VKN/TCKN | ✅ | 1234567890 |
| balance_type | debit (borç) / credit (alacak) | ✅ | debit |
| amount | decimal | ✅ | 1500.00 |
| currency | TRY | ✅ | TRY |
| date | GG.AA.YYYY | ✅ | 01.01.2026 |
| description | metin | — | Açılış |

## Kurallar
- Cari kart önce var olmalı (veya aynı dosyada önce oluşturulmalı).
- Açılış bakiyesi kesinleşmiş hareket olarak işlenir; ters kayıtla düzeltilir.