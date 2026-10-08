# TODOS.md — İlerleme Kaydı

**Amaç:** ROADMAP v5.1.0'a göre ilerlemeyi, tamamlananları ve sıradaki adımları takip etmek.
**Son güncelleme:** 8 Ekim 2026
**Durum:** Faz 0 ✅ onaylandı · Faz 1 ✅ onaylandı → **Faz 2 başladı**

**İlgili dokümanlar:** `docs/ROADMAP.md` · `docs/GOVERNANCE.md` · `docs/TECHNICAL_SPEC.md` · `readme.md`

---

## ✓ Tamamlananlar

### Genel
- [x] **Mojibake temizliği** — `docs/` altındaki 25 md dosyasında UTF-8 → CP1252 çift kodlama bozulması düzeltildi (SPEC §3: "hiçbir katmanda mojibake kabul edilmez"). Script: `scripts/fix-docs-encoding.mjs` (`npm run docs:fix-encoding`, `--dry-run` destekli).
- [x] **Marka adı:** Kuleplus (kullanıcı tarafından verildi; `apps/site/src/config/site.ts` tek kaynak).

### Faz 2 — Pazarlama Sitesi alt kalemi (`apps/site` — Astro, statik)
- [x] Monorepo kök iskeleti: `package.json` (npm workspaces — T-0.1 önerisi), `.gitignore`
- [x] `packages/ui` — web ile paylaşılacak Vue bileşenleri (ADR-0012): `FaqAccordion` (aria-expanded/controls), `ContactForm`
- [x] Astro 7 iskeleti: `astro.config.mjs` (site URL, sitemap, Vue), `tsconfig` strict, `.env.example`
- [x] Ana sayfa, Özellikler, Fiyatlandırma (taslak), SSS, Mali Müşavirler İçin, İletişim, 404
- [x] Yardım merkezi v0 — **15 makale** (`docs/product/help-center.md` başlıklarına göre) + `Faz 3/4` rozetleri
- [x] Blog altyapısı — Astro Content Collections + 2 örnek yazı
- [x] Yasal sayfalar — kaynak `docs/legal/*.md` (Content Collection; taslak uyarı bandı ile)
- [x] SEO: canonical, OG, `robots.txt`, sitemap-index.xml
- [x] Analitik: Plausible (`PUBLIC_PLAUSIBLE_DOMAIN` boşsa script yok) + event'ler: `cta_click_signup`, `help_article_view`, `contact_form_submit`
- [x] UTM kuralı: site → web yönlendirmesinde UTM korunur (`data-utm-link`)
- [x] İletişim formu → `POST {PUBLIC_API_URL}/api/v1/public/contact` (API hâlâ yok — hata durumu zarif)
- [x] i18n iskeleti: `src/i18n` JSON sözlük + `t()` + `Intl` tr-TR biçimleri (yalnız TR)
- [x] Doğrulama: build **29 sayfa** temiz; preview'da **10 route HTTP 200**; UTF-8 çıktıda mojibake yok; JS toplamı ~77 KB (bütçe 250 KB gzip)
- [x] Erişilebilirlik (temel): skip-link, `lang="tr"`, semantic landmarks, focus-visible, aria-current menü

### Faz 1 — bu oturumda tamamlananlar (6 Ekim 2026)
- [x] **Veritabanı şeması (Faz 1 migration):** `202610050001_core_schema.sql` — Kimlik (users, sessions), Şirket (tenants, users, invitations), Organizasyon (branches, departments), Yetki (roles, permissions, role_permissions), Tenant ayarları, Audit logs, Yasal metinler (ADR-0011), Abonelik/Entitlement (modules, features, plans, plan_versions, plan_features, plan_limits, prices, tenant_entitlements, tenant_module_settings, usage_counters)
- [x] **Down migration:** `202610050001_core_schema.down.sql` (SPEC §30.7)
- [x] **Seed verileri:** `202610050002_seed_data.sql` — 14 modül (GOVERNANCE §2), 29 feature, 3 plan (free/core_plus/enterprise), plan_features, **K-02 limitleri** (free: cari 500, stok 200, ayda 100 import satırı, 1 özel rol; core_plus/enterprise: sınırsız), prices, 9 core permission, 3 yasal metin (ADR-0011)
- [x] Migration uygulandı ve seed yüklendi (docker postgres 5434)
- [x] **RLS izolasyon testleri canlı yeşil** (4/4) — seed verisiyle entitlement + plan_limits doğrulandı
- [x] Tüm kalite kapıları yeşil: lint, format, 48/48 test, typecheck, governance, bundle, build

