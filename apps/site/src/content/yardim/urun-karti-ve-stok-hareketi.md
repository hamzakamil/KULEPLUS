---
title: Ürün kartı ve stok hareketi nasıl girilir?
description: Ürün/hizmet kartı, birim dönüşümü ve stok hareketleri.
order: 5
phase: 2
---

## Ürün kartı

**Stok → Yeni Ürün** ile kart açın:

- Ünvan, kategori, birim (adet, kg, mt…) ve isteğe bağlı barkod
- Birim dönüşümü tanımlayabilirsiniz (ör. 1 koli = 12 adet)
- Negatif stok politikası varsayılan olarak **block**’tur (`tenant_settings.negative_stock_policy`)

## Stok hareketi

Stok hareketleri dört türdür: **giriş, çıkış, transfer, sayım düzeltme**.

- Hareketler **hareketli ağırlıklı ortalama** maliyetle değerlenir (FIFO eklenmez).
- Sayım onaylandığında fark hareketi oluşturulur; miktar doğrudan **ezilmez**.
- Kritik stok seviyesi altına inen üründe uyarı görünür.

Açılış stoğu, cari açılış bakiyeleri gibi içe aktarma sihirbazıyla yüklenir.
