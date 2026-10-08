---
title: Fatura nasıl oluşturulur?
description: Teklif, sipariş ve fatura oluşturma akışı.
order: 7
phase: 3
---

> **Bu özellik Faz 3’te geliyor.** Fatura modülü (`trade`) ücretli paketin parçasıdır.

## Beklenen akış

1. **Fatura → Yeni Fatura**, cari seçin.
2. Satırları girin (ürün/hizmet, miktar, birim fiyat).
3. KDV oranı satır bazında hesaplanır; tevkifat ve istisna kodları seçilebilir.
4. **Onayla** ile fatura kesinleşir.

## Kurallar

- Belge numaraları kontrollü sekans ile üretilir (`document_number_sequences`).
- Kesinleşmiş faturalar sessizce değişmez; düzeltme **iptal + yeniden** veya ters kayıtladır.

Bu süre içinde fiyat teklifi ve sipariş için bize yazabilirsiniz.
