---
title: Şirket başvurusu nasıl onaylanır?
description: Onboarding akışı, manuel onay ve kurulum rehberi.
order: 2
phase: 2
---

## Akış

Kayıt olduktan sonra **şirket başvurusu** oluşturursunuz:

```text
Ücretsiz kayıt → E-posta doğrulama → Başlangıç paketi seçimi
   → Şirket başvurusu → Platform incelemesi
   → TENANT + OWNER + roller + ücretsiz haklar + modüller
   → Kurulum rehberi → İlk gerçek kayıt
```

## Manuel onay (varsayılan)

Varsayılan `onboarding_mode` **manual**’dir: başvurunuz platform incelemesinden geçer.
İnceleme sonucunda başvurunuz onaylanır veya gerekçesiyle reddedilir; bilgilendirme
e-postası gönderilir.

## Onay sonrası

Sistem tek işlem içinde hazırlar: şirket kaydı (tenant), OWNER rolü, varsayılan roller,
ücretsiz paket hakları ve varsayılan modüller. Ardından kurulum rehberi açılır.

> Not: Şirket başvurusu ile şirket kaydı birbirine benzersiz bağlıdır; eşzamanlı iki
> onay iki şirket oluşturmaz.
