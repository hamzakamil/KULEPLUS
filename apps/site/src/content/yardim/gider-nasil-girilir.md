---
title: Gider nasıl girilir?
description: İşletme gideri kaydı ve kategori takibi.
order: 10
phase: 3
---

> **Bu özellik Faz 3’te geliyor.** Giderler ayrı `expenses` tablosunda tutulur (ADR-0008).

## Beklenen akış

1. **Gider → Yeni Gider** seçin.
2. Gider kategorisini, tutarı ve tarihi girin.
3. İsteğe bağlı fatura/e-posta ekini yükleyin.

## Kurallar

- Gider, finansal belgedir; kesinleşmiş gider sessizce **değiştirilmez**.
- KDV ayrıntısı gider satırında taşınır.
