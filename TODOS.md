# TODOS.md — İlerleme Kaydı

**Amaç:** ROADMAP v5.1.0'a göre ilerlemeyi, tamamlananları ve sıradaki adımları takip etmek.
**Son güncelleme:** 14 Ekim 2026
**Durum:** Faz 0–3 · 5 · 6 · 8 ✅ tamamlandı · **Faz 4 (e-Dönüşüm) 🔄** · **Faz 7 (patron deneyimi/frontend) 🔄** devam

**İlgili dokümanlar:** `docs/ROADMAP.md` · `docs/GOVERNANCE.md` · `docs/TECHNICAL_SPEC.md` · `readme.md`

---

## ✓ Tamamlananlar

### Faz 4 Hat B — Abonelik & Faturalama (bu oturumda)
- [x] **Şema: `202610350000_subscription_billing.sql` (+down)** — 16 tablo: `module_dependencies`, `subscriptions`, `subscription_items`, `subscription_changes`, `commercial_orders`, `commercial_order_items`, `payment_attempts`, `billing_payments`, `billing_invoices`, `billing_invoice_lines`, `provider_webhook_events`, `coupons`, `coupon_redemptions`, `partners`, `partner_referrals`, `partner_commissions`. 12 tenant tablosu RLS + `<tablo>_tenant_isolation` politikası (DO blokla), `app_user` grant'leri, UUID v7 uygulama tarafında. **Canlı DB'ye uygulandı** — doğrulandı: 16/16 tablo, 12 RLS + 12 politika, 64 grant.
- [x] **`modules/subscription/` — tek kaynak mimarisi** — `resources.ts` kolon/kayıt tanımları hem servis sürücüsünü hem Zod şemalarını besler (`schemas.ts` → `createSchemaFor`/`updateSchemaFor`/`schemaMap`); rota ↔ servis ↔ şema ayrışamaz. Durum sözlükleri migration `CHECK`leriyle birebir.
- [x] **`SubscriptionService` tablo sürücüsü** — `listResource`/`getResource`/`createResource`/`updateResource`/`deleteResource`: sütun whitelist'i + `assertIdentifier` (SQL enjeksiyon koruması), tenant/küresel (`coupons`, `partners`) ve alt kaynak (`parentColumn`) kapsamları, sayfalama, yazma işlemlerinde AYNI transaction'da `audit_logs` kaydı.
- [x] **Checkout zinciri (SPEC §8.6)** — `POST /api/v1/subscription/checkout`: sipariş `pending` olmalı (çift tahsilat engeli) → plan fiyatı (`prices`, K-03'e kadar `amount_monthly`) → `PaymentProvider.charge` (idempotency: `orderId:provider`; **harici I/O transaction dışında**) → sonuç TEK transaction'da: `payment_attempts` → `billing_invoices` + `billing_invoice_lines` → `billing_payments` → abonelik (yoksa açılır, varsa periyodu yenilenir) → `subscription_items` + **`tenant_entitlements` aktivasyonu** (plan modülleri) → `subscription_changes` → sipariş `paid`. Kart reddi: attempt `failed` + sipariş `failed`, fatura oluşmaz. Para `MoneyString` (float yok).
- [x] **Webhook altyapısı** — `POST /api/v1/subscription/webhooks/:provider`: `provider_webhook_events` `ON CONFLICT DO NOTHING` (idempotent) + `payment.succeeded` → ilgili deneme/sipariş ileri alınır. Ayrıca **imzalı kamu ucu** `POST /api/v1/subscription/webhooks/public/:provider` (K-08, `X-IYZ-SIGNATURE-V3`, fail-closed 401) artık mevcut; bu elle-replay ucu kimlik + tenant bağlamlı.
- [x] **REST uçları (`/api/v1/subscription`)** — `mountResource()` ile: `/subscriptions` (+ `/:id/items`, `/:id/changes`), `/orders` (+ `/:orderId/items`), `/payment-attempts`, `/payments`, `/invoices` (+ `/:invoiceId/lines`), `/coupons` (+ `/:couponId/redemptions`), `/partners` (+ `/:partnerId/referrals`, `/:partnerId/commissions`). Statik yollar kök `/:id`'den önce bağlanır (Express sıra kuralı).
- [x] **İzinler** — `subscription.subscription.{read,create,update,delete,manage}`: `packages/shared/src/permissions.ts` (tek kaynak) + migration katalog senkronu (`ON CONFLICT DO UPDATE`) + `docs/api/permissions-catalog.md`; down'da `DELETE` ile geri alınır.
- [x] **Testler: `tests/subscription.test.ts` (12)** — CRUD (tenant kapsamı, global kaynak, alt kaynak filtresi, whitelist sızdırmazlığı, NOT_FOUND/VALIDATION_ERROR) + checkout (sipariş yok / `pending` değil / fiyat yok / tahsilat başarılı / kart reddi) + webhook (uygulanan ve yinelenen olay).
- [x] **Doğrulama:** `typecheck` ✓ · `eslint` ✓ · `prettier` ✓ · `governance:check` ✓ (14 modül, 156 tablo) · testler **api 206**, tüm paketler yeşil.
- [x] **İade + fatura/alacak eşleştirme (`billing_refunds`, `billing_allocations`)** — migration `202610360000_subscription_refunds.sql` (+down): iki tablo RLS + grant'lerle; `billing_payments` durum CHECK'i SPEC §8.7 sözlüğüne genişletildi (`partially_refunded`/`refunded`/`disputed`). **Canlı DB'ye uygulandı.**
- [x] **`refundPayment` (kısmi/tam iade)** — ödeme `succeeded`/`partially_refunded` olmalı → kalan tutar `billing_refunds` toplamından hesaplanır (çift iade engeli) → `PaymentProvider.refund` (**harici I/O transaction dışında**) → TEK transaction: iade kaydı + ödeme durumu (`refunded`/`partially_refunded`) + tam iadede sipariş `refunded` + audit. Uç: `POST /api/v1/subscription/payments/:paymentId/refunds`.
- [x] **`allocatePayment` (alacak eşleştirme, SPEC §8.6)** — `issued` fatura ↔ başarılı ödeme; toplam eşleştirme fatura bakiyesini aşamaz, para birimi uyuşmazlığı reddedilir, kalan bakiye döner. Checkout artık tahsilatı kestiği faturaya **otomatik eşleştirme** satırı yazar. Uç: `POST /api/v1/subscription/payments/:paymentId/allocations`.
- [x] **Webhook `refund.succeeded`** — async iade onayı: `billing_refunds` `pending` → `succeeded` (yinelenen olay ikinci iade üretmez).
- [x] **Testler: `tests/subscription.test.ts` (22)** — önceki 12 + iade 6 (ödeme yok / durum yanlış / bakiye kalmamış / tutar aşımı / tam iade / kısmi iade) + eşleştirme 4 (fatura yok / bakiye kalmamış / başarılı + audit / checkout eşleştirmesi).
- [x] **Doğrulama (bu adım):** `typecheck` ✓ · `eslint` ✓ · `prettier` ✓ · `governance:check` ✓ (14 modül, 156 tablo) · testler **api 216** (önce 206).
- [x] **K-08 sanal POS (gerçek ödeme sağlayıcısı: iyzico)** — `packages/shared/src/integrations/iyzico-payment.ts`: `IyzicoPaymentProvider` `PaymentProvider` sözleşmesini uygular (mock ile Liskov — `PAYMENT_PROVIDER` ile seçilir). **IYZWSv2** kimlik doğrulama (imza = HMAC-SHA256(randomKey + uri.path + body, secretKey).hex → `Authorization: IYZWSv2 base64(...)`, `x-iyzi-rnd` başlığı) + **`X-IYZ-SIGNATURE-V3`** webhook imzası (merchantId + secretKey + eventType + subRef + orderRef + customerRef, timing-safe). Kart PAN/CVV porttan geçmez (iyzico hosted akış). HTTP katmanı `fetchImpl` injecte (birim testler ağsız). **Canlı sınır:** sandbox anahtarı + iyzico'da `pricingPlanReferenceCode` tanımı Faz 4 çıkış kapısında.
- [x] **Env + provider seçimi (fail-fast)** — `createPaymentProvider(env)`: `PAYMENT_PROVIDER=mock|iyzico|manual`; `iyzico` seçiliyse `IYZICO_API_KEY`/`IYZICO_SECRET_KEY`/`IYZICO_PRICING_PLAN_REF` zorunlu (eksikse açık hata). `manual` = havale/EFT (şimdilik mock, imzalı webhookla aynı zincir). `.env.example` güncellendi; `env.ts` Zod doğrulaması.
- [x] **İmzalı kamu webhook ucu (SPEC §22.1)** — `POST /api/v1/subscription/webhooks/public/:provider` (JWT'siz; iyzico auth'suz çağırır): ham gövde üzerinde imza doğrulanır, geçersizse **fail-closed 401** (bozuk/yok imza reddedilir). `provider_webhook_events` `ON CONFLICT DO NOTHING` (idempotent) → `payment.succeeded` zinciri. **Canlı kanıt:** imzasız/bozuk/yanlış-secret isteklerin üçü de 401 döndü.
- [x] **Testler:** `packages/shared/tests/iyzico-payment.test.ts` (15 — auth header formülü, webhook imza doğru/bozuk/eksik, parseWebhook status eşlemesi, HTTP istek şekli) + `apps/api/tests/payment-provider.test.ts` (7 — env seçimi, fail-fast). API **337/337** · shared **63/63**.
- [x] **Doğrulama (K-08):** `typecheck` ✓ · `eslint` ✓ · `prettier` ✓ · `governance:check` ✓ (14 modül, 157 tablo) · canlı API 4000 + web 5173 ayakta.
- ⏳ **Bekleyenler (Faz 4 kalanı):** K-03 fiyat kararının `prices` satırlarına yazılması, **canlı** ödeme testi (sandbox iyzico anahtarı + iyzico panelinde fiyatlandırma planı), **canlı** e-Dönüşüm test faturası, dunning/başarısız ödeme yeniden deneme, platform e-Arşiv faturası otomasyonu, ortak (SMMM) komisyon akışı UI, gelir paneli **web** ekranı (API hazır: `/api/v1/platform/metrics`).

### Faz 5 (Muhasebe) + Faz 2 (Public İletişim) — bu oturumda tamamlananlar
- [x] **TDHP hesap planı genişletildi** — `apps/api/src/modules/accounting/tdhp.ts` 49 → **~260 hesap** (1 Dönen + 2 Duran Varlık, 3/4 Yabancı Kaynak, 5 Öz Kaynak, 6 Gelir Tablosu, 7 Maliyet). Önceki şablon 199'da kesiliyordu → bilanço/gelir tablosu ve otomatik muhasebeleştirme imkânsızdı. `ensureChartOfAccounts` idempotent bootstrap korundu.
- [x] **Muhasebe raporları** — `AccountingService.trialBalance` (mizan), `balanceSheet` (bilanço), `incomeStatement` (gelir tablosu). Yalnızca `posted` fişler; hesap kodu ilk hanesine göre sınıflama; bilanço aktif=pasif dengesi (dönem sonucu dahil). Uçlar: `GET /api/v1/accounting/reports/{trial-balance,balance-sheet,income-statement}`. Testler: `tests/accounting.test.ts` (+3).
- [x] **`POST /api/v1/public/contact`** (pazarlama sitesi iletişim formu) — `apps/api/src/modules/public/routes.ts`; gövde Zod doğrulaması + HTML kaçışlama (XSS) + `email_outbox` kuyruğu → e-posta. `app.ts`'e mount edildi. Testler: `tests/public.test.ts` (3).
- [x] **`email_outbox.provider_ref` latent bug düzeltmesi** — kolon NOT NULL iken `OutboxService.enqueue` null yazıyordu (canlı DB'de parola sıfırlama e-postası patlardı) → gönderim öncesi `''` yazılır.
- [x] **Doğrulama:** `typecheck` ✓ · `eslint` ✓ · `governance:check` ✓ (14 modül) · testler **api 183**, toplam yeşil.

### Faz 3/5 — Otomatik Muhasebeleştirme (bu oturumda tamamlananlar)
- [x] **`invoices.posting_status`** (Faz 3 eksikliği) — migration `202610330000_invoice_posting_status.sql` (+down): `posting_status` (draft/posted/cancelled) + `posted_at`. Kesinleştirme, tahsilat durumundan (`status`) AYRI izlenir (SPEC §12.2). **Canlı DB'ye uygulandı.**
- [x] **Fatura → otomatik yevmiye fişi** — `InvoiceService.postInvoice` (çek modülü deseni): hesap eşleme `account_mappings` → TDHP kodu fallback (satış: 120/600/391, alış: 320/153/191); denge servis tarafında zorlanır; gap-free fiş no (`pg_advisory_xact_lock`); kapalı dönem → `PERIOD_LOCKED`; kaynak (`source_type='invoice'`, `source_id`) ile **idempotent**. Rota: `POST /api/v1/invoices/:id/post` (`trade.invoice.approve` izni). Testler: `tests/invoice-posting.test.ts` (4).
- [x] **`ledger-reconciliation` rapor mantık hatası düzeltildi** — önceki sorgu tüm satırları topladığından dengeli fişte `debit-credit=0` çıkıp **her faturayı "işlenmemiş"** gösteriyordu; artık kontrol hesabı (satış→120 / alış→320) üzerinden mutabakat yapılıyor.
- [x] **Doğrulama:** `typecheck` ✓ · `eslint` ✓ · `governance:check` ✓ · testler **api 187**, toplam yeşil.

### Faz 3/5 — Tahsilat/Ödeme Muhasebeleştirmesi + TDHP Bootstrap (bu oturumda)
- [x] **Tahsilat/ödeme → yevmiye fişi** — `InvoiceService.addPayment` içinde: satış tahsilatı → Borç kasa/banka, Alacak 120; alış tediye → Borç 320, Alacak kasa/banka. Ödeme yöntemi → kasa/banka hesabı (`account_mappings` 'cash'/'bank' → TDHP fallback: nakit 100, havale 102, çek 101/103, kart 108). `source_type='invoice_payment'`, gap-free no, dönem kilidi. `addPayment` artık `userId` alır. Testler: +2.
- [x] **TDHP otomatik bootstrap** — `modules/accounting/chart.ts` → `ensureChartOfAccountsOn(client)`; fatura kesinleştirme/tahsilat, hesap planı boşsa (~260 hesap) aynı transaction'da otomatik kurar. `AccountingService.ensureChartOfAccounts` bu yardımcıyı kullanacak şekilde refactor edildi. Testler: +1.
- [x] **Doğrulama:** `typecheck` ✓ · `eslint` ✓ · `governance:check` ✓ · testler **api 190**.

### Faz 1/3/5 — Idempotency-Key (bu oturumda)
- [x] **`Idempotency-Key` middleware** (`middleware/idempotency.ts`) — SPEC §22.2. Finansal kesinleştirme uçlarında zorunlu; aynı key ile ikinci istek **409** `IDEMPOTENCY_KEY_CONFLICT`. Kayıt istek transaction'ında (tenant scope, RLS) yazılır: başarılı istek COMMIT → çift işlem engellenir; başarısız istek ROLLBACK → yeniden denemeye izin verilir (commit yarışı yok). Migration `202610340000_idempotency_keys.sql` (+down, GOVERNANCE §2 `core`). **Canlı DB'ye uygulandı.** Uygulandığı uçlar: `POST /api/v1/invoices/:id/post`, `POST /api/v1/invoices/:id/payments`. Testler: `tests/idempotency.test.ts` (4).
- [x] **Doğrulama:** `typecheck` ✓ · `eslint` ✓ · `governance:check` ✓ (156 tablo) · testler **api 194**.

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
- ~~Drizzle şema üretimi (`drizzle-kit generate`)~~ — **geçersiz:** şema `packages/db/migrations/*.sql` ile yönetiliyor (introspect çıktısı Faz 1'de kaldırıldı, ADR-0002/SPEC §0.1).
- [x] Ortak altyapı (tamamı): request ID ✓ (api), pino ✓ (api+worker), merkezi hata sözleşmesi ✓ (SPEC §22.1, AppError)
- [x] `packages/shared`: id (UUID v7 — `uuidv7`), money (decimal.js), tr (NFC/collator/tr-TR uppercase), TCKN/VKN/IBAN/telefon/posta kodu + test vektörleri (vitest)
- [x] Hata kodu iskeleti: `packages/shared/src/errors/codes.ts` (docs/api/error-codes.md ile eşleşir)
- [x] **Tasarım sistemi başlangıcı: Button, Input, MoneyInput, DataTable, Drawer, Modal, EmptyState — hepsi `packages/ui/src/index.ts`'ten export edilir** (8 Ekim 2026).
  - `packages/ui`'ya **test altyapısı kuruldu:** `vitest.config.ts` (jsdom + @vue/plugin-vue), `tsconfig.json`, `typecheck` (vue-tsc) scripti. **32 test** (6 dosya: Button 7, Modal 7, Input 6, MoneyInput 5, Drawer 4, EmptyState 3).
  - **Bulunan ve düzeltilen 4 gerçek bug:** (1) `Button` tüm varyant sınıflarını aynı anda uyguluyordu (nesne dizi elemanı olarak geçiliyordu → `computed` ile tekleştirildi); (2) `Button`/`Input`/`MoneyInput` `$$props.class` kullanıyordu (Vue 3 setup'ta yok → `$attrs.class` + `inheritAttrs: false`); (3) `Input`/`MoneyInput` şablonunda `<slot>` + `<span v-else>` kardeşlik ihlali → derleme hatası, slot default içeriğine çevrildi; (4) `Modal`/`Drawer` `watch`'ında `immediate: true` yoktu → `open=true` ile başlayınca Escape/gövde kilidi çalışmıyordu.
  - `packages/ui` typecheck scripti `vue-tsc`'e çevrildi (`.vue` SFC'leri `tsc` göremez).
- [x] Mock sağlayıcılar: e-Dönüşüm (`EDocumentPort` + `MockEInvoiceProvider` — SPEC §21.1/§29.1)

### Süreç
- [x] **SMMM golden test envanteri (Ek B)** — `apps/api/tests/golden/golden.test.ts`: 18 senaryo iskeleti (Cari/Tahsilat 4, Fatura/Vergi 7, Muhasebe 4, Stok/Maliyet 3) hazır, 18/18 test yeşil. Beklenen sayısal değerler SMMM imzasıyla doldurulacak — imzalanmamış senaryo Faz 5 kapatılamaz. **Dış bağımlılık: SMMM imzası.**
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

## ✅ FAZ 6 — İleri Finans (Tamamlandı)
- [x] **Çek/Senet (cheque) modülü** — `apps/api/src/modules/cheque/`: create, read, update, delete, endorse, collect, bounce, cancel, portfolio summary, due calendar, transactions, journal integration (ROADMAP §Faz 6, SPEC §10). Tablolar: `cheques`, `cheque_transactions`, `cheque_portfolio`.
- [x] **Gelişmiş Raporlar (reports_plus) modülü** — `apps/api/src/modules/reports_plus/`: Canlı overview, sales/purchases/expenses/stock/cash-bank/profit-loss/tax-summary raporlar, KDV hazırlık (§6.4), belge-defter mutabakatı (§6.4), Ba-Bs raporu (§6.5), cari mutabakat mektubu (§6.5), nakit akış tahmini (§6.10). Tablolar: `report_generations`.

## 🔄 FAZ 7 — Yönetim Paketi ve Patron Deneyimi (Backend Çekirdeği Tamamlandı)
- [x] **Yönetim Paketi (management) backend modülü** — `apps/api/src/modules/management/`: görev (CRUD + ata + tamamla), hatırlatıcı (oluştur/ertele/iptal), takvim + takvim etkinliği, randevu (durum: pending/confirmed/completed/cancelled/no_show), not, aktivite akışı, bildirim platformu (notifications + deliveries), kullanıcı cihazları ve bildirim tercihleri. SPEC §16, §17.
- [x] **Migration + RLS** — `packages/db/migrations/202610290000_management.sql` (11 tablo: `tasks`, `reminders`, `calendars`, `calendar_events`, `appointments`, `notes`, `activities`, `notifications`, `user_devices`, `notification_deliveries`, `notification_preferences`) + down dosyası. 11/11 tablo RLS aktif, doğrulandı.
- [x] **Permission kataloğu** — `packages/shared/src/permissions.ts`'e 21 `management.*` izni eklendi; migration permission senkronu ile DB'ye yazıldı (21 satır).
- [x] **Rota kaydı** — `app.ts`'e `/api/v1/management` eklendi; tüm uçlar `requireEntitlement('management')` + izin kapılarıyla korunuyor.
- [x] **Doğrulama** — `governance:check` temiz (14 modül, 153 tablo), `tsc --noEmit` temiz (api + shared), `eslint` temiz; migration canlı DB'ye uygulandı.
- [x] **Platform Paneli v0** — `apps/api/src/modules/platform/`: platform kullanıcı doğrulama, rol kapıları, başvuru inceleme, tenant listesi/detayı/durum, destek grant (gerekçe+süre+audit), platform denetim (platform modülü; `management`'ten ayrıdır).
- [x] **Patron paneli frontend'i (görev/randevu/bildirim)** — `stores/management.ts` (görev/randevu/bildirim katmanı), `ManagementTasksView.vue` (`/management/tasks`: filtre + oluştur + tamamla + sil), `ManagementAppointmentsView.vue` (`/management/appointments`: filtre + oluştur + durum akışı), `ManagementNotificationsView.vue` (`/management/notifications`: liste + okunmamış filtresi + okundu işaretle). Router + `App.vue` "Yönetim" nav grubu (module: `management`). `vue-tsc` temiz.
- [x] **Patron Görünümü v3 — trafik ışığı göstergeleri** — backend: `modules/management/dashboard.service.ts` + `GET /api/v1/management/dashboard` ucu (kural bazlı: vadesi geçen alacak, kritik stok, çek vadesi, olağandışı gider; yapay sağlık skoru yok — SPEC §26). İzin: `management.dashboard.read` (`packages/shared/src/permissions.ts` + migration `202610300000_management_dashboard.sql`, DB'ye uygulandı). Frontend: `DashboardView.vue` durum göstergeleri bölümü + `useManagementStore.dashboard` (403'te sessizce gizlenir). `governance:check` + `tsc` (api+shared+web) + `eslint` temiz.
- [x] **Günlük/haftalık özet e-postası (Faz 7)** — worker `management-digest` kuyruğu + `createDigestHandler` (`apps/worker/src/handlers.ts`): her aktif tenant'ın sahibine (`tenant_users.is_owner`) günlük/haftalık özet üretir; gövde dashboard ile **aynı kural motorundan** (`buildDashboardSummary` — paylaşılan kernel) gelir, böylece "dashboard tutarı ile özet aynı kuralları kullanır" (ROADMAP kabul kriteri). Zamanlama: BullMQ `upsertJobScheduler` — günlük **08:00**, haftalık **pazartesi 08:00** (`Europe/Istanbul`, T-7.3/ADR-0019). E-posta mevcut `email_outbox` → outbox→email akışıyla gönderilir (SPEC §19.1). Idempotent: aynı gün/hafta aynı alıcıya tekrar kuyruğa yazılmaz (ADR-0020). **Paylaşılan kernel refactor'ı:** kural tanımları (`packages/shared/src/management/rules.ts`), kural değerlendirme (`indicators.ts`), özet biçimlendirme (`digest.ts`) ve e-posta şablon motoru (`packages/shared/src/email/templates.ts`) `@kuleplus/shared`'e taşındı; API dashboard/kural ayarları aynı kaynaktan beslenir (ADR-0020). ⚠ **Latent bug düzeltildi:** `queueEmailTemplate` (`apps/api/src/services/email-templates.ts`) NOT NULL `provider_ref` kolonuna `NULL` yazıyordu (tüm şablon e-postaları patlardı) → `''` (OutboxService düzeltmesiyle hizalı). Doğrulama: canlı smoke (oluştur / idempotency / haftalık / temizlik) + `tsc` (shared+api+worker) + `eslint` + `prettier` + `governance:check` (14 modül, 155 tablo) temiz; worker **12/12**, shared **35/35** test yeşil.
- [x] **Onay kutusu (Faz 7: ödeme limiti, fatura iptali, fiş onayı)** — `modules/management/approval.service.ts` (`ApprovalService`) + `approval_requests` tablosu (migration `202610330000_management_approvals.sql`, RLS, GOVERNANCE §2). Uçlar: `GET /api/v1/management/approvals`, `GET /approvals/pending-count`, `GET /approvals/:id`, `POST /approvals`, `POST /approvals/:id/decide`, `POST /approvals/:id/cancel` (izinler `management.approval.read/create/decide`). Karar/iptal yalnızca `pending` taleplerde; karar alan talep sahibine bildirim (`system.announcement`) + aktivite kaydı. Ortak yazıcılar (`events.ts`: `recordActivity`/`insertNotification`) DRY için `ManagementService`'ten çıkarıldı. Frontend: `ManagementApprovalsView.vue` (`/management/approvals`) — filtre + yeni talep + onayla/reddet modalı + iptal; `stores/management.ts` `approvals` + `fetchApprovals`/`createApproval`/`decideApproval`/`cancelApproval`/`fetchApprovalPendingCount`. Canlı servis smoke testi (oluştur/onayla/yeniden karar engeli/iptal) + `tsc` (api) + `vue-tsc` + `eslint` + `prettier` (api) + `governance:check` temiz.
- [x] **Context-aware quick actions (Faz 7: Müşteri → [+Görev] [+Randevu])** — `ContactsView.vue` detay başlığına iki hızlı aksiyon (`canManagement` entitlement kapısı; `management` hakkı yoksa gizli). Modal ile görev (`related_entity_type:'contact'` + `related_entity_id`, `source:'quick_action'`) ve randevu (`contact_id`) oluşturulur; `stores/management.ts` `CreateTaskInput`'a `source`/`related_entity_*` eklendi. `vue-tsc` + `eslint` temiz.
- [x] **Kural motoru (T-7.5: hazır kurallar kod + parametreler DB)** — `modules/management/rules.ts` (4 kural: `overdue_receivable`, `critical_stock`, `due_cheque`, `unusual_expense`; parametre şemaları + varsayılanlar) + `management_rule_settings` tablosu (migration `202610320000_management_rule_settings.sql`, RLS, GOVERNANCE §2). `dashboard.service.ts` parametreleri DB'den yükleyip varsayılanlarla birleştirir; kural `enabled=false` ise gösterge gizlenir. Uçlar: `GET /api/v1/management/rules`, `PUT /api/v1/management/rules/:key` (izinler `management.rule.read`/`management.rule.manage`). Frontend: `ManagementRulesView.vue` (`/management/rules`) — kural aç/kapat, parametre düzenle, geri al/varsayılana dön/kaydet; `stores/management.ts` `rules` + `fetchRules`/`updateRule`. Canlı smoke testi (parametre ezme + disable) + `tsc` (api) + `vue-tsc` + `eslint` + `prettier` (api) + `governance:check` temiz.

- [x] **Hatırlatıcı + sessiz saat varsayılanları (T-7.1/T-7.2)** — `management/service.ts`: görev `due_at` ile oluşturulunca varsayılan hatırlatıcılar üretilir (**15 dk / 1 saat / 1 gün önce**, `in_app`, `quiet_hours_respected=true`, geçmiş ofsetler atlanır) — sorumluya yoksa oluşturana. Bildirim tercihlerinde boş bırakılırsa varsayılan sessiz saatler **22:00–08:00** (`notification_preferences` kolon DEFAULT + `upsertPreference` COALESCE; mevcut değer korunur). Migration `202610310000_management_reminder_defaults.sql` uygulandı. Canlı servis smoke testi + `tsc` + `eslint` + `prettier` temiz.

- [x] **Bildirim tercihleri + sessiz saatler UI (Faz 7, ROADMAP §822)** — `ManagementPreferencesView.vue` (`/management/preferences`, nav "Bildirim Tercihleri"): 16 bildirim türü için kanal seçimi (`in_app`/`email`/`push`/`whatsapp`/`sms`) + tür bazlı sessiz saat (başlangıç/bitiş, varsayılan 22:00–08:00); kaydet her kanal için `PUT /api/v1/management/preferences` upsert eder. `stores/management.ts` `preferences` + `fetchPreferences`/`savePreference`. Backend sertleştirme: `listPreferences` artık `user_id` verilmezse oturum sahibiyle sınırlanır (başka kullanıcıların tercihleri listelenemez). Yan düzeltme: `modules/trade/invoice/service.ts` hatalı `../accounting/chart.js` yolu → `../../accounting/chart.js` (api `tsc` blokluyordu). ✅ Web Push (PWA service worker + VAPID env + worker `createPushDispatchHandler` + frontend `push.ts` + `push-sw.js` entegrasyonu). Doğrulama: `tsc` (api+shared+web) + `vue-tsc` + `eslint` + `governance:check` (14 modül, 156 tablo) temiz.

## 3️⃣ FAZ 3 — Ücretsiz Çekirdek (Bitti, Faz 4'e Geçiş)
- [x] **Entitlement rotalara bağlandı** — `requireEntitlement('trade')`, `'expense'` → `'trade'`, `'cashbank'` (SPEC §5.1/§8.5)
- [x] **Kasa/Banka modülü** — `apps/api/src/modules/cash-bank/`: list/deposit/withdrawal/transfer/cancel modülleri + frontend stores ve view'lar
- [x] **Gider modülü** — `apps/api/src/modules/expense/`: giriş/gider rotaları, servisler + frontend view'lar
- [x] **Ticaret modülü** — `apps/api/src/modules/trade/`: faturalar, siparişler, teslimatlar, getiri/alış modülleri
- [x] **Raporlar (reports_plus) Faz 3 desteği** — overview, sales, purchases, expenses, stock, cash-bank, profit-loss, tax-summary canlı raporlar
- [x] **Migration'lar ve RLS** — `202610140000_expenses.sql`, `202610150000_cash_bank_fix_and_reports.sql` ve ileri migration'lar
- [x] **Frontend tüm modüller** — `CashBankView.vue`, `ExpenseListView.vue`, `ExpenseFormView.vue`, `ReportView.vue` + router navigasyonu
- [x] **Lint ve typecheck temiz** — `npx eslint .` → exit 0, `npx tsc --noEmit` → temiz

## 🔄 FAZ 4 — e-Dönüşüm + SaaS Ticari Altyapı (BAŞLIYOR)
- [x] **Entitlement kapısı rotalara bağlandı** — `requireEntitlement` middleware'i `contacts`, `stock`, `trade`, `cashbank` rotalarına eklendi (SPEC §5.1/§8.5). Middleware testi: `apps/api/tests/require-entitlement.test.ts`.
- [x] **Tutarsızlık düzeltmeleri (8 Ekim 2026, 2. tur):**
  - `expense` rotalarındaki geçersiz `requireEntitlement('expense')` → `'trade'` (gider `trade.expense.*`, ADR-0008) — aksi halde tüm gider uçları 403 verirdi.
  - `report/` klasörü `modules/reports_plus/`'a taşındı (klasör = modül kodu, ADR-0006).
  - `report_generations` tablosu migration'ı eklendi (`202610150000_cash_bank_fix_and_reports.sql`) — servis kullanıyordu ama şema yoktu.
  - Kasa/banka şema düzeltmesi: `opening_balance`, `cash_bank_movements.target_account_id` eklendi; `status` CHECK'e `'deleted'` eklendi (soft-delete, ADR-0010).
  - Kasa/banka servisindeki `computedBalance` vs. saklı `balance` çift kaynağı tekleştirildi (tek doğruluk kaynağı: `balance` kolonu).
  - `expense_payments` + `report_generations` GOVERNANCE §2'ye eklendi; `expense.test.ts` servisin gerçek davranışına göre düzeltildi (Promise.all mock sırası, `{success:true}`, kategori dizisi).
- [x] **Kasa/Banka frontend tamamlandı:** `stores/cash-bank.ts`'e hareket katmanı (list/deposit/withdrawal/transfer/cancel), `CashBankView.vue`'ya **Hesaplar / Hareketler sekmeleri** + para yatır/çek/transfer modalları. E2E: `e2e/cash-bank.spec.ts` (6 test). API birim: `tests/cash-bank.test.ts` (10 test — hesap + hareket, ROLLBACK/INSUFFICIENT_BALANCE dahil).
- [x] **Migration düzeltmeleri (8 Ekim 2026, 3. tur):**
  - `202610140000_expenses.sql`'de **tablo sırası hatası**: `expense_payments` → `expenses(id)` FK veriyordu ama `expenses` daha sonra oluşturuluyordu → `relation "expenses" does not exist`. `expense_categories → expenses → expense_payments` sırasına alındı.
  - Aynı migration'da RLS policy'leri şema-niteliksiz `current_tenant_id()` kullanıyordu → `app.current_tenant_id()` yapıldı.
  - **Down migration eklendi:** `202610140000_expenses.down.sql` (SPEC §30.7 zorunlu).
  - Canlı DB'de `migrate up` → ✓ `202610140000` ve `202610150000` temiz uygulandı; şema doğrulandı (`opening_balance`, `status` CHECK + `'deleted'`, `target_account_id`).
- [x] **Gider/Rapor frontend:** `ExpenseListView.vue`, `ExpenseFormView.vue`, `ReportView.vue`, `stores/report.ts`; router (`/expenses`, `/expenses/new`, `/expenses/:id/edit`, `/reports`) + nav menü (`App.vue`). E2E: `e2e/expenses.spec.ts`, `e2e/reports.spec.ts`.
- [x] **Tasarım sistemi başlangıcı tamamlandı** — `packages/ui`: `Modal`, `Drawer`, `EmptyState` eklendi; `Button`, `Input`, `MoneyInput`, `DataTable` ile birlikte `index.ts`'ten export edildi (önceden hiçbiri export edilmiyordu → web kullanamıyordu). Modal/Drawer: Escape ile kapatma, backdrop, gövde kaydırma kilidi, `aria-modal`/`aria-label` (SPEC §28 a11y).
- [x] **Lint borcu temizlendi** — `cash-bank/`, `expense/`, `trade/` modülleri + `stores/expense.ts`, `stores/cash-bank.ts`'teki tüm `any`/unused-var hataları (38 → 0). `npx eslint .` → exit 0.
- ~~Drizzle şema üretimi (`drizzle-kit generate`)~~ — **geçersiz madde:** şema `packages/db/migrations/*.sql` ile yönetiliyor; drizzle-kit introspect çıktısı Faz 1'de projeden kaldırıldı (`gen_random_uuid` ihlali).
- ⚠ **Bulgu:** `apps/api/src/modules/contacts/` ve `modules/stock/` servisleri + testleri (`contacts.test.ts`, `stock.test.ts`) zaten yazılmış — TODOS bunu göstermiyordu. Kapsam doğrulanıp ROADMAP Faz 2 iş listesiyle eşleştirilmeli.
- [x] **API kararlılık + listeleme düzeltmeleri (9 Ekim 2026):**
  - `middleware/auth.ts` async `authenticate` içindeki `throw` → `next(error)` (Express 4 async throw süreç öldürür: `ERR_CONNECTION_REFUSED` + crash döngüsü); `server.ts`'e `unhandledRejection`/`uncaughtException` koruması eklendi.
  - `cash-bank`, `cash-bank/movement`, `expense`, `sales-quote`, `sales-order`, `purchase-order`, `delivery` servislerinde COUNT sorgusu `t` alias'ı eksikti (`FROM <tablo> WHERE t.…` → `missing FROM-clause entry for table "t"` → 500). 7/7 düzeltildi.
  - Entitlement geçiş boşluğu: ADR-0007/0008 sonrası kod `trade` isterken tenant'lar yalnızca eski `invoices`/`expense` satırlarına sahipti → tüm ticari uçlar 403. Dev DB'ye `trade` (active) eklendi; kalıcı çözüm Faz 4 abonelik altyapısında.
  - Web: store'larda çift `/v1` URL hataları giderildi (`cash-bank`, `report`, `expense`); `public/favicon.svg` + `index.html` `<link>` eklendi.

- [x] İçe/dışa aktarma sihirbazı — cari sihirbazı + **ürün ve açılış stoğu içe aktarma** (kolon eşleştirme → dry-run → hata raporu → onay → batch) + **tam veri dışa aktarma (ZIP)** + ürün CSV. **Canlı E2E doğrulandı (14 Ekim 2026):** 3/3 ürün oluştu, Merkez Depo otomatik açıldı (`is_base`), `initial_stock=100` bakiyeye işledi (100×8,00=800); açılış stoğu 2 created / 2 invalid (ürün yok + negatif miktar), üzerine ekleme uyarısı ve hareketli ortalama maliyet (1,1038) doğru. **Testler:** `apps/api/tests/stock-import.test.ts` (21 test).
- [x] UX kabuğu (responsive, **şirket seçici**, **modül bazlı navigasyon**, kullanıcı menüsü) — 13 Ekim 2026.
- [x] PWA (gerçek PNG ikonlar + service worker + `offline.html`; çevrimdışı finansal kesinleştirme YOK, yalnızca okuma önbelleği) — 13 Ekim 2026.
- [x] Boş durum ekranları (EmptyState) + **kilitli modül önizlemesi ve CTA** + **onboarding kontrol listesi** — 13 Ekim 2026. Patron Görünümü v1 panosu KPI + kısayollarla mevcut; yönetim paketi (Faz 7) derinleşmesi bekliyor.
- Detay ROADMAP §4 — site tarafı yukarıda tamam ✅

---

### Faz 8 — Entegrasyonlar + Public API + WhatsApp (Tamamlandı)
- [x] **WhatsAppProvider arayüzü + MockProvider (shared paket)** — `whatsapp.ts` (integrations) oluşturuldu; `WhatsAppProvider` interface + `MockWhatsAppProvider` implementasyonu EInvoiceProvider kalıbına (SPEC §29.1 Liskov) göre eklendi; `packages/shared/src/index.ts` üzerinden export edildi. `SubscriptionService` constructor'ı `whatsappProvider` kabul ediyor.
- [x] **§20 Webhook altyapısı**: migration `202610380000_integrations_webhook.sql` — `integrations`, `webhook_events`, `integration_credentials`, `external_mappings` (RLS + index + grant). `modules/integrations/` (service + routes) oluşturuldu; `verifyHmacSignature` (HMAC-SHA256, timing-safe), `recordWebhookEvent` (idempotent UNIQUE), `findMapping`, `createMapping`. `app.ts`'e `/api/v1/integrations` mount edildi. Permission senkronu: `integrations.integration.read/manage`, `integrations.webhook.read/receive`. ✅
- [x] **§22 Public API**: `GET /api/v1/public/status` eklendi (kimlik gerektirmez, `{status, uptime, version}` döner); mevcut `POST /api/v1/public/contact` korundu. Typecheck + 216/216 test + governance temiz. ✅
- [x] **§18 WhatsApp (dal further)**: Mesaj gönderme + durum sorgulama + inbox entegrasyonu (mock sağlayıcı eklendi, shared pakete entegre edildi). ✅

### Bu oturumda yapılan düzeltmeler ve tamamlananlar (14 Ekim 2026)
- [x] **Cari denetim izi (ADR-0016 uyumu)** — `apps/api/src/modules/contacts/service.ts`: `createContact`/`updateContact`/`deleteContact` artık **aynı transaction'da** `audit_logs` yazar (`contacts.create|update|delete`, `user_id`, `old_values`/`new_values`); route'lar `req.user.sub` geçirir. **Canlı kanıt:** create → update → delete sonrası `GET /audit-logs` üç kaydı da döndürdü (tenant RLS ile görünür, yani `tenant_id` doğru bağlandı). `contacts.test.ts` denetim assertion'larıyla güncellendi.
- [x] **Denetim izi kapsamı yayıldı (ADR-0016) + `entity.action` action standardı hizalama** — accounting (5 fiş metodu: create/update/reverse/cancel/delete), expense (create/update/delete), invoice (create/update/delete/replaceLines/addPayment/postInvoice) artık **aynı transaction'da** `audit_logs` yazıyor; invoice `updateInvoice`/`deleteInvoice` tx'ye alındı + tüm route'lar `req.user?.sub` geçiriyor (postInvoice en kritik — muhasebe fişi doğurur). **Action standardı = `entity.action`** (contacts referansı + subscription `` `${sel.table}.${action}` `` ile uyumlu): accounting/expense/invoice helper'ları önce düz `create` yazıyordu → helper'larda `` `${entity_type}.${action}` `` üretilecek şekilde düzeltildi (ör. `journal_entries.create`, `invoices.posted`). platform/company tek-olay izleri (`support_access_granted`, `platform_owner_bootstrap`, `company_approved`) hâlâ `entity.action` değil (ADR-0016 CRUD izi kapsamı dışında → opsiyonel). Testler yalnız `INSERT INTO audit_logs` **varlığını** assertion'da bekler (action değerini değil) → format değişikliği test kırmadı. Doğrulama: `tsc` temiz, **342/342 test**, eslint+prettier temiz, governance 14 modül / 158 tablo. **Canlı kanıt:** login → gider kategorisi + gider oluştur (`POST /expenses` 201) → `GET /audit-logs?action=expenses.create` **1 kayıt**: `action='expenses.create'`, `entity_type='expenses'`, `user_id` bağlı (aynı transaction).

- [x] **Entitlement tenant bağlamı (güvenlik)** — `check-module`/`check-limit`/`increment-usage` body'sinden zorunlu `tenantId` kaldırıldı; tenant otoritesi JWT (`req.user.tenantId`) + RLS. **Canlı kanıt:** body'de `tenantId` olmadan ikisi de 200 ve yanıt JWT tenant'ını döndürüyor.
- [x] **Ürün + açılış stoğu içe aktarma (kapanış)** — uçtan uca canlı doğrulandı (3/3 ürün, otomatik "Merkez Depo", `initial_stock` → bakiye 100×8,00=800; açılış stoğu 2 created/2 invalid, üzerine ekleme uyarısı, hareketli ortalama 1,1038 doğru) + **`tests/stock-import.test.ts` (21 test)**.
- [x] **Route sıra hataları** — `accounting` `GET /:id` tüm statik yolların ardına alındı (6 uç 500 → 200: `entries`, `periods`, `period-locks`, `posting-rules`, `account-mappings`, `next-entry-no`); `entitlement` mount öneki tekrarı kaldırıldı (`/api/v1/entitlements/entitlements` 404 → 200).
- [x] **Audit-logs listeleme** — `parseQuery` sarmalaması (`{query: req.query}`) + `count`/`select` ayrı parametre listeleri (`prepared statement requires 1` 500'ü giderildi).
- [x] **RLS erişim migration'ı** — `202610390000_current_tenant_id_public.sql` (+down): `public.current_tenant_id()` wrapper (uygulama şemasız çağırıyor) + `GRANT USAGE ON SCHEMA app` (politikalar `app.current_tenant_id()` kullanıyor). Tüm tenant uçları 500 veriyordu → düzeldi.
- [x] **Tarayıcı-güvenli paylaşılan kernel** — `packages/shared/src/email/templates.ts` içindeki `process.env.APP_URL` koşullu erişime çevrildi (Vite'ta "process is not defined" tüm SPA'yı düşürüyordu).
- [x] **A11y/shell** — `#icerik` hedefi `<main>` elementi oldu, skip-link yalnız uygulama kabuğunda; `axe-core` **ihlal yok** (WCAG 2.1 AA).
- [x] **Doğrulama (bu oturum):** api **322/322 test**, shared 48/48, `typecheck` (api+web+shared), `eslint`, `prettier`, `governance:check` (14 modül / 156 tablo), `test:a11y` — hepsi temiz. Tarayıcı (puppeteer + Chrome): `/login`, `/dashboard`, `/invoices` konsol hatası yok, tüm API çağrıları 2xx.
- [x] **Adım 5 — Gelir paneli: MRR/ARR + `platform_metrics_daily` (SPEC §8.9)** — migration `202610400000_platform_metrics.sql` (+down): RLS'siz platform tablosu (metrik = işletmeci verisi, tenant verisi değil) + index + grant'ler; `docs/GOVERNANCE.md` §2 güncellendi (157 izinli tablo). `modules/platform/metrics.service.ts`: **taahhüt bazlı MRR** (`prices.amount_monthly`, yoksa `amount_yearly/12`), ARR = MRR×12, plan dağılımı, gün içi yeni/ayrılan abonelik; hesaplama `app_migrator` (tablo sahibi → RLS baypas) ile, yazma/okuma RLS'siz tablodan. Uçlar: `GET /api/v1/platform/metrics?days=30` (canlı hesap + seri; `platform_finance` rolü veya owner) ve `POST /api/v1/platform/metrics/snapshot` (owner; idempotent upsert). **Canlı kanıt:** mock checkout ile enterprise aboneliği → snapshot `mrr=799, arr=9588, active=1, planBreakdown={enterprise}`; `GET` 200; kimliksiz istek 401. `tests/platform-metrics.test.ts` (5 test).
- [x] **expense_date NOT NULL düzeltildi** — `createExpenseSchema`'da `expense_date` **optional** ama `expenses.expense_date` DB'de **NOT NULL** → `POST /api/v1/expenses` alanı vermeden **500**. Çözüm: `createExpense`'ta INSERT'te `expense_date ?? todayIso()` fallback (Europe/Istanbul, SPEC T-7.3). **Canlı kanıt:** `expense_date` verilmeden `POST /expenses` → **201** + `expense_date` bugünün TR tarihi yazıldı.

- [x] **`getPool` rol bazlı havuz düzeltmesi (kritik altyapı hatası)** — `packages/db/src/client.ts` tek singleton havuz tutuyordu; `role` parametresi yalnız İLK çağrıda etkiliydi → `getPool('migrator')`/`getPool('platform')` pratikte app_user havuzunu döndürüyor ve RLS'e takılıyordu (gelir metrikleri bu yüzden 0 çıkıyordu). Artık rol başına ayrı havuz (`app` 20 / `migrator` 5 / `platform` 5 bağlantı); `closePool()` hepsini kapatır.
- ⚠ **Bulgu (timezone):** pg `date` kolonu JS `Date`'e çevrilirken gün kayıyordu (`2026-10-14` TR → `2026-10-13Z`) → metrik serisi bir gün geri görünüyordu. Sorgu artık `metric_date::text` ile okuyor; `todayIso()` Europe/Istanbul kullanır (T-7.3 ile uyumlu).
- [ ] **Adım 4 (K-08) — karar bekliyor:** gerçek ödeme sağlayıcısı (öneri: iyzico) + **imzalı kamu webhook ucu**. Hazır altyapı: `verifyHmacSignature` (HMAC-SHA256, timing-safe), idempotent `provider_webhook_events`, `handleWebhook`. Karar gereken noktalar: sağlayıcı seçimi, webhook secret kaynağı (env mi `integration_credentials` mi), ham gövde için public/webhook rotasının `express.raw` ile json'dan ÖNCE mount edilmesi. Havale/EFT manuel aktivasyon akışı (SPEC §8.5) aynı kararla birlikte ele alınmalı.
- [ ] **Push/CI blokajı** — SSH anahtarı üretildi (`~/.ssh/id_ed25519.pub`); GitHub hesabına eklenip `git push -u origin kuleplus` çalıştırılmalı (CI ilk yeşil koşu Faz 0 kapısı).
- ⚠ **Bulgu (format:check):** `npm run format:check` 115 dosyada stil uyarısı veriyor — neden Windows CRLF/LF tutarsızlığı (dosyalar CRLF, Prettier `endOfLine` LF bekliyor). CI `format:check` adımı bu nedenle kırmızı başlar. Kalıcı çözüm: `.gitattributes` (`* text=auto eol=lf`) + `git add --renormalize .`; geçici çözüm bu adımı CI'de ayrı ele almak. İçerik hatası değildir (yalnız satır sonu).


## ⚠ Bekleyen Kararlar / Blokajlar
**Tam liste ve işaretlenebilir karar formu:** `docs/operations/pending-decisions.md`

| Karar | Durum |
|-------|-------|
| K-02 Ücretsiz plan limit sayıları | ✅ **Onaylandı** — Cari 500, Stok 200, Ayda 100 import satırı, 1 özel rol |
| Fiyatlandırma (₺ tutarlar) | ✅ **Netleşti** — Core+ 299₺/ay, Kurumsal 799₺/ay (KDV hariç). Migration `202610370000` uygulandı, seed güncellendi, site sayfası güncellendi. |
| brand.md: renk paleti | ✅ **Dolu** — "Fintech" paleti + logo notları (`docs/brand.md`) |
| brand.md: domain, destek e-postası | ✅ **Netleşti** — `kuleplus.com.tr` / `destek@kuleplus.com.tr` |
| Hosting bölgesi (TR) — K-12 | ✅ **Kapalı** — ROADMAP.md:1067 (8 Ekim 2026 — kullanıcı kararı: TR) |
| SMMM danışmanlığı, golden test | ⏳ Dış kişi/şirket — Faz 2 sonrası ertelendi |
| **Faz 8 §22 Public API tanımı** | ✅ **Kapalı** — `GET /api/v1/public/status` eklendi, `POST /api/v1/public/contact` korundu. |

## 📌 Bu oturumda düzeltilen doküman↔kod tutarsızlıkları (8 Ekim 2026)
| # | Tutarsızlık | Çözüm |
|---|-------------|-------|
| 1 | `invoice` modülü GOVERNANCE §2'de yoktu; ayrı `modules/invoice/` klasörü + `/api/v1/invoices` rotası "klasör = modül kodu" (ADR-0006) kuralını ihlal ediyordu | Klasör `modules/trade/invoice/` altına taşındı; `app.ts` + `trade/index.ts` import yolları güncellendi |
| 2 | `requireEntitlement('invoices')` — `'invoices'` diye modül kodu yok → `/api/v1/invoices` uçları **her koşulda 403** verirdi | `requireEntitlement('trade')` yapıldı (fatura `trade.invoice.*` altındadır, ADR-0007) |
| 3 | `202610110000_invoices.sql` içinde 5 adet `gen_random_uuid()` (SPEC §0.1 / ADR-0002 ihlali) → governance-check **kırmızı** | Deterministik name-based UUID (`md5` → tireli format) üretimine çevrildi |
| 4 | GOVERNANCE §2'de gerçek şemada olan `tax_rates`, `invoice_sequences`, `invoice_payments`, `cash_bank_accounts`, `cash_bank_movements` tabloları yoktu | `trade` ve `cashbank` satırları gerçek tablolara hizalandı; var olmayan `invoice_line_taxes` kaldırıldı; `cashbank` klasör adı `modules/cash-bank/` olarak düzeltildi |
| 5 | (Önceki oturum) `requireEntitlement` middleware'i hiçbir rotaya bağlı değildi | `contacts`, `stock`, `trade`, `cashbank`, `invoice`(→trade) rotalarına bağlandı |

**Doğrulama:** governance-check ✓ (14 modül, 141 tablo), `tsc --noEmit` temiz, `vitest run` **101/101**, eslint temiz.

| # | Tutarsızlık | Çözüm |
|---|-------------|-------|
| 1 | Migration'lar `DEFAULT gen_random_uuid()` (v4) kullanıyordu — SPEC §0.1/ADR-0002 ihlali | 4 dosyada 18 default kaldırıldı; `governance-check`'e yasak eklendi |
| 2 | `governance-check` kırmızıydı (4 tablo GOVERNANCE §2'de yok) | `tenant_user_roles`, `tenant_user_departments`, `password_reset_tokens`, `email_outbox` §2'ye eklendi; `tenant_applications` yinelenmesi kaldırıldı — check **yeşil** |
| 3 | `packages/shared/permissions.ts` dokümanlarda "tek kaynak" deniyordu ama yoktu | Oluşturuldu (22 izin, format doğrulayıcı); `docs/api/permissions-catalog.md` senkronlandı |
| 4 | `docs/api/openapi.yaml` ADR-0013'te referanslı ama yoktu | Faz 1 uçlarını içeren sözleşme oluşturuldu |
| 5 | `docs/legal/data-inventory.md` KVKK aydınlatmadan referanslı ama yoktu | Veri envanteri + saklama matrisi oluşturuldu (SPEC §27.5 seed uyumlu) |
