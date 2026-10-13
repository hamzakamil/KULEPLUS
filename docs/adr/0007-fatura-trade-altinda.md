# ADR-0007: Fatura `trade.invoice.*` Altında; `accounting.invoice.*` İptal

**Tarih:** 5 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §2 · SPEC §2 (kaldırılan önekler) · ADR-0006

## Bağlam
Fatura hem `trade` hem `accounting` altında düşünülüyordu. Muhasebe modülü yalnızca
yevmiye/kebir/dönem işlemlerinden sorumludur; ticari belgeler (teklif, sipariş, irsaliye,
fatura) ticaret akışına aittir.

## Karar
- Fatura ve ticari belgeler **`trade`** modülündedir: `trade.invoice.*`.
- `accounting.invoice.*` **kalıcı olarak iptal**; yeni kullanımları governance-check reddeder.
- Fatura → muhasebe fişi üretimi (Faz 5) domain event/port üzerinden yapılır; muhasebe
  modülü fatura tablosuna doğrudan sorgu atmaz (SPEC §2 port kuralı).

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Fatura accounting'de | Ticari belge akışı (teklif→sipariş→irsaliye→fatura) bölünür |
| Çift kayıt (her ikisinde) | Tek kaynak ilkesi ihlal edilir |

## Sonuçlar
- ➕ Domain ayrımı net; rapor query servisleri istisnası korunur (SPEC §2)
- ➖ Faz 3→5 köprüsü için event sözleşmesi gerekir (Faz 5'te tanımlanır)

## Kapanış Kriteri
GOVERNANCE §2 `trade` satırı fatura tablolarını içerir; yasak önek taraması temiz.

## Uygulama Notu (8 Ekim 2026)
Faz 2/3 kodunda fatura **yanlışlıkla** ayrı `modules/invoice/` klasörü + `requireEntitlement('invoices')`
ile gelmişti; `'invoices'` diye bir modül kodu olmadığı için uçlar her koşulda 403 verirdi.
Bu karar (ADR-0006/0007) koda uygulandı:
- Klasör `modules/trade/invoice/` altına taşındı (klasör = modül kodu).
- `requireEntitlement('trade')` kullanılır.
- GOVERNANCE §2 `trade` satırına `tax_rates`, `invoice_sequences`, `invoice_payments` eklendi;
  var olmayan `invoice_line_taxes` kaldırıldı.

