---
title: Verimi nasıl dışa aktarırım?
description: ZIP tam dışa aktarma formatı ve Excel/CSV export.
order: 13
phase: 2
---

## Tam dışa aktarma (ZIP)

**Ayarlar → Veri Dışa Aktarma** ile tek ZIP indirirsiniz. İçerik:

```text
manifest.json   → dışa aktarım bilgisi
data/*.csv      → tüm tablolar (UTF-8 BOM)
files/          → yüklenen belgeler
README.txt      → dosya açıklamaları
```

## Excel / CSV export

Liste ekranlarından seçili görünümü `.xlsx` veya CSV (UTF-8 BOM) olarak
indirebilirsiniz. CSV dosyaları Excel’de Türkçe karakterler bozuk açılmaz.

## Önemli

- Dışa aktarma **her planda** açıktır — veri rehin alınmaz.
- KVKK kapsamında verilerinizi talep üzerine de alabilirsiniz (bkz. [Gizlilik ve KVKK](/yasal/gizlilik-kvkk)).