---

## ✅ FAZ 0 — TAMAMLANDI (kullanıcı onayı: 8 Ekim 2026)
**Kararlar:** K-12 Hosting = **TR** (kapalı) · Renk paleti = **Fintech** · SMMM danışman mevcut
**Ertelenen (blokaj değil):** B2 Staging/VPS, B3 Cloudflare preview — hesap açılınca yapılır
**Açık kalan:** CI ilk çalıştırma (GitHub repo), C1/C2 (domain, destek e-postası)


### Karar ve Envanter
- [x] **Mevcut kod/tablo/route/ekran envanteri** — `scripts/inventory.mjs` → `INVENTORY_REPORT.md` (116 dosya, 26 tablo, 6 rota)
- [x] **FLOAT/DOUBLE taraması** — `scripts/governance-check.mjs` ile sürekli CI kontrolü
- [x] **Bağımlılık ve lisans envanteri** — `scripts/license-inventory.mjs` → `LICENSE_INVENTORY.md` (661 dep, 1 lisans türü - UNKNOWN)
- [x] **ADR şablonu** (`docs/adr/0000-template.md`) — GOVERNANCE §8 index ile uyumlu
- [x] **Teknik karar kayıtları** — **7 yeni ADR yazıldı** (0014-0020):
  - 0014: Pagination (Cursor vs Offset) — SPEC §22.2
  - 0015: Optimistic Lock (version + If-Match) — SPEC §0.5
  - 0016: Audit Log (RLS + immutable) — SPEC §27.3
  - 0017: Hata Sözleşmesi (code zorunlu, AppError) — SPEC §22.1
  - 0018: Sıralama/Filtreleme (sort, filter, q) — SPEC §22.2
  - 0019: Timezone (Europe/Istanbul, tenant bazlı) — SPEC §4.4
  - 0020: Mimari (Modüler Monolit, Paylaşılan Kernel) — SPEC §1.2
  - Tüm ADR GOVERNANCE §8 index'e eklendi
- [x] **Ücretsiz paket kapsamı ve limitleri** (K-02) — **onaylandı**: Cari 500, Stok 200, Ayda 100 import satırı, 1 özel rol

### Monorepo İskelet
- [x] `apps/site`, `packages/ui`, `packages/shared`, `packages/db`, `apps/api`, `apps/worker`, `apps/web` (iskelet); npm workspaces; `tsconfig.base.json` strict
- [x] ESLint + Prettier: flat config (`consistent-type-imports`, `prefer-const`, `no-var`), `.prettierrc` (astro plugin), PR kapısı CI'da (`lint` + `format:check`)
- [x] `apps/api` iskeleti (Express 4): Zod `env.ts` ("eksikse uygulama başlamaz"), request ID, pino-http (gizli veri maskeleme), helmet/cors, hata sözleşmesi (SPEC §22.1), `/healthz`, `/readyz`; supertest ile **9/9 test**
- [x] `apps/worker` iskeleti (BullMQ): kuyruk adları tek yerden, graceful shutdown; handler tanımları Faz 1+
- [x] `apps/web` iskeleti (Vue 3 + Vite + Pinia + Vue Router + Tailwind + PWA — ADR-0012): router iskeleti, i18n iskeleti, config, HomeView; PWA manifest; **typecheck geçiyor**
- [x] Kök `.env.example` (README §12.3, `POSTGRES_PORT` dahil), `dev` scripti (concurrently: api + worker)
- [x] CI iş akışı `.github/workflows/ci.yml`: lint → format → governance → typecheck → test → **Postgres servisli izolasyon testi** → build → bundle bütçesi

