# Marka Kılavuzu

**Durum:** Onaylı — Faz 0'da doğrulanacak (renk paleti ve logo tanımlı)

## Ürün Adı
**Kuleplus** (tek kaynak: `apps/site/src/config/site.ts`)

## Kısa Açıklama
Küçük işletmeler ve serbest muhasebeci mali müşavirler için profesyonel muhasebe ve finans yönetim platformu.

## Ton ve Dil
- TR, sade, muhasebe jargonundan arındırılmış (patron için).
- Uzman görünümünde teknik terimler kullanılabilir.

## Logo ve Renk Paleti

**AKTİF PALET: Fintech** (karar: 8 Ekim 2026 — `docs/operations/pending-decisions.md` C4)

**Light Theme**
- **Primary:** #1D4ED8 (logo, header, sidebar, main buttons)
- **Secondary:** #06B6D4 (charts, active status, data emphasis)
- **Accent:** #F59E0B (önemli KPI, premium rapor)
- **Background:** #F8FAFC (genel açık tema arka planı)
- **Text:** #0F172A (ana metin)
- **Muted:** #64748B (ikincil metin, açıklama)
- **Border:** #E2E8F0 (çizgi, ayraç, input kenarı)
- **Success:** #16A34A (artış, pozitif bakiye)
- **Warning:** #F59E0B (risk, gecikme, uyarı)
- **Danger:** #DC2626 (azalış, kritik uyarı, negatif bakiye)
- **Info:** #0EA5E9 (bilgi mesajı, bağlantı)
- **Surface:** #FFFFFF (kart, modal, tablo alanı)
- **Surface Alt:** #F1F5F9 (tablo satırı, ikincil kart)

**Dark Theme / Mobile Dashboard**
- **Background:** #0B1220
- **Surface:** #121A2A
- **Elevated Surface:** #1B2538
- **Text:** #F8FAFC
- **Text Muted:** #94A3B8
- **Border:** #2A3648
- **Primary:** #3B82F6
- **Secondary:** #22D3EE
- **Accent:** #FBBF24
- **Success:** #34D399
- **Warning:** #F59E0B
- **Danger:** #F87171
- **Info:** #60A5FA

**Erişilebilirlik (WCAG 2.1 AA — SPEC §24)**
- `#1D4ED8` beyaz metinle 4.5:1'in üzerinde (AA uyumlu).
- `#06B6D4` üzerinde **koyu metin** kullan (beyaz metinle kontrast yetersiz).
- Renk tek başına anlam taşımaz: +/− işareti ve ikon eşlik eder (renk körlüğü).
- Odak halkası: `#1D4ED8` 2px + 2px offset.

<details>
<summary><b>Alternatif palet: Executive Trust</b> (kullanılmıyor — C4 kararı)</summary>

- **Primary / Brand Primary:** #0A2540 (logo, header, sidebar, main buttons)
- **Primary Dark:** #06182B (hover, deep background)
- **Primary Light:** #1E3A5F (secondary button, card title)
- **Secondary / Live Data:** #00A896 (charts, active status, data emphasis)
- **Accent / Premium:** #D4AF37 (patron dashboard, VIP reports, important KPI)
- **Info:** #2F80ED · **Success:** #27AE60 · **Warning:** #F2C94C · **Danger:** #EB5757
- **Background:** #F7F9FC · **Surface:** #FFFFFF · **Surface Alt:** #EEF2F7
- **Text:** #0F172A · **Text Muted:** #64748B · **Border:** #D9E2EC

</details>

**Kullanım Dağılımı (Fintech)**
- %60 nötr: beyaz, açık gri, koyu mavi arka planlar
- %25 marka primary: `#1D4ED8`
- %10 secondary: `#06B6D4` (grafik/veri vurgusu)
- %5 accent + semantik: `#F59E0B`, yeşil, kırmızı

## Domain ve E-posta
- **Ürün domain:** kuleplus.com.tr
- **Destek e-postası:** destek@kuleplus.com.tr
- **Gönderim e-postası (transactional):** no-reply@kuleplus.com.tr (Faz 1 — SMTP/Postmark kurulumu)
- **Platform sahibi kişisel iletişimi:** Bu dosyaya YAZILMAZ (kişisel veri; repo'ya sızmaz)

## Yazım Kuralları
- "i" → "İ" (tr-TR büyük harf kuralı)
- Sayı biçimi: 1.234,56 ₺
- Tarih: 05.10.2026