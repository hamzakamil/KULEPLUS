# Platform Faturalama Detayları

**Durum:** İskelet — Faz 4 öncesi doldurulacak

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