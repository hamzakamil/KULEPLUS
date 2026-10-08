# SEO ve Analitik Planı

**Durum:** İskelet — Faz 2 öncesi doldurulacak

## Hedef Keyword'ler (v1 taslak)
- "bulut ön muhasebe"
- "kobi erp yazılımı"
- "e-fatura entegrasyonu"
- ... (pazarlama ile doldurulacak)

## Plausible Event Listesi
| Event | Tetikleyici | Amaç |
|-------|-------------|------|
| `site_visit` | Otomatik (Plausible default) | Trafik |
| `cta_click_signup` | "Ücretsiz Başla" butonu | Dönüşüm |
| `cta_click_demo` | "Demo İzle" butonu | Dönüşüm |
| `contact_form_submit` | İletişim formu gönderimi | Lead |
| `help_article_view` | Yardım makalesi görüntüleme | İçerik |

## UTM Kuralı
`utm_source`, `utm_medium`, `utm_campaign` — `apps/site` → `apps/web` yönlendirmesinde korunur.

## Dönüşüm Hunisi
Ziyaret → Kayıt formu → E-posta doğrulama → Şirket başvurusu → Onay → İlk kayıt