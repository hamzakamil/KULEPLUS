# ADR-0024: KDV Tevkifat Türleri Tablosu ve Yardımcı (Alt) Hesaplar

**Tarih:** 2026-10-18
**Durum:** Kabul
**İlgili:** GOVERNANCE §2 (`trade`) · SPEC §9.3, §15 · migration 202610540000–202610570000

## Bağlam
Fatura satırında yalnızca tevkifat oranı (`invoice_lines.withholding_rate`) vardı; hesaplamaya,
fatura toplamına ve yevmiye fişine yansımıyordu. KDV-2 beyannamesi KDV-2 kodu bazında
(301, 302 …) matrah/oran/tevkif edilen KDV ister; aynı oranı birçok kod paylaştığından
(ör. 9/10) oran bazlı hesap kırılımı beyannameyi beslemez. Kod ve oranlar mevzuatla değişebilir.
Ayrıca kasa/banka/kredi kartı ve gider kategorileri muhasebede tek ana hesapta toplanıyordu.

## Karar
- `withholding_types` (tenant bazlı, düzenlenebilir): ad, e-Fatura/e-Arşiv kodu (601…),
  KDV-2 kodu (301…), oran (pay/10), geçerlilik aralığı, aktiflik. Varsayılan 25 tür tohumlanır.
- Fatura satırı türe bağlanır; kesinleşmede e-Fatura kodu, KDV-2 kodu ve oran satıra
  kopyalanır (snapshot) — tablo değişse de kesinleşmiş belge değişmez.
- `invoices.total` ödenecek tutardır (matrah + KDV − tevkifat); `tax_total` tam KDV kalır.
- Alışta tevkif edilen KDV `360.01.<KDV-2 kodu>` hesabına (Sorumlu Sıfatıyla Ödenecek KDV),
  satışta 391'e yalnızca tahsil edilen KDV yazılır. KDV-2/KDV-1 hazırlık raporu bu kodlarla
  matrah/KDV/tevkifat verir ve 360.01.xxx bakiyesiyle mutabakat yapar.
- Yardımcı hesaplar noktalı kodla açılır (`<ana>.<sıra>`): kasa 100.xx, banka 102.xx,
  şirket kredi kartı 309.xx, gider kategorisi 770.xx (kullanıcı 760/740'a bağlayabilir),
  alınan çek 101.01/.02/.03, alınan senet 121.01/.02/.03.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Oran bazlı 360.01 kırılımı (360.01.001 = 2/10) | Aynı oranı paylaşan farklı KDV-2 kodları ayrışmaz; beyanname elle doldurulur |
| Sıralı alt hesap (360.01.001…) + türde hesap eşlemesi | Kod hesap adından okunamaz; mizanda ek eşleme gerekir |
| Serbest yüzde oranı | Mevzuat dışı oran girilebilir; yalnızca 2,3,4,5,7,9,10 /10 kabul edilir |

## Sonuçlar (olumlu / olumsuz)
- ➕ KDV-2 beyannamesi kod bazında sistemden çekilebilir; mizan ile mutabakat otomatik.
- ➕ Kasa/banka/kart ve gider kalemleri mizanda ayrı görünür.
- ➖ `total` alanının anlamı değişti (ödenecek tutar); toplamı yeniden hesaplayan istemciler
  tevkifatı düşmelidir.
- ➖ Mevcut fişler ana hesaplarda (100/102/101) kalır; geçmiş yeniden muhasebeleştirilmez.

## Kapanış Kriteri
`tests/integration/withholding-returns.int.test.ts` içindeki tevkifat raporu testi, KDV-2 kodu
301 için matrah/KDV/tevkifat ile 360.01.301 bakiyesi arasında fark = 0 doğrular.

---
*Kural: GOVERNANCE §7 (çelişki çözümü) gereği bu ADR yazıldıysa, etkilenen tüm dokümanlar aynı PR'da güncellenir.*
