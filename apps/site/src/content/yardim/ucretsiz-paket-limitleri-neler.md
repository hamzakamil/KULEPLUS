---
title: Ücretsiz paket limitleri neler?
description: Ücretsiz çekirdek paketin kapsamı ve limit kontrolü.
order: 6
phase: 2
---

## Ücretsiz çekirdek

Yeni kayıt olan herkes **süresiz** ücretsiz başlangıç paketine sahip olur. Demo süresi
yoktur. Paketinizden birini seçersiniz:

- **Cari** modülü (contacts) **veya**
- **Stok** modülü (stock)

## Limitler

| Alan | Ücretsiz | Ücretli |
|------|----------|---------|
| Özel rol sayısı (`max_custom_roles`) | 1 | Sınırsız (`NULL`) |
| Dışa aktarma (ZIP) | Açık | Açık |
| Kilitli modüller | Salt okunur önizleme | Yazma açık |

## Limit aşımı nasıl işler?

Limitler **backend’de** zorlanır; frontend yalnızca bilgilendirir. Kota aşıldığında
**yeni işlem engellenir**, mevcut kayıtlar bozulmaz.

## Veri rehin alınmaz

Paket düşürürseniz modül **salt okunur** olur; veriniz silinmez. Dışa aktarma her planda
açıktır.
