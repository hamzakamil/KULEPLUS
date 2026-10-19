# ADR-0025: Yıl Bazlı Madde Numarası, KDV Mahsubu ve Yıl Sonu Kapanış Sihirbazı

**Tarih:** 2026-10-19
**Durum:** Kabul
**İlgili:** SPEC §15 · migration 202610590000 · `modules/accounting/{ledger,vat,closing}.ts`

## Bağlam
Yevmiye madde numarası şirket genelinde tek diziydi; yevmiye defteri ve e-Defter uygulamasında
numara her hesap döneminde 1'den başlar, tarih sırasıyla artar (açılış 1. madde, kapanış son
madde). Geriye tarihli fişler onay sırasına göre numara aldığından tarih sırası bozulabiliyordu.
Aylık KDV mahsubu ve yıl sonu kapanış/devir işlemleri elle yapılmak zorundaydı.

## Karar
- `journal_entries.fiscal_year` (dönemin yılı, trigger ile) ve tekil (tenant, mali yıl, madde no).
  Numara onayda verilir; "Yeniden sırala" kilit tarihinden önceki (basılmış/e-Defter'e girmiş)
  fişlere dokunmadan kalanları tarih + tür sırasıyla (açılış → olağan → dönem sonu → kapanış)
  boşluksuz dizer. Kilit konurken ve dönem kapatılırken otomatik çalışır.
- Yeni fiş türleri: `donem_sonu`, `kapanis`.
- Aylık KDV mahsup fişi (önizle → onayla, ay sonu tarihli): 391 B / 191 A / 190 A /
  360.02 Ödenecek KDV A; 191 fazlası 190'a borç yazılıp devreder. Aynı ay için tek fiş.
  Sorumlu sıfatıyla KDV (360.01, KDV-2) bu fişe girmez.
- Yıl sonu sihirbazı tek işlemde: 7/A yansıtma ve 7xx kapanışı, 6xx→690, vergi karşılığı
  (691/370; ticari kâr + KKEG − indirimler × şirket ayarındaki oran, sihirbazda düzeltilebilir),
  193 mahsubu, 690/691→692→590/591, kapanış fişi (31.12), açılış fişi (yeni yılın ilk günü),
  isteğe bağlı 590→570 / 591→580 virmanı; ardından numaralar sıralanır ve dönem kapanır.
  Önizleme aynı hesabı geri alınan transaction'da yapar. Vergi ayarı `tenant_settings`
  (`accounting_tax`) anahtarında tutulur.
- Raporlar: kapatılan yılın raporlarına o yılın kapanış fişi girmez; gelir tablosu 690/692
  devir fişlerini (`year_end_result`) dışlar. Sonraki yıl kapanış devirde kalır, açılışla dengelenir.
- Kontrollü geri alma: kapanıştan sonra yeni yılda fiş girilmemiş ve kilit yıl sonunu
  geçmemişse sihirbaz fişleri silinir, dönem açılır, yeni yılın numaraları yeniden sıralanır.
  Sihirbaz fişleri elle ters çevrilemez.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Şirket genelinde tek numara dizisi | Yevmiye defteri / e-Defter yıl bazlı numara ister |
| Numarayı yalnızca defter basımında vermek | Fiş ekranında numara görünmez; denetim izi zayıflar |
| Kapanış sonrası fişleri ters kayıtla geri almak | Kapalı yıla ek fiş yazar, madde sırası bozulur |
| Aylık 7/A yansıtma zorunluluğu | Küçük işletmede gereksiz yük; sihirbaz kalan kısmı yansıtır |

## Sonuçlar (olumlu / olumsuz)
- ➕ Kapanış ve açılış tek ekrandan, önizlemeyle; vergi karşılığı ve 193 mahsubu otomatik.
- ➕ Kapatılan yılın bilançosu/mizanı kapanış sonrası da doğru raporlanır.
- ➖ Kilitsiz kısımda madde numaraları değişebilir; dış sisteme numara verilmeden önce kilit konmalıdır.
- ➖ 7/B (79x) ve 700/701 bakiyeleri otomatik dağıtılmaz; sihirbaz bunu engelleyici hata olarak bildirir.

## Kapanış Kriteri
`tests/integration/{entry-numbering,vat-offset,year-end}.int.test.ts` gerçek PostgreSQL'de geçer.

---
*Kural: GOVERNANCE §7 (çelişki çözümü) gereği bu ADR yazıldıysa, etkilenen tüm dokümanlar aynı PR'da güncellenir.*
