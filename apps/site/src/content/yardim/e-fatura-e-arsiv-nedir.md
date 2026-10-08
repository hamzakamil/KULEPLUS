---
title: e-Fatura / e-Arşiv nedir?
description: e-Dönüşüm kapsamı ve entegratör modeli.
order: 11
phase: 4
---

> **Bu özellik Faz 4’te geliyor.** `einvoice` modülü bir eklentidir.

## Kapsam

- **e-Fatura:** GİB üzerinden faturalaşan mükellefler arası zorunlu faturalama.
- **e-Arşiv:** GİB mükellefi olmayan alıcılara fatura.
- **e-İrsaliye:** Sevkiyat belgesi (Faz 4).

## Nasıl çalışıyor?

Kuleplus **kendi UBL-TR/XSD hattını yürütmez**. Gönderim, GİB onaylı özel bir
entegratörün REST API’si üzerinden **adapter** ile yapılır; sağlayıcı yapılandırması
platformdan yönetilir. Gelen/gelen kutusu ve durum olayları sistemde izlenir.

## e-Defter

Yevmiye/kebir XML üretimi Faz 6’dadır; entegratör/saklayıcı ile iletilir.
