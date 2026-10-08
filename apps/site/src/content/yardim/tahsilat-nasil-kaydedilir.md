---
title: Tahsilat nasıl kaydedilir?
description: Müşteri tahsilatı ve ödeme kaydı.
order: 8
phase: 3
---

> **Bu özellik Faz 3’te geliyor.** Tahsilat/ödeme akışı `cashbank` modülündedir.

## Beklenen akış

1. **Tahsilat → Yeni** seçin.
2. Cari ve alınacak tutarı girin.
3. Kasa veya banka hesabı seçip kaydedin.

## Kurallar

- Aynı tahsilat isteği tekrar gönderilirse **ikinci kayıt oluşmaz** (idempotency).
- Kesinleşmiş para hareketi sessizce değişmez; düzeltme **ters kayıt** ile yapılır.
- Bakiye, kesinleşmiş hareketlerden üretilir.
