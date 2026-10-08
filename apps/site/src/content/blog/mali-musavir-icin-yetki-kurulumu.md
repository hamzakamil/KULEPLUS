---
title: "Mali müşavirler için bulut ön muhasebe: yetki nasıl kurulmalı?"
description: "Harici mali müşavir erişiminde varsayılan salt okuma + dışa aktarma neden doğru bir başlangıçtır?"
pubDate: 2026-10-04
author: Kuleplus Ekibi
tags: ["mali müşavir", "güvenlik", "kvkk"]
---

Bir işletmenin mali müşaviri, işletmenin verisine **dışarıdan** erişir. Bu erişimin
iki zarfı vardır: hangi şirketlere ve neye.

## Her şirket ayrı üyelik

Kuleplus’ta mali müşavir, farklı şirketlere **ayrı üyeliklerle** erişir. Tek bir hesap
“her yerde yetkili” değildir; her şirketin yetkisi bağımsız tanımlanır. Bir müşteriyle
ilişki bittiğinde o şirketin üyeliği kapatılır, diğerleri etkilenmez.

## Varsayılan: salt okuma + dışa aktarma

`MALI_MUSAVIR` rolünün varsayılan yetkisi:

1. **Okuma** — listeler, ekstre, raporlar
2. **Dışa aktarma** — Excel/CSV ve tam ZIP dışa aktarma

Kayıt değiştirme, dönem açma ve kritik onaylar **ayrıca** verilir. Bu varsayılan,
hem KVKK’nın “en az yetki” ilkesiyle hem de denetim izi (audit log) gerekliliğiyle
uyumludur.

## Denetim izi her şeyi kaydeder

Destek erişimi bile rastgele değildir: platform kullanıcıları `support_access_grants`
ile **süreli ve gerekçeli** erişir; grant olmadan hiçbir platform kullanıcısı tenant
verisi göremez.

> Ortak çalışmayı düşünüyorsanız [Mali Müşavirler İçin](/mali-musavirler-icin) sayfamıza
> bakın; ortak komisyon programı da hazırlanmaktadır.
