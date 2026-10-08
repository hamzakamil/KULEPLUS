# Karar Kaydı — Faz 0 & Faz 1

**Tarih:** 8 Ekim 2026
**Durum:** ✅ **KARARLAR VERİLDİ** — uygulandı (aşağıda)
**İlgili:** `docs/ROADMAP.md` §10 (K-01…K-20), `TODOS.md` · `docs/GOVERNANCE.md` §7

> **Sonuç (8 Ekim 2026):** Faz 0 ve Faz 1 kullanıcı onayıyla **kapatıldı**; Faz 2 başladı.
> Kararlar: B1 GitHub repo oluşturulacak · B2/B3 ertelendi · **C4 Fintech paleti** ·
> **D1 SMMM danışman mevcut** · **E1 Hosting TR** · A Faz 0 ✅ + Faz 1→2 ✅.
> C1 (domain) ve C2 (destek e-postası) kararları **açık** kaldı (blokaj değil).
>
> **Uygulanan:**
> - `docs/brand.md` → Fintech paleti aktif (kod zaten bu paleti kullanıyordu), a11y notları güncellendi
> - `docs/ROADMAP.md` K-12 → **Kapalı (TR)**
> - `docs/product/golden-tests.md` → 18 senaryolu SMMM imza takibi başlatıldı
> - `TODOS.md` → Faz 0 ✅ + Faz 1 ✅ kapatıldı, **Faz 2 AKTİF**
> - `docs/operations/first-push-guide.md` → ilk push rehberi (eski `backend/` git'ten çıkarılmalı uyarısı dahil)
> - `npm run format:check` düzeltildi (CI ilk çalıştırmada bu adımda patlardı)

---

Bu belge, **kod tarafı tamamlanmış** olan Faz 0 ve Faz 1'in kapanması için
yalnızca senin kararına/hesabına bağlı kalan maddeleri toplar. Her madde için
seçenekler ve ajan önerisi verilmiştir; karar verildiğinde GOVERNANCE §7 uyarınca
etkilenen dokümanlar aynı PR'da güncellenir.

---

## A. Kod tarafı bitti, yalnızca onay kaldı

| # | Madde | Durum | Kanıt |
|---|-------|-------|-------|
| A1 | Faz 0 çıkış kapısı (CI, ADR, doküman iskeleti) | ⏸ onay bekliyor | `TODOS.md` Faz 0 Çıkış Kapısı |
| A2 | Faz 1 çıkış kapısı (10 kabul kriteri) | ⏸ onay bekliyor | `TODOS.md` — Kanıt Eşlemesi tablosu |
| A3 | Faz 1 → Faz 2 geçişi | ⏸ onay bekliyor | ROADMAP §0.4 Faz Geçiş Kapısı |

**Not:** Faz 1'in tüm kabul kriterleri kanıtlandı — 137 test, 29/29 WCAG 2.1 AA,
RLS 4/4, e2e akış testi, tüm kalite kapıları yeşil.

---

## B. Ortam / hesap gerektiren maddeler

| # | Madde | Gereken | Etki |
|---|-------|---------|------|
| B1 | **GitHub repo + ilk push** | Git remote | CI hiç çalışmadı; 4 ihlalli kırmızı başlar durumu düzeltildi ama ilk yeşil çalıştırma kanıtlanmalı |
| B2 | **Staging deploy** (api/web/worker → TR VPS) | VPS hesabı + DNS | Faz 0 çıkış kapısı |
| B3 | **Preview environment** (web + site) | Cloudflare Pages hesabı | Faz 0 çıkış kapısı; her PR'a otomatik preview |
| B4 | **Transactional e-posta** (Postmark/SMTP) | SMTP hesabı + gönderim domaini | Faz 1 outbox → gerçek gönderim |
| B5 | **SENTRY_DSN / hata izleme** | Sentry hesabı | SPEC §30.7 (Faz 2 kapısı) |

---

## C. Ürün / marka kararları

| # | Madde | Seçenekler | Ajan önerisi |
|---|-------|------------|--------------|
| C1 | **Ürün domaini** | `kuleplus.com` · `kuleplus.com.tr` · diğer | `.com.tr` (TR pazarı + KVKK algısı) |
| C2 | **Destek e-postası** | `destek@…` · `info@…` · `support@…` | `destek@kuleplus.com.tr` |
| C3 | **Gönderim (transactional) domaini** | ayrı alt alan adı (`mail.…`) | SPF/DKIM ayrımı için alt alan adı |
| C4 | **Renk paleti** | brand.md'de 2 palet var | "Executive Trust" (mevcut site bunu kullanıyor) |
| C5 | **Logo varlığı** | SVG/PNG dosyası | `packages/ui` altına eklenmeli |
| C6 | **Marka adı teyidi** | Kuleplus | Onaylı (site + docs senkron) |

> ⚠ **Temizlik yapıldı:** `docs/brand.md` içinde kişisel e-posta (`…@gmail.com`) ve
> bozuk `{{PRODUCT_NAME}}` placeholder'ı vardı — ikisi de kaldırıldı. Kişisel iletişim
> bilgisi repoya yazılmaz (KVKK minimizasyon, SPEC §27.2).

---

## D. Dış bağımlılık

| # | Madde | Gereken | Neden kritik |
|---|-------|---------|--------------|
| D1 | **SMMM danışman** | Mali müşavir | Faz 5 muhasebe doğruluğu onun imzasına bağlı |
| D2 | **Golden test envanteri** | SMMM ile birlikte | Faz 5 çıkış kapısı |
| D3 | **Hukukçu onayı** | Avukat | `docs/legal/*` (KVKK, ToS, DPA) yayın öncesi zorunlu |
| D4 | **İşletmeci şirket bilgileri** | VKN, ünvan, vergi dairesi | `docs/operations/platform-billing.md` boş |

---

## E. Bilinçli açık teknik kararlar (senin seçimin)

| # | Konu | Mevcut durum | Seçenekler |
|---|------|--------------|------------|
| E1 | **Hosting bölgesi (K-12)** | brand.md "TR" diyor ama operasyonel karar yok | TR (KVKK dostu) · AB (maliyet) |
| E2 | **Fiyatlandırma (₺)** | site `TBD` gösteriyor | Faz 4'te netleşecek — şimdi karar gerekmez |
| E3 | **`db:push` / Drizzle generate** | Kaldırıldı; ham SQL migration kullanılıyor | ROADMAP kararıyla uyumlu — teyit yeterli |

---

## F. Bu tur tespit edilen ve düzeltilen (bilgi amaçlı)

| # | Bulgu | Çözüm |
|---|-------|-------|
| F1 | `docs/brand.md`: kişisel e-posta sızıntısı + bozuk placeholder | Temizlendi |
| F2 | Seed `legal_texts` id vermiyordu (default yok → çöker) | Deterministik UUID v7 |
| F3 | `drizzle-kit` introspect çıktısı repoya sızmış, governance'ı kırıyordu | Kaldırıldı + `.gitignore` |
| F4 | `tenant_settings` onay akışı var olmayan kolonlar yazıyordu | Gerçek şemaya çevrildi |
| F5 | E-posta/başvuru çakışmaları `PERIOD_LOCKED` (yanlış modül) dönüyordu | Yeni `CONFLICT` kodu |
| F6 | `contacts` + `stock` modülleri yazılmış (Faz 2 kapsamı) — TODOS'ta görünmüyordu | TODOS güncellendi |

---

## Karar Formu — ✅ DOLDURULDU (8 Ekim 2026)

```
[B] B1 GitHub repo:            (x) oluşturulacak        → docs/operations/first-push-guide.md
[B] B2 VPS / B3 Cloudflare:    (x) ertelendi           → blokaj değil
[C] C1 Domain:                 ( ) AÇIK               → TBD
[C] C2 Destek e-postası:       ( ) AÇIK               → TBD
[C] C4 Renk paleti:            (x) Fintech            → brand.md güncellendi
[D] D1 SMMM danışman:          (x) var                → golden-tests.md başlatıldı
[E] E1 Hosting bölgesi:        (x) TR                 → K-12 kapalı
[A] Faz 0 onayı:               (x) onayla             → TAMAMLANDI
[A] Faz 1 → Faz 2 geçişi:      (x) onayla             → Faz 2 AKTİF
```