### Altyapı İskeleti
- [x] `docker-compose.yml`: PostgreSQL 16, Redis, MinIO, Mailpit + `01-roles.sql` (3 rol, idempotent — DO $$, CI psql adımında da kullanılır)
- [x] **docker postgres canlı doğrulandı** (bu makinede: port çakışması tespit edilip `POSTGRES_PORT` parametresi eklendi; 3 rol NOBYPASSRLS ✓)
- [x] **RLS iskeleti canlı yeşil:** `202610050000_rls_skeleton.sql` (down SQL'li) migrate runner ile uygulandı; `withTenant()` (`set_config` transaction-local) + "A, B'nin satırını göremez" testi **canlı DB'de geçti (4/4)**
- [x] Migration altyapısı: `YYYYMMDDHHMM_<slug>.sql` adlandırma + zorunlu down SQL + `schema_migrations` (up/down/status)
- [ ] Drizzle şema üretimi (`drizzle-kit generate` — ilk gerçek şema Faz 1'de)
- [x] Ortak altyapı (tamamı): request ID ✓ (api), pino ✓ (api+worker), merkezi hata sözleşmesi ✓ (SPEC §22.1, AppError)
- [x] `packages/shared`: id (UUID v7 — `uuidv7`), money (decimal.js), tr (NFC/collator/tr-TR uppercase), TCKN/VKN/IBAN/telefon/posta kodu + test vektörleri (vitest)
- [x] Hata kodu iskeleti: `packages/shared/src/errors/codes.ts` (docs/api/error-codes.md ile eşleşir)
- [ ] Tasarım sistemi başlangıcı: Button, Input, MoneyInput, DataTable, Drawer, Modal, EmptyState
- [x] Mock sağlayıcılar: e-Dönüşüm (`EDocumentPort` + `MockEInvoiceProvider` — SPEC §21.1/§29.1)

### Süreç
- [ ] SMMM danışman + golden test envanteri (Ek B) — **dış bağımlılık**
- [x] CI GOVERNANCE kural kontrolü: `scripts/governance-check.mjs` (tablo ↔ modül kodu, permission formatı, FLOAT/DOUBLE yasağı)
- [x] Preview environment (Cloudflare Pages preview) — ⏸ **ertelendi** (hesap yok; blokaj değil)
- [x] Bundle-size CI kontrolü: `scripts/bundle-budget.mjs` (initial < 250 KB gzip, route chunk < 100 KB)
- [x] **axe-core (a11y) CI adımı** — `scripts/a11y-check.mjs` (`npm run test:a11y`); gerçek Chrome ile **29/29 sayfa WCAG 2.1 AA temiz**; CI'ya Chromium kurulumuyla eklendi
- [x] docs/ iskelet klasörleri: api/, operations/, legal/, product/, product/import-templates/, brand.md, archive/ — `docs/` altına taşındı

### Faz 0 Çıkış Kapısı
- [ ] CI yeşil (GitHub Actions'ta ilk çalıştırma gerekli — workflow Postgres + Chromium servisli hazır)
- [x] **"npm run dev iki süreci başlatıyor" kanıtı (canlı):** api `/healthz` → 200 `{"status":"ok"}`, `/readyz` → 200; worker BullMQ kuyruklarıyla ayağa kalktı (3000 portu + node süreçleri doğrulandı). web henüz yok → üç süreç Faz 2'de.
- [ ] Staging deploy — **altyapı hesabı gerekli**
- [x] **"Tenant A, tenant B'nin verisini okuyamaz" testi (Faz 1 RLS ile)** — canlı DB'de 4/4 test geçti
- [x] `docs/brand.md` (ad: Kuleplus; renk/domain TBD)
- [x] docs/api/, docs/product/, docs/legal/ (6 şablon), docs/operations/ (3), docs/product/import-templates/ (4), docs/archive/
- [x] **Kullanıcı onayı alındı (8 Ekim 2026)** — Faz 0 çıkış kapısı kapatıldı

---

## ✅ FAZ 1 — TAMAMLANDI (kullanıcı onayı: 8 Ekim 2026) → **Faz 2 onaylandı**
- [x] Veritabanı şeması (migration + down + seed) — K-02 limitleri dahil
- [x] RLS izolasyon testleri canlı yeşil (4/4)
- [x] **UUID v7 kuralı uygulandı:** migration'lardaki `DEFAULT gen_random_uuid()` kaldırıldı (SPEC §0.1 / ADR-0002); CI'da `governance-check` zorlar
- [x] API: Kimlik — kayıt/giriş/refresh rotation/şifre sıfırlama, Argon2id, kilitlenme koruması (`apps/api/src/modules/identity/`)
- [x] API: Şirket — başvuru + tek transaction onay (`apps/api/src/modules/company/service.ts`)
- [x] API: Yetki — davet (7 gün, hash'li), roller, izinler, departman, Owner transferi (`apps/api/src/modules/authorization/`)
- [x] API: **Entitlement motoru** — `requireModule`/`checkLimit`/`incrementUsage` (`apps/api/src/modules/entitlement/service.ts`)
- [x] API: Audit + outbox + e-posta servisi (`apps/api/src/modules/audit`, `modules/outbox`, `services/email.ts`)
- [x] Permission kataloğu tek kaynağı: `packages/shared/src/permissions.ts` (22 izin) ↔ `docs/api/permissions-catalog.md`
- [x] OpenAPI sözleşmesi: `docs/api/openapi.yaml` — **40 uç, geçerli** (`@redocly/cli lint` → "valid"); path parametreleri, 2FA uçları, company admin uçları dahil (ADR-0013 — Zod'dan üretim CI adımı sıradaki)
- [x] **Tüm modül rotaları `app.ts`'e bağlı** — auth, company, entitlements, authorization (`/api/v1/authorization`), audit
- [x] **Faz 1 servis testleri** — identity (16), company (9), authorization (9), entitlement (5), platform (9), e2e akış (2); worker handler (5). Toplam **137 test yeşil**
  - ⚠ Tespit edilen ve düzeltilen bug: `company/service.ts` onay akışı `tenant_settings`'e var olmayan (`onboarding_mode`, `settings`) kolonlarını yazıyordu → gerçek şemaya (`key`/`value`/`locked`) çevrildi; regresyon testi eklendi
  - ⚠ Tespit edilen ve düzeltilen bug: seed `legal_texts` INSERT'ü `id` vermiyordu (default yok → çöker); deterministik UUID v7 değerleri eklendi
  - ⚠ Tespit edilen ve düzeltilen bug: `drizzle-kit` introspect çıktısı (`packages/db/drizzle/`, `gen_random_uuid` içeren) projeye sızmıştı; governance'ı kırıyordu → kaldırıldı + `.gitignore`
- [x] **Worker outbox/e-posta handler tanımları** — `apps/worker/src/handlers.ts` (email-send + outbox-dispatch), idempotency (jobId=outboxId), 3 deneme + exponential backoff; `startWorker` DIP ile handler bağımlılığı alıyor
- [x] **Hata kodları düzeltildi:** kayıt/başvuru/davet çakışmaları yanlışlıkla `PERIOD_LOCKED` (accounting) yerine yeni **`CONFLICT`** (409, core) kodunu kullanıyor; `codes.ts` + `error-codes.md` + ADR-0017 + openapi.yaml senkron; regresyon testleri kesin kod kontrolüne çevrildi
- [x] **API: Platform paneli v0** — `apps/api/src/modules/platform/` (+ `middleware/platform.ts`): platform kullanıcı doğrulama, `platform_owner`/rol kapıları, başvuru inceleme, tenant listesi/detayı/durum, destek grant (gerekçe+süre+audit), platform denetim
- [x] **Platform migration:** `202610090000_platform_tables.sql` (+down) — `platform_users` (tek owner kısmi unique index), `platform_roles`+`platform_user_roles`, `platform_settings` (key-value), `support_access_grants` (+RLS)
- [x] **Mojibake/BOM temizliği:** `openapi.yaml` bozulmuştu (`Yetki â€”`); `scripts/fix-docs-encoding.mjs` `.yaml`'ı kapsayacak + BOM temizleyecek şekilde genişletildi; tüm `docs/` temiz

### Faz 1 Kabul Kriterleri Kanıt Eşlemesi (ROADMAP §4)
| Kriter | Durum | Kanıt |
|--------|-------|-------|
| İzolasyon: başka tenant verisi okunamaz | ✅ | RLS testleri 4/4 (canlı DB) |
| Eşzamanlılık: aynı başvuru iki kez onaylansa tek tenant | ✅ | `FOR UPDATE` + status kontrolü + `company.test.ts` |
| Yetki: rol düşürülmesi mevcut oturumda etkili | ✅ | `auth_version` (migration 202610100000) + JWT gömme + `removeUserRole` bump + test |
| Dayanıklılık: e-posta kapalı olsa kurulum yarım kalmaz | ✅ | Onay transaction'ı outbox'a yazar, göndermez + `company.test.ts` |
| Paket kilidi: kilitli modül MODULE_NOT_ENTITLED | ✅ | `requireModule` + e2e akış testi |
| Platform güvenliği: grant'sız erişim yok, kullanım audit'li | ✅ | `platform.test.ts` + `readTenantDataWithGrant` |
| **e2e: kayıt → başvuru → onay → davet → rol → kilitli modül** | ✅ | `apps/api/tests/e2e-flow.test.ts` |
| İzolasyon + entitlement testleri CI'da zorunlu | ✅ | `ci.yml` Postgres adımı |
| `legal_texts`/`legal_acceptances` global (tenant_id yok) | ✅ | `202610050001_core_schema.sql` |
| Kayıt akışında KVKK kabulü `legal_acceptances`'e yazılır | ✅ | `identity/service.ts` + `registerSchema.acceptTerms` + test |

- [x] **Kullanıcı onayı alındı (8 Ekim 2026)** — Faz 1 çıkış kapısı kapatıldı; Faz 2 geçişi onaylandı

## 🔄 FAZ 2 — Ücretsiz Çekirdek (AKTİF)
- ⚠ **Bulgu:** `apps/api/src/modules/contacts/` ve `modules/stock/` servisleri + testleri (`contacts.test.ts`, `stock.test.ts`) zaten yazılmış — TODOS bunu göstermiyordu. Kapsam doğrulanıp ROADMAP Faz 2 iş listesiyle eşleştirilmeli.
- [ ] İçe/dışa aktarma sihirbazı (kolon eşleştirme → dry-run → hata raporu → onay → batch)
- [ ] UX kabuğu (responsive, şirket seçici, modül bazlı navigasyon, drawer akışları)
- [ ] PWA (manifest + service worker; çevrimdışı finansal kesinleştirme YOK)
- [ ] Patron Görünümü v1, boş durum ekranları, kilitli modül önizlemesi
- Detay ROADMAP §4 — site tarafı yukarıda tamam ✅

---

## ⚠ Bekleyen Kararlar / Blokajlar
**Tam liste ve işaretlenebilir karar formu:** `docs/operations/pending-decisions.md`

| Karar | Durum |
|-------|-------|
| K-02 Ücretsiz plan limit sayıları | ✅ **Onaylandı** — Cari 500, Stok 200, Ayda 100 import satırı, 1 özel rol |
| Fiyatlandırma (₺ tutarlar) | Faz 4'te netleşecek; site `TBD` gösteriyor |
| brand.md: renk paleti | ✅ **Dolu** — "Executive Trust" paleti + logo notları (`docs/brand.md`) |
| brand.md: domain, destek e-postası | ⏳ Kullanıcı kararı — kişisel e-posta sızıntısı temizlendi |
| Hosting bölgesi (TR) — K-12 | KVKK için kritik; karar verildi |
| SMMM danışmanlığı, golden test | Dış kişi/şirket — Faz 2 sonrası ertelendi |

## 📌 Bu oturumda düzeltilen doküman↔kod tutarsızlıkları (7 Ekim 2026)
| # | Tutarsızlık | Çözüm |
|---|-------------|-------|
| 1 | Migration'lar `DEFAULT gen_random_uuid()` (v4) kullanıyordu — SPEC §0.1/ADR-0002 ihlali | 4 dosyada 18 default kaldırıldı; `governance-check`'e yasak eklendi |
| 2 | `governance-check` kırmızıydı (4 tablo GOVERNANCE §2'de yok) | `tenant_user_roles`, `tenant_user_departments`, `password_reset_tokens`, `email_outbox` §2'ye eklendi; `tenant_applications` yinelenmesi kaldırıldı — check **yeşil** |
| 3 | `packages/shared/permissions.ts` dokümanlarda "tek kaynak" deniyordu ama yoktu | Oluşturuldu (22 izin, format doğrulayıcı); `docs/api/permissions-catalog.md` senkronlandı |
| 4 | `docs/api/openapi.yaml` ADR-0013'te referanslı ama yoktu | Faz 1 uçlarını içeren sözleşme oluşturuldu |
| 5 | `docs/legal/data-inventory.md` KVKK aydınlatmadan referanslı ama yoktu | Veri envanteri + saklama matrisi oluşturuldu (SPEC §27.5 seed uyumlu) |
