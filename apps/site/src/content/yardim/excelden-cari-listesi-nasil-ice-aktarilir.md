---
title: Excel’den cari listesi nasıl içe aktarılır?
description: "İçe aktarma sihirbazı: kolon eşleştirme, dry-run, hata raporu ve onay."
order: 4
phase: 2
---

## İçe aktarma sihirbazı

**Cari → İçe Aktar** yolundan Excel (`.xlsx`) veya CSV (UTF-8 BOM) dosyanızı seçin.

1. **Kolon eşleştirme:** Dosyanızdaki sütunlar sistem alanlarıyla eşleştirilir.
2. **Dry-run (ön izleme):** İlk 50 satır ve doğrulama sonuçları gösterilir.
3. **Hata raporu:** Hatalı satırlar satır numarasıyla listelenir; indirilebilir.
4. **Onay:** Hataları düzelttikten veya atladıktan sonra onaylayın.
5. **Kontrollü yükleme:** Kayıtlar parti (batch) halinde yazılır.

## Kurallar

- 1000 satıra kadar dosyalar senkron işlenir; daha büyükleri kuyruğa alınır.
- Satır bazlı doğrulama yapılır; **tekrarlanan import mükerrer kayıt oluşturmaz**.
- Büyük dosya tek uzun transaction’a alınmaz — finansal belgede transaction birimi belgedir.

Şablon sözleşmeleri: `docs/product/import-templates/contacts.md`.
