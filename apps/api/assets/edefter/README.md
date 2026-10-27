# e-Defter varlıkları (GİB e-Defter Paketi)

Kaynak: https://www.edefter.gov.tr → `dosyalar/paketler/e-Defter_Paketi.zip` (güncelleme: **06.05.2026**;
içerik sürümleri: Teknik Kılavuz v1.7, Yevmiye Defteri Kılavuzu v1.5, Uygulama Kılavuzu v1.12).

| Klasör | İçerik | Not |
|---|---|---|
| `xsd/` | edefter.xsd, XBRL GL 2006-10-25, XAdES, xmldsig | Uzak `schemaLocation`'lar yerel dosyaya çevrildi (edefter.xsd → xbrl-instance, XAdESv141 → XAdES.xsd) |
| `sch/` | edefter_yevmiye.sch, edefter_kebir.sch | Değiştirilmeden |
| `sef/` | yevmiye/kebir `.sef.json` | `node scripts/edefter/compile-schematron.mjs` ile üretilir (ISO Schematron XSLT2 iskeleti + SaxonJS) |
| `xslt/` | yevmiye.xslt, kebir.xslt | Görüntüleme; indirilen zip'e eklenir |
| `samples/` | GİB örnek yevmiye (imzalı) | Doğrulayıcı testi (`tests/edefter-validator.test.ts`) |

## Paket güncellendiğinde

1. Yeni zip'i indirip `sch`, `xsd`, `xml/*.xslt` dosyalarını buraya kopyalayın (yukarıdaki yerel
   `schemaLocation` düzeltmelerini yeniden uygulayın).
2. `node scripts/edefter/compile-schematron.mjs`
3. `npx vitest run tests/edefter-*.test.ts` ve `INTEGRATION_DB=1 npm run test:integration -w apps/api`.
4. `Versiyonlar.txt`'teki değişiklikleri ADR-0026'ya not edin.
