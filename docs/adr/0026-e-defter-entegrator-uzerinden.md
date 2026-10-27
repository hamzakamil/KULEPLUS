# ADR-0026: e-Defter — Entegratör Üzerinden, GİB Paketine Birebir Uygun XML

**Tarih:** 2026-10-19
**Durum:** Kabul
**İlgili:** migration 202610600000 · `modules/edefter/` · `assets/edefter/` · ADR-0025 (yıl bazlı madde no)

## Bağlam
e-Defter (yevmiye + büyük defter) GİB'in XBRL GL tabanlı standardında aylık üretilir, mali mühür /
NES ile XAdES-BES imzalanır, berat oluşturulur ve GİB'e yüklenir. `sourceApplication` alanına
yalnızca GİB uyumluluk onayı almış yazılımın adı yazılabilir (Yazılım Uyumluluk Onay Kılavuzu
v1.7, 15.01.2026). Ocak 2025'ten beri büyük defterin kendisi yüklenmez, beratı yüklenir; 2026'dan
itibaren aylık veya geçici vergi dönemi bazında yükleme tercih edilebilir.

## Karar
- **Yasal yol:** entegratör üzerinden. Biz imzasız Y (yevmiye) ve K (kebir) XML üretiriz; imza,
  berat (YB/KB), defter raporu ve GİB yüklemesi entegratördedir. `sourceApplication` entegratörün
  yazılım bilgisidir (Firma Profili → e-Defter bilgileri).
- **Uyum:** üretici GİB e-Defter Paketi'nin (06.05.2026) XSD + schematron kurallarına göre yazıldı
  ve her üretimde bu kurallarla yerel olarak doğrulanır (xmllint-wasm + SaxonJS). İmza kuralları
  ayrı listelenir; diğer tek bir kural bile kalırsa defter kaydedilmez.
- **Aylık akış:** ay bitmiş ve kilitli olmalı (madde/satır numaraları donar), taslak fiş olmamalı,
  ay atlanmamalı. Madde ve satır numaraları hesap dönemi başında 1'den başlar, aylar ve parçalar
  boyunca müteselsil ilerler; dönem içi geçişte ilk e-Defter ayından 1'e döner. 200 MB üstü
  defterler parçalanır (madde bölünmez, dönemler boşluksuz). Kontrol numarası (YEV/KEB + YYYYAA +
  6 hane) hesap dönemi boyunca sıralıdır ve `edefter_parts`'ta saklanır.
- **Belge bilgisi:** fatura → invoice (alışta tedarikçinin belge no'su), çek → check, senet →
  voucher, nakit tahsilat/ödeme → receipt, banka dekontu → other "Dekont", gider belge türleri
  (SMM, gider pusulası, müstahsil, perakende fiş…) → other + belge adı. Elle fişte belge alanları
  başlıkta girilir, satırda ezilebilir; belgesiz kayıtta (açılış/kapanış, amortisman) belge tipi yok.
- Dosyalar gzip'li olarak `edefter_parts.content`'te saklanır; "entegratöre gönderildi" işaretli ay
  yeniden üretilemez/silinemez; yalnızca en son ay silinebilir.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Kendi GİB uyumluluk onayımız | Başvuru + test süreci ve mali mühür/HSM imza altyapısı gerektirir; kullanıcı şimdilik istemedi |
| Entegratöre özel format (Excel/API) | Firmaya bağımlılık; standart GİB XML'i her uyumlu yazılımın içe aldığı ortak biçim |
| Doğrulamayı entegratöre bırakmak | Hatalar geç ve toplu görülmez; kılavuz uyumlu yazılımdan ön kontrol bekler |

## Sonuçlar
- ➕ Dosyalar GİB'in kendi kurallarıyla doğrulanmış olarak çıkar; hatalar madde numarasıyla gösterilir.
- ➕ Entegratör değişse de çıktı aynıdır.
- ➖ Berat, defter raporu (DR), envanter defteri ve döviz alanları (gl-muc) bu fazda yok.
- ➖ SaxonJS ücretsiz ama açık kaynak değil (Saxonica lisansı; docs/legal/THIRD-PARTY.md).

## Kapanış Kriteri
`tests/edefter-validator.test.ts`, `tests/edefter-generator.test.ts` ve
`tests/integration/edefter.int.test.ts` geçer; GİB örnek defteri doğrulayıcıdan hatasız geçer.
