# Platform Faturalama Detayları

**Durum:** İskelet — Faz 4 öncesi doldurulacak

> **Şema hazırlığı (14 Ekim 2026):** `tenants.is_operator` kolonu + tek-satır kısıtı
> (`uq_tenants_single_operator`) migration `202610430000_operator_tenant.sql` ile eklendi
> (SPEC §8.9). İşletmeci şirket bilgileri (VKN/ünvan) netleşince operator tenant satırı
> oluşturulup `is_operator = TRUE` işaretlenir.

## İşletmeci Şirket
- Ünvan: TBD
- VKN: TBD
- Vergi dairesi: TBD
- Adres: TBD

## Entegratör
- Sağlayıcı: TBD (Faz 4 öncesi)
- Hesap: TBD
- GİB kodu: TBD

## Fatura Serisi
- Seri: TBD (ör. PLT)
- Başlangıç no: 00001
- Prefix kuralı: PLT-YYYY-NNNNN

## KDV
- Oran: %20 (hizmet)
- İstisna/tevkifat: yok (varsayılan)

## İş Akışı
Her başarılı ödeme → platform faturası (outbox) → entegratör → e-Arşiv/e-Fatura → müşteri e-posta