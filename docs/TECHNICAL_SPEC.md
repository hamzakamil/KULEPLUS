# KURUMSAL ERP VE İŞLETME YÖNETİM PLATFORMU
## Teknik Mimari, Veri Bütünlüğü ve Ticari Platform Standardı

**Doküman sürümü:** 5.1.0
**Önceki sürüm:** 5.0.0
**Mimari:** Modüler monolith
**Dil/karakter standardı:** UTF-8 / Türkçe (tr-TR)
**Kapsam:** Tasarım sözleşmesi (uygulanmış sistem beyanı değildir)
**İlgili dokümanlar:** [`../README.md`](../README.md) v4.1.0 · [`ROADMAP.md`](ROADMAP.md) v5.1.0 · [`GOVERNANCE.md`](GOVERNANCE.md) v1.1.0 · [`adr/`](adr/)

### v5.1.0'da Ne Değişti?

| # | Değişiklik | Kaynak |
|---|-----------|--------|
| 1 | §0.3/§7.0 — `legal_texts` ve `legal_acceptances` **global** kabul edildi; `tenant_id` taşımazlar. `legal_acceptances` yalnızca `user_id` bazlıdır. | ADR-0011 |
| 2 | §1.2/§1.3 — `apps/site` = **Astro**; `apps/web` = Vue 3 + Vite (değişmez). Barındırma: api/web/worker TR VPS, site Cloudflare Pages. | ADR-0012 |
| 3 | §1.3 — E-posta sağlayıcı **Postmark** (transactional); analitik **Plausible**. | B19, B9 |
| 4 | §1.3/§22 — OpenAPI **Zod'dan otomatik üretilir**; `docs/api/openapi.yaml` çıktıdır. | ADR-0013 |
| 5 | §6.5 — Tam permission kataloğu `docs/api/permissions-catalog.md`'ye taşındı. | B2 |
| 6 | §8.1 — `plan_limits.max_custom_roles` örnek alanlar arasına eklendi (ücretsiz: 1, ücretli: NULL). | A4 |
| 7 | §8.2 — `legal_texts`, `legal_acceptances` Faz 1 (`core` modülü) listesine taşındı; `subscription` listesinden çıkarıldı. | A2 |
| 8 | §17 — E-posta şablon envanteri `docs/product/email-templates.md`. | B7 |
| 9 | §22.2 — Tam hata kodu kataloğu `docs/api/error-codes.md`. | B3 |
| 10 | §23.1 — Import şablon sözleşmeleri `docs/product/import-templates/`. | B25 |
| 11 | §24 — Erişilebilirlik hedefi **WCAG 2.1 AA**; axe-core CI'da. Tam ekran listesi `docs/product/screens.md`. | B5, B10 |
| 12 | §25 — Tarayıcı destek matrisi eklendi (son 2 sürüm + iOS Safari 16+). | B11 |
| 13 | §27.1 — Secrets yönetimi: Faz 0–3 SOPS + `.env`; Faz 4+ Doppler/AWS SM (ADR ile). | B15 |
| 14 | §27.2 — Yasal metin şablonları `docs/legal/`. | B8, B22 |
| 15 | §27.5 — `data_retention_policies` **seed** değerleri tanımlandı. | B21 |
| 16 | §30.2 — Frontend performans bütçesi eklendi (bundle, LCP, CLS, TBT). | B12 |
| 17 | §30.3 — Yedekleme detayı (sıklık, saklama, konum, şifreleme) + **§30.3.1 Ölçüm prosedürü**. | A6, B16 |
| 18 | §30.5 — Test coverage eşiği: genel %75, kritik alanlar %95. | B13 |
| 19 | §30.7 — Preview environment (yalnızca web + site); incident runbook `docs/operations/incident-runbook.md`; platform billing `docs/operations/platform-billing.md`. | B14, B17, B20 |
| 20 | §1.2 — Proje **greenfield**; müşteri veri migrasyonu kapsam dışı (import §23.1 ile). | B18 |

### v5.0.0'da Ne Değişti?

| # | Değişiklik | Kaynak |
|---|-----------|--------|
| 1 | §0 (yeni) — Ortak kolon ve ID standardı eklendi (UUID v7). | Çelişki raporu §9 |
| 2 | §2 — Tek modül kodu tablosu (permission öneki = klasör = entitlement). | Çelişki raporu §2 |
| 3 | §1.2 — `apps/mobile` kaldırıldı; `apps/site` eklendi. | Rapor §12 |
| 4 | §1.3 — Flutter koşullu, PWA-first; Socket.IO matristen çıkarıldı. | Rapor §6 |
| 5 | §4.3 — `onboarding_mode` eklendi; varsayılan `manual`. | Rapor §5 |
| 6 | §5.1 — Super Admin singleton yerine `platform_owner` + roller + `support_access_grants`. | Rapor §3 |
| 7 | §6.1 — `purchasing.*`/`logistics.*` iptal; `trade.*` altında birleşti. `accounting.invoice.*` iptal. | Rapor §2, §10 |
| 8 | §6.6 — IK, URETIM rolleri kaldırıldı (modülü yok). | Rapor §4 |
| 9 | §6.9 — `tenant_domains` kaldırıldı; `tenant_settings.settings` JSONB. | Rapor "Çıkarılması gerekenler" |
| 10 | §8 — `coupons`, `partners`, `legal_texts` vb. eklendi; `plan_limits` vs `plan_features` ayrıldı; tablolar fazlara dağıtıldı. | Rapor §8, §10 |
| 11 | §9 — `exchange_rates` eklendi. | Rapor §9 |
| 12 | §10 — Durum geçiş matrisi (rol × geçiş) eklendi. | Rapor Seviye 2 |
| 13 | §11 — Contact inline alanlar kaldırıldı; yalnızca alt tablolar tek kaynak. | Rapor §11 |
| 14 | §12/§13 — `expenses` modeli eklendi. | Rapor §12/§13 |
| 15 | §19 — `outbox_events` şeması (`tenant_id` dahil). | Rapor X4 |
| 16 | §21 — Port imzası eklendi; "UBL-TR korunur" cümlesi kaldırıldı. | Rapor §11, Seviye 2 |
| 17 | §22 — `/import`, `/export`, `/reports` rotaları; pagination kuralı; hata kodu kataloğu yeri. | Rapor Seviye 1 |
| 18 | §23 — Tam veri dışa aktarma ZIP içeriği tanımlandı. | Rapor Seviye 1 |
| 19 | §27 — Tenant kapanış + KVKK silme durum makinesi. | Rapor Seviye 1 |
| 20 | §30.7 (yeni) — İşletim (health, metrics, Sentry, ortamlar, log retention). | Rapor Seviye 1 |
| 21 | §33 — Silindi; öncelik ROADMAP'e referans. | Rapor §1 |
| 22 | §18 — WhatsApp bölümüne "Faz 8, ilk sürüm sözleşmesi değildir" damgası. | Rapor "Çıkarılması gerekenler" |

---

## 0. ORTAK KOLON VE ID STANDARDI

Bu bölüm **tüm tabloları** bağlar. Ajan bu bölümü okumadan tablo oluşturamaz.

### 0.1. Birincil anahtar

- **Tür:** `UUID v7` (RFC 9562). Zaman sıralı, index dostu, B-tree fragmentasyonu yok.
- **Üretim:** Uygulama tarafında (`packages/shared/id`), PostgreSQL `gen_random_uuid()` **kullanılmaz** (v4 üretir).
- **İstisna:** `platform_settings` gibi anahtar-değer tabloları doğal anahtar kullanabilir.

### 0.2. Zorunlu ortak kolonlar

Tenant verisi taşıyan **her** tabloda:

| Kolon | Tip | Kural |
|-------|-----|-------|
| `id` | `UUID` | PK, UUID v7 |
| `tenant_id` | `UUID` | `NOT NULL`, `tenants.id` FK |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`, trigger ile güncellenir |
| `created_by` | `UUID` | `users.id` FK, `NULL` olabilir (sistem işlemleri) |
| `updated_by` | `UUID` | `users.id` FK, `NULL` olabilir |
| `version` | `INTEGER` | `NOT NULL DEFAULT 1`, optimistic lock |

### 0.3. Tenant_id istisnaları (gerçek global tablolar)

Aşağıdaki tablolar `tenant_id` taşımaz:

- `users` (global kimlik)
- `platform_users`, `platform_roles`, `platform_user_roles`, `platform_settings`
- `modules`, `features`, `module_dependencies`, `plans`, `plan_versions`, `plan_features`, `plan_limits`, `prices`
- `permissions`
- `legal_texts`
- `legal_acceptances`  ← **v5.1.0:** yalnızca `user_id` bazlıdır; platform kabulü ve tenant'a özgü kabul ayrımı yapılmaz. Tenant'a özgü DPA/davet ekleri ihtiyaç doğarsa ayrı ADR ile ele alınır.
- `exchange_rates` (global TCMB kurları; tenant'a özel kur `tenant_exchange_rates` ile ayrı tutulur)

### 0.4. Soft delete kuralı

- **İzin verilen tablolar (kart niteliğinde):** `contacts`, `products`, `users`, `warehouses`, `cash_accounts`, `bank_accounts`, `roles` (sistem rolleri hariç), `departments`, `branches`.
- **Yasak olan tablolar (finansal/belge):** `invoices`, `invoice_lines`, `journal_entries`, `journal_lines`, `party_ledger_entries`, `stock_movements`, `cash_transactions`, `bank_transactions`, `payments`, `billing_*`. Bu tablolarda düzeltme yalnızca **ters kayıt / iade / düzeltme belgesi** ile yapılır.
- `deleted_at TIMESTAMPTZ NULL` alanı yalnızca izin verilen tablolarda bulunur.

### 0.5. Optimistic lock

- API'de güncelleme uçları `If-Match: <version>` başlığı **ister** (kart tabloları).
- Çakışma: `409 CONFLICT` + `VERSION_MISMATCH` hata kodu.

---

## 1. MİMARİ KARARLAR

Mevcut teknolojiler korunur. Yeni altyapı yalnızca somut ihtiyaç karşılığında eklenir.

İlk sürümde mikroservis, Kafka, Kubernetes, Elasticsearch, event sourcing ve ayrı veri ambarı **kullanılmaz**.

```text
Tanıtım sitesi   Müşteri web (PWA)   Platform web       Flutter (Faz 9, koşullu)
       \              |                   |                     /
                              REST API
                                 |
                       Application Services
                                 |
                            Domain Logic
                                 |
                         Ports / Repositories
                                 |
              PostgreSQL / Redis / S3 / Harici Sağlayıcılar
                                 |
                               Workers

Redis kalıcı finansal kayıt kaynağı değildir. İş kayıtlarının otoritesi PostgreSQL'dir.

1.1. Sürüm politikası
Node.js: Üretimde desteklenen LTS dalı (README: 22 LTS).

Bağımlılıklar: Lockfile ile sabitlenmiş sürümler.

PostgreSQL: Desteklenen ve staging'de test edilmiş sürüm (README: 16+).

Yükseltmeler: Güvenlik taraması + regresyon testi sonrası.

Express/Zod: Ana sürüm değişimi ayrı uyumluluk işi olarak planlanır.

1.2. Depo yapısı
text
apps/
  api/        Express API (src/modules/<modül>/…)
  worker/     BullMQ worker'ları
  web/        Vue 3 uygulaması (Patron · Uzman · Platform — PWA)
  site/       Astro — pazarlama sitesi + yardım merkezi (statik, SEO)

packages/
  shared/     Zod şemaları, para/vergi/tr/id/errors yardımcıları
  db/         Drizzle şeması, migration, RLS SQL, seed
  ui/         Ortak Vue bileşenleri (apps/web ve apps/site arasında paylaşılır)

docs/
  GOVERNANCE.md
  TECHNICAL_SPEC.md   ROADMAP.md
  brand.md
  adr/                (mimari karar kayıtları)
  api/                (OpenAPI, permissions-catalog, error-codes)
  operations/         (runbook, incident, platform-billing, restore-drill)
  legal/              (KVKK, ToS, çerez, DPA, komisyon)
  product/            (screens, i18n, email-templates, seo-analytics, help-center, import-templates)
  archive/            (eski dokümanlar, çelişki logları)

docker-compose.yml
.github/workflows/
Not: apps/mobile/ yoktur. Flutter Faz 9 tetikleyicisi sağlanırsa açılır (GOVERNANCE §6). Bu proje greenfield'dir; mevcut müşteri veri migrasyonu kapsam dışıdır. Müşteriler kendi verilerini §23.1 import akışıyla getirir.

1.3. Teknoloji matrisi
Katman	Seçilen	Gerekçe
Backend	Node.js 22 LTS + TypeScript + Express 4	Tip güvenliği, modüler yapı
Veritabanı	PostgreSQL 16+ + Drizzle ORM + pg	ACID, ilişkisel bütünlük, RLS
Validasyon	Zod (paylaşılan paket)	Uçtan uca tip güvenliği
Para	decimal.js	FLOAT/DOUBLE yasak
Frontend (uygulama)	Vue 3 + Vite + Pinia + Vue Router + Tailwind + Lucide	Reaktif, modüler; PWA-first
Web ek	vite-plugin-pwa, vue-i18n, Chart.js, TanStack Table	PWA mobil için ilk sürüm
Pazarlama sitesi	Astro (statik, @astrojs/vue) + Cloudflare Pages	İçerik ağırlıklı; sıfır JS; SEO
Queue / Worker	Redis + BullMQ	Asenkron işler
Dosya	S3 uyumlu depolama, ExcelJS, fast-xml-parser, pdfkit, multer	Belge + import/export
e-Belge	Entegratör REST API (adapter)	Kendi XSD/Schematron hattı yok
Ödeme	iyzico abonelik + havale/EFT (adapter)	—
E-posta	Postmark (transactional) — dev: Mailpit	Deliverability
Analitik	Plausible (self-hosted veya bulut)	KVKK dostu
Test	Vitest + Playwright + axe-core	a11y dahil
OpenAPI	Zod'dan otomatik üretim (zod-to-openapi)	Tek kaynak Zod
Mobil	PWA (Faz 2) · Flutter (Faz 9, koşullu)	GOVERNANCE §6
Çıkarılanlar: Flutter (matristen), Socket.IO (matristen — Faz 9'a), kendi UBL-TR/XSD hattı.

2. DOMAIN SINIRLARI
Tek kaynak: GOVERNANCE.md §2.

Özet kural:

Modül kodu = permission öneki = klasör adı = entitlement kodu.

Bir modül başka modülün repository'sini doğrudan kullanmaz; Port veya Application Service üzerinden çağırır.

Raporlar için çoklu tablo okuyan, yalnızca okuma yapan query servisleri tanımlanabilir. Bu istisna iş kurallarını atlayarak yazma yetkisi vermez.

Kaldırılan önekler: purchasing.*, logistics.*, accounting.invoice.*, crm.* (→ contacts.*).

3. DİL, KARAKTER VE UTF-8 STANDARDI
Tüm katmanlarda UTF-8 zorunludur. Hiçbir katmanda mojibake kabul edilmez.

Zorunlu karakter seti: ç Ç ğ Ğ ı İ ö Ö ş Ş ü Ü

UTF-8 zorunluluğu:

Frontend (HTML meta charset)

Backend / REST (Content-Type: application/json; charset=utf-8)

PostgreSQL (ENCODING = 'UTF8')

CSV/Excel export (UTF-8 BOM)

PDF, rapor, e-posta, log, mobil

3.1. Normalizasyon ve harf dönüşümü
Metinler NFC ile işlenir.

Büyük harf: yalnızca insan dilinde toLocaleUpperCase('tr-TR').

Sıralama: Intl.Collator('tr-TR').

İstisna: e-posta, token, UUID, URL üzerinde Türkçe büyük/küçük harf dönüşümü yapılmaz.

Arama: pg_trgm + unaccent (Türkçe özel karakter eşlemesi ile); "İ/ı duyarlı, aksansız eşleşme".

3.2. Veri hijyeni
TCKN: 11 hane, biçim + kontrol basamağı. Resmi doğrulama olarak sunulmaz.

VKN: 10 hane, biçim + kontrol basamağı. Resmi doğrulama olarak sunulmaz.

Telefon: normalize edilmiş temel numara; E.164 ayrı kolonda.

IBAN: boşluksuz, büyük harf.

Posta kodu: 5 hane.

4. KİMLİK, TENANT VE ŞİRKET MODELİ
4.1. Temel ayrım
Bir tenant, bir yasal işletmedir. Şube ve depolar tenant altındadır.

Bir kullanıcı birden fazla tenant üyesi olabilir; her tenant'ın aboneliği/yetkileri bağımsızdır.

Grup şirket konsolidasyonu ilk sürüm kapsamı dışıdır.

4.2. Ana tablolar
users, user_sessions, refresh_tokens, tenant_applications, tenants, tenant_users, tenant_invitations, branches, departments, tenant_user_departments, roles, user_roles, permissions, role_permissions, tenant_settings.

Tenant durum otoritesi: tek status alanı: pending, active, suspended, closed, archived. Ek is_active yoktur (çelişkili durum yaratmaz).

4.3. Şirket başvuru ve onay süreci
tenant_settings.onboarding_mode: auto | manual | hybrid. Varsayılan: manual.

text
Kullanıcı kayıt olur
   ↓
Şirket başvurusu
   ↓
onboarding_mode=auto    → PENDING → ACTIVE (transaction)
onboarding_mode=manual  → PENDING → SUPER/PLATFORM incelemesi → APPROVED/REJECTED
onboarding_mode=hybrid  → risk skoru düşükse auto, yüksekse manual
   ↓
TENANT + OWNER + varsayılan roller + ücretsiz haklar + varsayılan modüller
   ↓
Audit + outbox
Onay kilitli transaction içinde yürütülür. Başvuru ↔ tenant ilişkisi benzersiz (eşzamanlı iki onay iki şirket oluşturmaz).

E-posta gönderimi transaction dışı, outbox üzerinden.

4.4. tenant_settings
key	tip	varsayılan	kilit
onboarding_mode	enum	manual	platform
currency	char(3)	TRY	tenant
fiscal_year_start	smallint	1	tenant
timezone	text	Europe/Istanbul	tenant
negative_stock_policy	enum	block	tenant
default_vat_rate	numeric	20	tenant
website_url	text	null	tenant
logo_url	text	null	tenant
brand_name	text	null	tenant
support_email	text	null	tenant
Kilitli ayarlar yalnızca platform tarafından değiştirilir.

4.5. Kullanıcı yaşam döngüsü
Durumlar: invited, active, suspended, removed. Aynı global kullanıcı birden fazla tenant'ta farklı rol setine sahip olabilir.

4.6. Davet sistemi
Company Admin doğrudan şifre belirlemez; davet açar. Davet token'ları tek kullanımlık, süreli (7 gün), hash'li.

5. PLATFORM YÖNETİCİSİ VE OWNER
5.1. Platform yönetimi (v4.0.0'daki "Super Admin singleton" YERİNE)
Tek platform_owner:

text
platform_users
  id
  user_id (users.id FK, UNIQUE)
  is_platform_owner (BOOLEAN, NOT NULL DEFAULT FALSE)
  status
  created_at
  updated_at

CREATE UNIQUE INDEX uq_platform_owner
  ON platform_users (is_platform_owner)
  WHERE is_platform_owner = TRUE;
Diğer platform rolleri: platform_support, platform_sales, platform_finance, platform_readonly (platform_roles + platform_user_roles).

platform_owner kuralları:

Bootstrap + kurtarma prosedürü yazılı ve test edilmiş.

Son aktif platform_owner'i etkisiz bırakacak işlem engellenir.

Transfer: kilitli transaction + yeniden kimlik doğrulama + audit.

Çapraz tenant erişimi:

text
support_access_grants
  id
  tenant_id (tenants.id FK)
  platform_user_id (platform_users.id FK)
  reason (TEXT NOT NULL)
  scope (ENUM: read_only, read_write)
  granted_by (platform_users.id FK)
  granted_at (TIMESTAMPTZ NOT NULL)
  expires_at (TIMESTAMPTZ NOT NULL)
  revoked_at (TIMESTAMPTZ NULL)
  revoked_by (platform_users.id FK NULL)
Grant olmadan hiçbir platform kullanıcısı tenant verisi göremez. Her grant kullanımı ayrıca audit_logs'a yazılır. Süresi dolan grant otomatik pasif.

platform_settings: singleton değil; (key, value JSONB, updated_at, updated_by) anahtar-değer tablosu.

platform_owner yetkileri:

Tüm tenant'ları görebilir.

Başvuruları onaylar/reddeder.

Tenant askıya alabilir.

Platform modül/plan kataloğunu yönetir.

Platform seviyesinde audit görür.

support_access_grants açabilir (gerekçe zorunlu, süre zorunlu).

5.2. Tek aktif Owner (tenant)
Tenant başına en fazla bir aktif Owner; kısmi unique index ile korunur.

Her aktif tenant'ta en az bir Owner; aktivasyon, transfer, üyelik silme akışlarında doğrulanır.

Owner transferi tamamlanmadan mevcut Owner çıkarılamaz.

Transfer: kilitli transaction + yeniden kimlik doğrulama + audit.

5.3. Tenant durum anlamları
pending: Kullanılamaz.

active: Normal.

suspended: Politika doğrultusunda kısıtlı.

closed: Kapatıldı; erişim engellendi (detay §27.5).

archived: Yalnızca yetkili platform erişimine açık.

6. YETKİLENDİRME VE ÜRÜN HAKKI
Satın alma hakkı (entitlement) ≠ kullanıcı yetkisi (permission).

text
Kimlik doğrulama
  → Aktif kullanıcı
  → Aktif tenant üyeliği
  → Tenant durumu
  → Entitlement
  → Permission
  → Scope
  → Kayıt durumu ve dönem kilidi
  → ALLOW / DENY
Her API endpoint'i backend'de permission kontrolünden geçer; frontend buton gizleme yeterli değildir.

6.1. Permission standardı
Format: module.resource.action (bkz. GOVERNANCE §2 modül kodları).

Örnekler:

text
contacts.contact.read / create / update / delete
contacts.ledger.read / create
stock.product.read / create / update
stock.movement.post / adjust
trade.invoice.read / create / approve / export
trade.purchase_order.read / create / approve
trade.delivery.read / create
cashbank.payment.read / create / approve
cashbank.bank.read / import / reconcile
accounting.journal.read / create / approve
accounting.period.close
einvoice.document.send / cancel
management.task.read / create / assign / complete
management.calendar.event.create
management.notification.send
integrations.whatsapp.conversation.read
integrations.whatsapp.message.send
subscription.plan.manage
platform.tenant.manage
platform.support_access.grant
Kaldırılan formatlar: task.read, contact.write, crm.*, purchasing.*, logistics.*, accounting.invoice.*.

6.2. Scope modeli
role_permissions.scope enum: all, own_branch, own_department, assigned_only, created_by_me, self.

İlk sürümde fiilen kullanılan: all, created_by_me, assigned_only. Diğer scope'lar (own_branch, own_department, self) enum'da kalır ancak ilgili altyapı (branches yaygınlaşması, self-service) devreye girene kadar uygulanmaz; admin UI'da "yakında" etiketiyle gösterilir.

Deny öncelik sistemi ilk sürümde yoktur; izin kümeleri birleştirilir. Tenant engeli, kapalı modül, dönem kilidi bu birleşimin üzerinde uygulanır.

6.3. Permission değerlendirme zinciri
text
WHO? → Tenant Membership → Role(s) → Permission → Scope → Record-Level Policy → ALLOW/DENY
6.4. Yetki devri sınırı
roles.manage sınırsız izin dağıtma yetkisi değildir.

role_permissions.delegatable BOOLEAN DEFAULT TRUE — bir rolün izni devredilebilir mi?

Yönetici yalnızca kendi sahip olduğu ve delegatable = TRUE olan izinleri başka role atayabilir.

Kritik finansal onay (*.approve), platform izinleri ve Owner transferi ayrı işlemdir; delegatable = FALSE.

Yetki değişiklikleri oturum ve cache sürümlemesiyle etkili olur.

6.5. Permission kataloğu
text
permissions
  id UUID PK
  module TEXT NOT NULL              -- GOVERNANCE §2 module_code
  resource TEXT NOT NULL
  action TEXT NOT NULL
  code TEXT NOT NULL UNIQUE         -- module.resource.action
  name TEXT NOT NULL
  description TEXT
  is_system_permission BOOLEAN NOT NULL DEFAULT FALSE
  delegatable BOOLEAN NOT NULL DEFAULT TRUE

role_permissions
  tenant_id UUID NOT NULL
  role_id UUID NOT NULL
  permission_id UUID NOT NULL
  scope TEXT NOT NULL
  PRIMARY KEY (tenant_id, role_id, permission_id)
System permission kayıtları Company Admin tarafından silinemez.

Tam permission kataloğu ayrı dosyadadır: docs/api/permissions-catalog.md. Format, modül kodu (GOVERNANCE §2), resource, action ve delegatable bayrağını içerir. Kod tarafında tek kaynak: packages/shared/permissions.ts; katalog bu dosyadan üretilir ve CI'da senkron kontrolü yapılır.

6.6. Rol listesi
Platform: platform_owner, platform_support, platform_sales, platform_finance, platform_readonly.

Tenant:

OWNER (tenant başına tek)

COMPANY_ADMIN

MUHASEBE_YONETICISI

MUHASEBE_PERSONELI

FINANS_YONETICISI

SATINALMA

SATIS

LOJISTIK

DEPO

RAPORLAMA

MALI_MUSAVIR (harici; varsayılan salt okuma + dışa aktarma)

Kaldırılanlar: IK, URETIM (karşılık gelen modül yok; bordro/üretim kapsam dışı).

Hazır roller başlangıç şablonudur; Company Admin özel rol oluşturabilir (ücretsiz pakette en fazla 1, ücretli pakette sınırsız — README §4.2).

6.7. Departman / organizasyon
departments (id, tenant_id, parent_id, name, code, manager_user_id, is_active). Kullanıcı birden fazla departmana bağlanabilir.

6.8. Modül kataloğu ve tenant modül erişimi
text
modules (id, code, name, description, is_core, is_available)          -- GLOBAL
tenant_modules (tenant_id, module_id, status, enabled_at, enabled_by, settings)
Platform modül kataloğunu belirler; Company Admin yalnızca kendi tenant'ına açılmış ve planı kapsamındaki modülleri yönetir.

Modül kapalıysa frontend menüsünde gizlemek yeterli değildir; backend endpoint'i MODULE_NOT_ENTITLED döner.

6.9. Şirket profili
tenant_settings.settings JSONB içinde: website_url, primary_domain, logo_url, favicon_url, brand_name, display_name, support_email, support_phone.

Kaldırıldı: tenant_domains tablosu, domain_type enum, custom domain doğrulama. Website builder ilk sürümde yoktur; ihtiyaç doğduğunda ayrı ADR ile geri gelir.

7. TENANT İZOLASYONU
7.0. Tenant_id istisnaları
tenant_id taşımayan tablolar (GOVERNANCE §2 + §0.3):
users, platform_users, platform_roles, platform_user_roles, platform_settings, support_access_grants (dolaylı), modules, features, module_dependencies, plans, plan_versions, plan_features, plan_limits, prices, permissions, legal_texts, legal_acceptances, exchange_rates.

Bunlar gerçek global kayıtlardır.

7.1. RLS uygulaması
Uygulama rolü: app_user — superuser veya BYPASSRLS olamaz.

Migration rolü: app_migrator — ayrı.

Platform rolü: app_platform — platform tabloları için ayrı politika.

Politika: okuma USING, yazma WITH CHECK.

Uygun tablolarda FORCE ROW LEVEL SECURITY.

Bağlam: tenant kimliği transaction-local.

Bağlantı havuzu: tenant bağlamı başka isteğe taşınamaz.

sql
BEGIN;
SELECT set_config('app.tenant_id', $1, true);
-- Bu transaction içindeki tenant sorguları
COMMIT;
Bu kod tek başına güvenlik sağlamaz. $1 doğrulanmış üyelikten gelmeli ve ilgili tabloların RLS politikaları bulunmalıdır.

7.2. İlişkisel izolasyon
Child kaydın başka tenant'ın parent'ına bağlanması DB kısıtıyla engellenir.

sql
Parent: UNIQUE (tenant_id, id)
Child:  FOREIGN KEY (tenant_id, parent_id)
        REFERENCES parent (tenant_id, id)
Kritik ilişkilerde uygulanır: rol ataması, cari hareket, fatura satırı, stok hareketi.

7.3. Diğer veri yolları
Cache: anahtarda tenant + kullanıcı kapsamı.

Worker: güvenilir tenant bağlamı ve işlem anında doğrulama. outbox_events.tenant_id üzerinden yeniden kurulur.

Dosya: yetki kontrolü sonrası süreli URL.

WebSocket: sunucu tarafından doğrulanan oda üyeliği.

Rapor: dışa aktarmada aynı permission ve scope.

Destek: yalnızca support_access_grants + audit.

7.4. Platform erişim bağlamı
Normal tenant isteği:

text
JWT → User → Tenant Membership → Permission → RLS
Platform erişimi:

text
Platform JWT → platform_users → platform_role
   → support_access_grants (varsa, süreli) → İzole bağlam → Audit
RLS politikası istemciden gönderilen bir flag'e dayanamaz.

8. ABONELİK, ENTITLEMENT VE PLATFORM TİCARETİ
8.1. Kavram ayrımı (netleştirildi)
Module: satılan işlev grubu (modules.code).

Feature: teknik olarak kontrol edilen yetenek (features.code). Örn: multi_currency, api_access.

Plan limit: sayısal kota (plan_limits). Örn: max_users = 5, max_warehouses = 1.

Plan feature: planın içerdiği açık/kapalı yetenek (plan_features).

Entitlement: tenant'ın belirli bir modül/feature/limiti kullanma hakkı (tenant_entitlements).

Subscription: ücretli ticari ilişki.

Permission: kullanıcının işlemi yapabilme yetkisi.

Feature flag: yazılımın kontrollü dağıtımı; satın alma hakkı değildir.

Ücretsiz haklar için bitiş tarihi NULL olabilir. Her ücretsiz tenant için sahte bir ücretli abonelik oluşturulmaz.

plan_limits örnek alanları: max_users, max_products, max_warehouses, max_custom_roles, max_branches, max_api_keys, max_sms_credits. Ücretsiz pakette max_custom_roles = 1; ücretli pakette NULL (sınırsız). Kod tarafında checkLimit('max_custom_roles') çağrılır.

8.2. Tablolar — Faz dağılımı
Faz 1:
modules, features, plan_versions, plans, plan_features, plan_limits, prices, tenant_entitlements, tenant_module_settings, usage_counters, legal_texts, legal_acceptances (core modülü altında — ADR-0011).

Faz 4:
module_dependencies, subscriptions, subscription_items, subscription_changes, commercial_orders, commercial_order_items, billing_invoices, billing_invoice_lines, payment_attempts, billing_payments, billing_refunds, billing_allocations, provider_webhook_events, coupons, coupon_redemptions, partners, partner_referrals, partner_commissions.

Bu ayrım Faz 1 süresini korur.

8.3. Paket sürümleme
Müşteri satın aldığı fiyat ve kapsam sürümüne bağlanır. Yeni fiyat eski sözleşmeyi sessizce değiştirmez. Fiyat, vergi, indirim ve periyot sipariş üzerinde snapshot olarak tutulur.

Başlangıç: bir tenant → tek fatura para birimi + tek ana yenileme periyodu.

8.4. Kota kontrolü
Aktif kullanıcı/depo sayısı gibi kotalar transaction içinde kontrol edilir. Yalnızca Redis sayacına güvenilmez; usage_counters otoriter tablodur ve periyodik mutabakat yapılır.

Kota düşürülünce mevcut kayıt silinmez; yeni kayıt kısıtlanır, fazla kapasite gösterilir.

8.5. İlk ticari sürüm
Havale ve yetkili personel tahsilat doğrulaması desteklenir. Kartla otomatik yenileme iyzico ile eklenir. Kart numarası/CVV uygulamada saklanmaz; sağlayıcının barındırılan akışı tercih edilir.

8.6. Güvenli aktivasyon
text
Sipariş → Ödeme girişimi → Sağlayıcı/havale doğrulaması
   → Kalıcı ödeme kaydı → Fatura/alacak eşleştirme
   → Entitlement aktivasyonu → Audit + outbox
Tarayıcının başarı sayfasına yönlenmesi modül açmak için yeterli değildir. Webhook imzası doğrulanır; olay tekrarı engellenir; sağlayıcı işlem kimliği/tutar/para birimi/sipariş ilişkisi kontrol edilir.

8.7. Durumlar
text
Subscription: pending_activation | active | past_due | suspended | cancelled | expired
Payment:      pending | succeeded | failed | partially_refunded | refunded | disputed
Abonelik durumu ile ödeme durumu ayrıdır.

8.8. Yükseltme, düşürme, iptal
İlk sürümde proration (gün bazlı fark) yoktur.

Yeni modül: gösterilen dönem + bedel üzerinden açık onay.

Paket düşürme: dönem sonunda uygulanır.

İptal: otomatik yenilemeyi durdurur; dönem erişimi sözleşmeye göre sürer.

Gecikme: tanımlı tolerans sonrası ücretli yazma işlemleri kısıtlanır.

İade: ayrı finansal kayıt + hak geri alma politikası.

Ücretsiz erişim: tenant güvenlik nedeniyle kapalı değilse devam eder.

Zamanlanmış ücretli işlemler de hak kontrolü yapar.

8.9. Platform satış gelirleri
Platform ticari tabloları, tenant'ların satış faturalarından ayrıdır.

İşletmeci şirketin resmi muhasebesi için ayrı bir işletmeci tenant (tenants.is_operator = TRUE, tek satır) kullanılır. Platform tahsilatları bu şirkete idempotent aktarım ile yansıtılır.

Gösterge tanımları (net):

Tahsilat: Başarılı ödeme toplamı (iadeler ayrı).

Net nakit giriş: Tahsilat − iade − komisyon.

Faturalanan tutar: Düzenlenen hizmet faturaları (vergi ayrı).

MRR: Aktif yinelenen net abonelik bedelinin aylık karşılığı; yıllık ödemeler aylara normalize edilir.

ARR: MRR × 12; tahsil edilmiş gelir değildir.

Alacak: Faturalanmış, kapatılmamış.

Dönüşüm: Tanımlı grupta ücretsiz → ücretli.

Churn: müşteri kaybı ve gelir kaybı ayrı ölçülür.

9. FİNANSAL VERİ STANDARDI
9.1. Hassasiyet
Alan	Tip
Miktar	NUMERIC(20,6)
Birim fiyat	NUMERIC(20,6)
Döviz kuru	NUMERIC(20,8)
Vergi oranı	NUMERIC(9,6)
Ara hesaplar	NUMERIC(24,8)
Belge toplamı	NUMERIC(20,4)
FLOAT/DOUBLE yasak.

TypeScript: decimal.js.

API: parasal değerler decimal string.

Flutter (Faz 9): ikili floating-point kullanılmaz.

Yuvarlama: belge türü + vergi kuralına göre sürümlenir.

Doğruluk: sunucu sonucu otoritatiftir; istemci önizleme yapar.

9.2. Para birimi ve kur
Her parasal belge: işlem para birimi + kullanılan kur + yerel karşılık.

exchange_rates (global, tenant'a özel değil):

text
exchange_rates
  id UUID PK
  base_currency CHAR(3)
  quote_currency CHAR(3)
  rate NUMERIC(20,8)
  rate_type ENUM('buying','selling','effective')
  source ENUM('TCMB','manual','other')
  effective_date DATE
  created_at TIMESTAMPTZ
  UNIQUE (base_currency, quote_currency, rate_type, source, effective_date)
Tenant'a özel kur gerekirse tenant_exchange_rates ayrı tablo.

Farklı para birimleri doğrudan toplanmaz; konsolide tutarda kur tarihi + yöntem belirtilir.

9.3. Vergi kuralları
Vergi oranları ve kodları tarih etkili kataloglarda tutulur. Kesinleşmiş belge, katalog sonradan değişti diye yeniden hesaplanmaz; kural ve oran belgede snapshot'tır.

TCKN/VKN doğrulaması resmi doğrulama olarak sunulmaz.

10. FİNANSAL KAYITLARIN YAŞAM DÖNGÜSÜ
10.1. Kesinleştirme
text
draft → pending_approval → posted → (reversed | cancelled)
draft → posted onay gerektirmeyen işlemlerde doğrudan geçilebilir.

Kesinleşmiş finansal hareket düzenlenmez veya silinmez. Düzeltme ters kayıt, iade veya ilişkilendirilmiş düzeltme belgesi ile yapılır.

10.2. Durum geçiş matrisi
Geçiş	İzinli roller (örnek)	Zorunlu koşul
draft → pending_approval	Kaydı oluşturan	Onay akışı aktif
pending_approval → posted	MUHASEBE_YONETICISI, FINANS_YONETICISI	Onay yetkisi + dönem açık
draft → posted	Kaydı oluşturan	Onay akışı kapalı
posted → reversed	FINANS_YONETICISI + maker-checker	Ters kayıt belgesi + audit
posted → cancelled	Yasak	—
Aynı kural journal_entries, invoices, payments için ayrı ayrı uygulanır.

10.3. Aynı transaction ilkesi
Bir fatura kesinleştirilirken gerekli iç etkiler aynı transaction içinde oluşur:

Belge: başlık + satırlar.

Cari: alacak/borç hareketi.

Stok: politika gerektiriyorsa stok hareketi + stock_cost_entries (maliyet).

Muhasebe: modül aktifse fiş + satırlar.

Sistem: audit + outbox.

Stok maliyet kilidi: Aynı (tenant_id, product_id, warehouse_id) üçlüsünde eşzamanlı iki hareket çakışırsa SELECT ... FOR UPDATE ile stock_balances satırı kilitlenir; hareketli ortalama bu kilit altında güncellenir. Advisory lock kullanılmaz.

Harici e-belge gönderimi bu transaction içinde bekletilmez; outbox'a yazılır.

10.4. Çift kayıt önleme
Her kaynak işlem için (tenant_id, source_type, source_id, effect_type) unique olmalı.

Teslimat zaten stok düşürdüyse faturası ikinci kez düşürmez. Fatura cari hareket oluşturduysa yeniden kesinleştirme ikinci bakiye oluşturmaz.

10.5. Muhasebe dengesi
Fiş kesinleşirken yerel para biriminde toplam borç = toplam alacak. Kontrol yalnızca form doğrulamasına bırakılmaz; kesinleştirme servisi + transaction + DB kuralı ile korunur.

11. CONTACT VE CARİ ALT HESAP
11.1. Tek doğruluk kaynağı
Kural: contacts tablosunda phone, email, address, city, district inline alanları yoktur. Tüm iletişim verisi alt tablolardadır; primary kayıt contacts.primary_phone_id, primary_email_id, primary_address_id ile işaretlenir.

text
contacts
  id UUID PK
  tenant_id UUID NOT NULL
  contact_type ENUM('person','company')
  first_name TEXT
  last_name TEXT
  company_name TEXT
  display_name TEXT NOT NULL       -- hesaplanır, arama için denormalize
  tax_number TEXT                  -- VKN
  identity_number TEXT             -- TCKN
  primary_phone_id UUID NULL       -- contact_phones.id FK
  primary_email_id UUID NULL       -- contact_emails.id FK
  primary_address_id UUID NULL     -- contact_addresses.id FK
  notes TEXT
  source TEXT
  is_active BOOLEAN NOT NULL DEFAULT TRUE
  created_at, updated_at, created_by, updated_by, version, deleted_at

contact_roles
  contact_id, role ENUM('customer','supplier','lead','whatsapp_contact','appointment_owner','task_assignee')

contact_addresses (id, contact_id, type, line1, line2, city, district, postal_code, country, is_primary)
contact_phones   (id, contact_id, type, number, number_e164, is_primary)
contact_emails   (id, contact_id, type, email, is_primary)
contact_relations(id, contact_id, related_contact_id, relation_type)
Aynı contact aşağıdaki süreçlerde kullanılır: müşteri, tedarikçi, potansiyel, WhatsApp kişisi, randevu sahibi, görev ilgilisi. Her modül kendi kişi tablosunu oluşturmaz.

11.2. Cari alt hesap
party_accounts, party_ledger_entries, settlements, settlement_allocations.

Contact üzerinde elle güncellenen bakiye alanı otorite değildir. Bakiye kesinleşmiş alt hesap hareketlerinden üretilir (materialized view + trigger).

Tahsilatın birden fazla faturaya, bir faturanın birden fazla tahsilata bağlanması settlement_allocations ile desteklenir. Dağıtılmamış ödeme avans olarak izlenir. Aynı ödeme tutarı birden fazla belgeye fazla dağıtılamaz.

12. TİCARİ BELGE MODELİ
12.1. Tablo aileleri
sales_quotes / _lines, sales_orders / _lines, purchase_orders / _lines, deliveries / _lines, invoices / _lines, invoice_line_taxes, document_links, document_number_sequences.

Belge, karşı tarafın ünvan/adres/vergi bilgisini snapshot olarak tutar. Contact değişikliği geçmiş faturayı değiştirmez.

12.2. Durum alanları
Tek status alanı kullanılmaz. Beş ayrı alan:

business_status, posting_status, payment_status, fulfillment_status, einvoice_status.

İzinli kombinasyonlar (DB CHECK ile):

posting_status = 'draft' iken payment_status = 'paid' olamaz.

business_status = 'cancelled' iken posting_status != 'draft' olamaz.

einvoice_status = 'sent' ise posting_status ∈ {'posted','reversed'}.

fulfillment_status = 'delivered' ise en az bir delivery kaydı zorunlu.

12.3. Numara üretimi
MAX(number) + 1 yasak. Tenant + belge türü + seri + dönem bazında kilitli sayaç:

sql
BEGIN;
SELECT last_number FROM document_number_sequences
  WHERE tenant_id = $1 AND doc_type = $2 AND series = $3 AND year = $4
  FOR UPDATE;
UPDATE document_number_sequences SET last_number = last_number + 1 ...
COMMIT;
Resmi e-belge numaralama gereksinimleri ayrıca uygulanır.

13. KASA, BANKA VE GİDER
13.1. Kasa/banka
cash_accounts, bank_accounts, cash_transactions, bank_transactions, account_transfers, bank_import_batches, bank_import_rows, bank_reconciliation_matches.

Virman tek para birimindeyse dengeli; dövizlide kaynak tutar, hedef tutar, kur ve komisyon ayrı.

Banka dosyası yüklemek doğrudan muhasebe kaydı oluşturmaz; önce mükerrer kontrol + kullanıcı eşleştirmesi.

13.2. Gider modeli
Gider ayrı tablodadır (alış faturası değildir; invoices içinde document_kind=expense de değildir).

text
expense_categories (id, tenant_id, name, parent_id, default_account_id, is_active)

expenses
  id UUID PK
  tenant_id UUID NOT NULL
  category_id UUID NULL
  payment_account_type ENUM('cash','bank','credit_card')
  payment_account_id UUID
  document_date DATE NOT NULL
  amount NUMERIC(20,4) NOT NULL
  vat_rate NUMERIC(9,6)
  vat_amount NUMERIC(20,4)
  description TEXT
  counterparty_contact_id UUID NULL
  attachment_id UUID NULL
  posting_status ENUM('draft','pending_approval','posted','reversed')
  journal_entry_id UUID NULL
  created_at, updated_at, created_by, updated_by, version
Gider kesinleşince: cari (varsa) + muhasebe (aktifse) aynı transaction'da.

14. STOK VE MALİYET
products, product_barcodes, units, unit_conversions, warehouses, stock_documents, stock_document_lines, stock_movements, stock_balances, stock_reservations, inventory_counts, inventory_count_lines, stock_cost_entries.

stock_balances bir performans özetidir; hareketlerle mutabık olmalıdır.

14.1. Maliyet yöntemi
İlk ücretli stok sürümünde hareketli ağırlıklı ortalama. FIFO aynı anda eklenmez.

Başlangıç politikasında negatif stok engellenir (kilitli ayar tenant_settings.negative_stock_policy = 'block'). İzin verilirse sonradan maliyet düzeltmesi ayrıca tasarlanır.

Geri tarihli hareketlerin maliyeti bozmasını önlemek için kapalı stok dönemine yazma engellenir.

14.2. Sayım ve transfer
Sayım miktarı doğrudan değiştirmez; onaylandığında fark hareketi oluşturur.

Depo transferi çıkış + giriş etkilerini tek işlem olarak üretir. Transit depo gerekiyorsa ayrı teslim alma aşaması.

14.3. Entitlement eşlemesi
Özellik	Ücretsiz	Ücretli
Ürün sayısı	plan_limits.max_products = 100	sınırsız
Depo sayısı	plan_limits.max_warehouses = 1	çoklu
Bakiye özet	✅	✅
Sayım	✅	✅
Maliyet	✅ (WAvg)	✅
Çoklu depo transfer	❌	✅
15. MUHASEBE VE DÖNEM KONTROLÜ
fiscal_periods, accounting_accounts, journal_entries, journal_lines, posting_rules, account_mappings, period_locks.

Dönem kilidi: Belirlenen tarihe kadar geriye dönük kayıt engeli.

Hesap kontrolü: Hareketli hesap silinemez.

Kaynak ilişkisi: Otomatik fiş ticari belgeye bağlı.

Tekrar üretim: Aynı kaynak için ikinci otomatik fiş engellenir.

Düzeltme: Kaynak + muhasebe düzeltmeleri birlikte izlenir.

Genel muhasebe devreye alınmadan önce oluşmuş ön muhasebe kayıtları için kesim tarihi belirlenir. İlk yaklaşım: doğrulanmış açılış fişi + açık kalem aktarımı; geçmişi sessizce yeniden muhasebeleştirmek yasak.

Gap-free yevmiye numarası zorunlu.

16. GÖREV, TAKVİM, RANDEVU, HATIRLATICI
Bu modülün tamamı Faz 7 kapsamındadır.

16.1. Görev
tasks (id, tenant_id, title, description, status, priority, created_by, assigned_to, due_at, completed_at, source, related_entity_type, related_entity_id, + ortak kolonlar).

status: todo | in_progress | waiting | completed | cancelled

priority: low | normal | high | urgent

RRULE ile tekrarlayan görevler.

16.2. Hatırlatıcı
reminders (id, tenant_id, user_id, task_id, event_id, remind_at, channel, status, + ortak kolonlar).

channel: push | in_app | email | whatsapp | sms

Tek görev için farklı zaman/kanal desteklenir.

16.3. Takvim ve randevu
calendars, calendar_events, appointments.

calendar_events: kişisel/şirket/personel, paylaşım, görünürlük, RRULE, timezone ayrı kolon.

appointments.status: pending | confirmed | completed | cancelled | no_show.

Çakışma kontrolü: aynı calendar_id + owner_user_id için örtüşen etkinlik engeli (ayardan).

16.4. Tarih standardı
Anlık olay: TIMESTAMPTZ.

Belge tarihi: DATE.

Tüm gün etkinliği: yerel tarih aralığı.

Tekrar: yerel saat + IANA timezone + RRULE.

TIMESTAMPTZ özgün timezone adını saklamaz; tekrarlayan olayın timezone alanı ayrı tutulur.

16.5. Notlar ve aktiviteler
notes, activities. activities kullanıcıya işletme akışını özetler; audit_logs güvenlik ve değişiklik takibi içindir. Ayrıdır.

17. BİLDİRİM DOMAINİ
Bu modülün tamamı Faz 7 kapsamındadır.

notifications, user_devices, notification_deliveries, notification_preferences.

17.1. Bildirim türleri kataloğu (merkezi enum)
text
notification_type ENUM:
  task.assigned
  task.due_soon
  task.overdue
  appointment.upcoming
  appointment.created
  whatsapp.message_received
  invoice.due_soon
  invoice.overdue
  payment.received
  cash.low_balance
  stock.critical
  user.mentioned
  subscription.payment_failed
  subscription.expiring
  system.security_alert
  system.announcement
notification_preferences.notification_type bu enum'a bağlıdır; serbest string değildir.

17.2. Görev tamamlandı ≠ hatırlatıcı tetiklendi ≠ bildirim teslim edildi
Üç ayrı olay, üç ayrı kayıt.

E-posta şablon envanteri: docs/product/email-templates.md (olay → şablon adı → değişkenler → öncelik). Şablon metinleri Faz 2 öncesi doldurulur.

18. WHATSAPP ENTEGRASYON DOMAINİ
Faz 8 — Bu bölüm ilk sürüm sözleşmesi DEĞİLDİR.
Tetikleyici: ücretli müşterilerin ≥ %20'si talep ederse (ROADMAP §6).

Tablolar: integrations, integration_credentials, webhook_events, external_mappings, whatsapp_accounts, whatsapp_conversations, whatsapp_messages, message_status_events.

Kurallar:

Erişim tokenları/secret değerleri AES-256-GCM ile şifreli; düz metin yasak.

external_message_id unique + idempotent.

Mesaj durum olayları sırasız gelebilir; read olmuş mesaj geç gelen sent ile geriye düşmez.

Sağlayıcının güncel şablon/izin/iletişim kuralları entegrasyon kabul kriteridir.

19. GÜVENİLİR QUEUE VE OUTBOX
Queue altyapısı hatırlatıcı ve abonelikten önce kurulur (Faz 1).

19.1. outbox_events şeması
text
outbox_events
  id UUID PK
  tenant_id UUID NOT NULL              -- worker bağlamı için zorunlu
  aggregate_type TEXT NOT NULL         -- 'invoice','task','appointment',...
  aggregate_id UUID NOT NULL
  event_type TEXT NOT NULL             -- 'InvoicePosted','TaskCreated',...
  payload JSONB NOT NULL
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  published_at TIMESTAMPTZ NULL
  attempts INTEGER NOT NULL DEFAULT 0
  last_error TEXT NULL
  status ENUM('pending','published','failed') NOT NULL DEFAULT 'pending'

INDEX (status, created_at) WHERE status = 'pending'
INDEX (tenant_id, aggregate_type, aggregate_id)
UNIQUE (tenant_id, aggregate_type, aggregate_id, event_type)   -- idempotent
19.2. Akış
text
İş transaction'ı
   → İş kaydı + outbox_events
   → Commit
   → Dispatcher
   → BullMQ (jobId = outbox_events.id)
   → Worker
   → Sonuç / retry / failed
PostgreSQL commit sonrası Redis hatası iş olayının kaybolmasına yol açmamalıdır (outbox kalıcıdır).

Tam bir kez teslim varsayılmaz. En az bir kez teslim + idempotent işleme.

Retry: artan bekleme + üst sınır.

Kalıcı hata: başarısız işler ekranı.

Tekrar çalıştırma: yetki + audit.

Hatırlatıcı: veritabanından yeniden üretilebilir zamanlama.

Sağlayıcı çağrısı: destekleniyorsa idempotency anahtarı; belirsiz timeout için durum sorgusu.

19.3. Event örnekleri
TaskCreated, TaskCompleted, AppointmentCreated, AppointmentStartingSoon, WhatsAppMessageReceived, InvoiceOverdue, PaymentReceived, UserMentioned.

Bir iş olayının birden fazla sonucu olabilir:

text
AppointmentStartingSoon
   ├── Push
   ├── In-App
   └── WhatsApp Reminder
20. WEBHOOK VE ENTEGRASYON
integrations, integration_credentials, webhook_events, external_mappings.

text
webhook_events
  id UUID PK
  tenant_id UUID NOT NULL
  integration_id UUID NOT NULL
  event_type TEXT NOT NULL
  external_event_id TEXT NOT NULL
  payload JSONB NOT NULL
  signature TEXT
  processed_at TIMESTAMPTZ NULL
  status ENUM('received','processing','processed','failed') NOT NULL
  error_message TEXT NULL
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE (integration_id, external_event_id)
Kurallar:

Gövde boyutu sınırlandırılır.

İmza, sağlayıcının beklediği ham içerikle doğrulanır.

Tenant, doğrulanmış sağlayıcı hesabından çözülür.

Olay kalıcı ve benzersiz kaydedilir.

Hızlı cevap verilir; worker iş etkisini uygular.

Harici ID benzersizliği sağlayıcı + hesap bağlamıyla tanımlanır. UNIQUE kısıt şart.

21. E-BELGE YAKLAŞIMI
Karar: Tek özel entegratör, EDocumentPort arayüzü üzerinden.

Kaldırılan (v4.0.0'daki): "UBL-TR standardı … XSD/Schematron … korunur" cümlesi. Biz JSON/REST konuşuruz; UBL-TR XML doğrulaması entegratörün sorumluluğundadır.

21.1. Port imzası
typescript
interface EDocumentPort {
  send(invoice: InvoiceSnapshot): Promise<SendResult>;
  queryStatus(providerRef: string): Promise<StatusResult>;
  cancel(providerRef: string, reason: string): Promise<CancelResult>;
  fetchInbox(since: Date): Promise<InboxItem[]>;
}
Her metot idempotent olmalı; send aynı invoice.id ile ikinci kez çağrılırsa önceki sonucu döner.

Not: fast-xml-parser yalnızca entegratör payload'ını parse etmek için kullanılır; XSD/Schematron doğrulayıcı değildir.

21.2. Güvenlik
XML dış varlıkları (XXE) ve tehlikeli dönüşümler engellenir.

Belirsiz sonuç: tekrar göndermeden önce sağlayıcıda durum sorgusu.

21.3. Tablolar
einvoice_outbox, einvoice_inbox, einvoice_documents, einvoice_status_events. Orijinal belge + sağlayıcı cevabı arşivlenir.

22. API SÖZLEŞMESİ
text
/api/v1/auth
/api/v1/platform
/api/v1/tenants
/api/v1/users
/api/v1/contacts
/api/v1/contacts/ledger
/api/v1/stock
/api/v1/trade
/api/v1/trade/invoices
/api/v1/trade/purchase-orders
/api/v1/trade/deliveries
/api/v1/trade/expenses
/api/v1/cashbank
/api/v1/accounting
/api/v1/einvoice
/api/v1/management
/api/v1/management/tasks
/api/v1/management/calendar
/api/v1/management/appointments
/api/v1/management/notifications
/api/v1/integrations
/api/v1/integrations/whatsapp
/api/v1/webhooks
/api/v1/subscription
/api/v1/billing
/api/v1/dashboard
/api/v1/attachments
/api/v1/import
/api/v1/export
/api/v1/reports
/api/v1/audit
OpenAPI üretimi: docs/api/openapi.yaml Zod şemalarından otomatik üretilir (zod-to-openapi). Tek doğruluk kaynağı Zod'dur (packages/shared). Doküman koddan türetilir; çift bakım yapılmaz (ADR-0013).

22.1. Başarı ve hata
json
{ "success": true, "data": {}, "meta": {}, "requestId": "..." }
json
{
  "success": false,
  "error": {
    "code": "PERIOD_LOCKED",
    "message": "Bu dönem işlem girişine kapalıdır.",
    "details": {}
  },
  "requestId": "..."
}
22.2. Kurallar
HTTP: anlamlı kodlar.

Pagination kuralı (kesin):

Hareket tabloları (*_ledger_entries, *_movements, audit_logs, notifications, whatsapp_messages): cursor tabanlı.

Kart listeleri (contacts, products, warehouses): offset tabanlı (kararlı sıralama + tie-breaker).

Filtre: allowlist + sınırlı sorgu.

Eşzamanlılık: version veya If-Match (bkz. §0.5).

Idempotency: finansal kesinleştirme, ödeme, WhatsApp, senkronizasyon için Idempotency-Key başlığı zorunlu.

Hata: yetkisiz kaydın varlığını gereksiz açığa çıkarmayan cevap.

OpenAPI: docs/api/openapi.yaml — web/mobil sözleşmesinin ortak kaynağı (Zod'dan üretilir).

Hata kodu kataloğu: packages/shared/errors/codes.ts (kod) + docs/api/error-codes.md (insan-okur katalog: kod, HTTP, modül, mesaj, açıklama). Kod tarafı tek kaynak; doküman koddan türetilir. PERIOD_LOCKED, MODULE_NOT_ENTITLED, LIMIT_EXCEEDED, VERSION_MISMATCH, IDEMPOTENCY_KEY_CONFLICT, TENANT_FORBIDDEN, SUPPORT_ACCESS_REQUIRED vb.

23. IMPORT, EXPORT VE DOSYA GÜVENLİĞİ
23.1. Import
text
Yükleme
  → Boyut/tür/güvenlik kontrolü
  → Kolon eşleştirme
  → Dry-run
  → Hata raporu
  → Onay
  → Kontrollü batch işlemleri (eşik: 1000 satır üstü kuyruk)
Büyük dosya tek uzun transaction içine alınmaz; finansal belgede transaction birimi belgedir.

Tekrarlanan import mükerrer kayıt oluşturmaz. Eşleştirme anahtarları kullanıcıya açıkça gösterilir.

Excel/CSV toplu yüklemede satır bazlı Zod doğrulama.

Import şablon sözleşmeleri: docs/product/import-templates/ (cari, ürün, açılış bakiyeleri, açılış stoğu). Her biri için kolon adı, tip, zorunluluk ve örnek satır tanımlıdır. Gerçek .xlsx örnek dosyalar Faz 2'de üretilir.

23.2. Tam veri dışa aktarma (ZIP)
"Veri rehin alınmaz" ilkesi (README §4.1) doğrultusunda:

ZIP içeriği:

manifest.json — şema sürümü, tenant_id, export tarihi, tablo listesi, satır sayıları.

data/*.csv — UTF-8 BOM, tablo başına bir dosya. Finansal tablolar dahil tüm tenant verisi.

files/ — S3'teki tüm attachments, orijinal adlarıyla.

pdfs/invoices/ — üretilmiş iç fatura PDF'leri (varsa).

README.txt — sütun açıklamaları + tarih formatları.

Kurallar:

Üretim asenkron (worker). Süre: veri hacmine göre 24 saate kadar.

Tek kullanımlık, süreli (7 gün) indirme linki.

ZIP içeriği şifrelenmez (kullanıcı kendi verisidir), ancak link yetkilidir.

Export sırasında yeni kayıt yazılırsa "snapshot" tutarlılığı için transaction isolation: repeatable read altında okunur.

23.3. Dosyalar
text
attachments
  id UUID PK
  tenant_id UUID NOT NULL
  file_name TEXT
  original_name TEXT
  mime_type TEXT
  file_size BIGINT
  storage_key TEXT
  uploaded_by UUID
  entity_type TEXT      -- allowlist: 'invoice','expense','contact','product','task','appointment'
  entity_id UUID
  created_at TIMESTAMPTZ
Allowlist: entity_type yalnızca yukarıdaki değerlerden biri olabilir; ajan keyfine göre ekleme yapamaz.

Özel bucket + süreli URL.

MIME + uzantı + gerçek içerik + boyut kontrolü.

Şüpheli dosya karantina.

CSV/Excel'de formula injection önlemi.

PDF'te Türkçe font.

Silme: retention + referans kontrolü sonrası.

Dosya içeriği DB'ye gömülmez; object storage + metadata.

24. UX/UI STANDARTLARI
Anlık autocomplete: tüm arama/seçim alanlarında debounce.

Tablo sıralama: kolon bazlı Asc/Desc.

Master-detail / drawer: liste detayları sağ çalışma alanında veya mobil bottom-sheet; gereksiz tam sayfa yönlendirme yok.

Context-aware quick actions:

Faz 2: Müşteri → [+Not]

Faz 3+: Müşteri → [+Fatura] [+Tahsilat]

Faz 7: Müşteri → [+Görev] [+Randevu]

Faz 8: Müşteri → [+WhatsApp]

Ortak bileşenler: Button, Modal, Drawer, Table, Pagination, DatePicker, MoneyInput, PhoneInput, EmptyState, ErrorState.

Erişilebilirlik (a11y): Hedef WCAG 2.1 AA. Klavye navigasyonu tüm ekranlarda zorunludur; renk körlüğü kontrolü; aria-* kuralları; axe-core testi CI'da zorunludur (npm run test:a11y).

Tam ekran listesi: docs/product/screens.md (route, ekran adı, rol, permission, faz, ilgili API).

25. WEB VE MOBİL
Web önce responsive + PWA (Faz 2).

Flutter, kararlı API ve kanıtlanmış iş akışları üzerine kurulur; Faz 9, koşullu.

İlk mobil kapsam (PWA): okuma, görev, randevu, bildirim.

Offline finansal kesinleştirme ilk sürümde yoktur. Çevrimdışı finansal belge yalnızca taslak.

Tarayıcı desteği: Chrome, Edge, Firefox, Safari son 2 sürüm; iOS Safari 16+; Android Chrome 100+. Internet Explorer desteklenmez. PWA özellikleri (service worker, IndexedDB, Web Push) yalnızca desteklenen tarayıcılarda garanti edilir; desteklenmeyenlerde otomatik fallback.

25.1. Güvenli token saklama
PWA: HttpOnly + Secure + SameSite=Strict refresh cookie; access token bellekte (localStorage yasak).

Flutter (Faz 9): Android Keystore / iOS Keychain.

25.2. Çok kiracılı istemci
Mobil kullanıcı giriş yaptığında yetkili tenant listesi alır. Aktif şirket bağlamı backend'e taşınır.

Backend'de tenant kimliği yalnızca istemciden gelen başlığa güvenilerek değil, kimlik doğrulama + yetki bağlamıyla doğrulanır. RLS nihai veri izolasyon katmanıdır.

25.3. Offline senkronizasyon (Faz 9)
client_operation_id, entity_id, base_version, operation_type, payload, sync_cursor, sync_status, retry_count, last_error.

Çakışma: sürüm kontrolü.

Silme: tombstone.

Yetki: senkronizasyon anında yeniden kontrol.

Sessiz client wins yasak.

Sunucu aynı client_operation_id ile gelen işlemi ikinci kez uygulamaz.

26. YÖNETİCİ / PATRON YÖNETİM ÇEKİRDEĞİ
Bu bölüm Faz 7 kapsamındadır.

Dashboard verileri ana iş tablolarından sorgulanır; gereksiz şekilde tekrar veri tutulmaz. Performans için materialized view kullanılabilir.

Patron Görünümü v3 trafik ışığı göstergeleri kural bazlıdır; yapay "sağlık skoru" yoktur.

27. GÜVENLİK VE VERİ YÖNETİŞİMİ
27.1. Kimlik güvenliği
Parola: Argon2id, uygun kaynak parametreleri.

Web oturumu: kısa ömürlü access token + HttpOnly refresh cookie.

CSRF: cookie akışlarında koruma.

Refresh: rotation + hash'li saklama + tekrar kullanım tespiti.

MFA: platform kullanıcıları ve kritik roller için zorunlu.

Mobil: işletim sistemi güvenli saklama (Faz 9).

Sır yönetimi: Faz 0–3 — SOPS ile şifrelenmiş .env + sunucu dosya izinleri (600) + git-crypt. Faz 4+ — Doppler veya AWS Secrets Manager'a geçiş; ADR ile. Veritabanından ayrı anahtar + rotasyon planı zorunlu.

SQL Injection: parameterized sorgular.

Helmet, CORS, rate limiting, security headers.

Entegrasyon secret: şifreli saklama; log'a yazılmaz.

27.2. KVKK ve saklama
Veri işleme amaçları, hukuki dayanak, rol dağılımı, alt işleyenler ve saklama süreleri dokümante edilir.

Minimizasyon: gereksiz TCKN/hassas veri toplanmaz.

İletişim: pazarlama izni, hizmet mesajı, sözleşme kabulü ayrı.

Talep yönetimi: erişim, düzeltme, silme.

Aktarım: yurt dışı servis kullanımı ayrıca değerlendirilir.

Yedek: silme politikası yedek yaşam döngüsünü de kapsar.

Hukuki metinler ve resmi muhasebe yükümlülükleri üretim öncesinde yetkili hukuk + mali müşavir onayından geçmelidir.

Yasal metin şablonları: docs/legal/ (kvkk-aydinlatma.md, kullanim-kosullari.md, cerez-politikasi.md, dpa.md, pilot-dpa.md, ortak-komisyon-sozlesmesi.md). Boş şablonlar Faz 0'da oluşturulur; metinler Faz 2 öncesi doldurulur ve hukukçu onayından geçer.

27.3. Audit
audit_logs: aktör, tenant, işlem, nesne, zaman, request ID, maskelenmiş değişiklik özeti.

app_user audit kayıtlarını güncelleyemez veya silemez. Koruma: ayrı rol + trigger + WAL arşivi. (Bu, veritabanı yöneticisine karşı mutlak değişmezlik iddiası değildir.)

Kritik: finansal, yetkisel, iletişim ve veri silme/güncelleme işlemleri.

27.4. Logging
Ortak altyapı (pino); her modül farklı format kullanamaz.

Minimum alanlar: requestId, tenantId, userId, module, action, level, message, timestamp, metadata.

Parola, token, WhatsApp tokenı ve tüm gizli bilgiler loglara yazılmaz.

27.5. Tenant kapanış ve KVKK silme durum makinesi
text
active
  └─(kapatma talebi veya ödeme sorunu)→ suspended
       ├─(ödeme düzelir)→ active
       └─(süre dolarsa)→ closed
            └─(30 gün sonra)→ archived
                 └─(7 yıl sonra, VUK/TTK)→ purge

purge: kalıcı silme/anonimleştirme
       finansal kayıtlar → anonimleştirilir, silinmez
       kişisel veriler   → silinir (KVKK)
       audit kayıtları   → saklanır (yasal)
       yedeklerdeki kopya→ 30 gün içinde düşer (rotation)
data_retention_policies tablosu:

text
data_retention_policies
  id
  data_category        -- 'financial','personal','audit','logs','attachments'
  retention_days       -- financial: 2555 (7 yıl), personal: 90, logs: 180
  action               -- 'delete','anonymize','archive'
  legal_basis
  is_active
Kurallar:

closed durumunda yazma erişimi yok; salt okuma 30 gün.

archived durumunda yalnızca platform erişimi.

Silme fiziksel dosya + DB satırı dahil; yedekler 30 gün içinde rotation ile temizlenir.

Export hakkı closed aşamasında son 30 gün açık kalır.

Seed değerleri:

data_category	retention_days	action	legal_basis
financial	2555 (7 yıl)	anonymize	VUK/TTK
personal	90	delete	KVKK
audit	3650 (10 yıl)	archive	yasal saklama
logs	180	delete	operasyonel
attachments	2555 (finansal referanslı) / 90 (kişisel)	delete	VUK/TTK + KVKK
28. PLATFORM VE ŞİRKET YÖNETİM EKRANLARI
28.1. Platform paneli (platform_owner + roller)
text
Dashboard
├── Tenantlar
├── Şirket Başvuruları
├── Kullanıcılar (platform)
├── Tenant Kullanıcıları
├── Modüller
├── Planlar / Limitler
├── Entegrasyonlar
├── System Health
├── Audit Logs
├── Destek Erişim Grant'ları
└── Platform Ayarları
28.2. Tenant Admin ekranı
text
Şirketim
├── Genel Ayarlar
├── Kullanıcılar
├── Departmanlar
├── Roller & Yetkiler
├── Modüller
├── Şirket Web Bilgileri
├── Davetler
├── Onay Akışları
└── Audit / Aktivite
29. YAZILIM MİMARİSİ VE KODLAMA PRENSİPLERİ — SOLID + DRY
Bu bölüm bağlayıcıdır. Tüm backend, frontend, mobil, queue/worker ve entegrasyon kodları uyar.

29.1. SOLID — İhlal örnekleri
S (Single Responsibility):

❌ WhatsAppService içinde: mesaj gönderme + SQL + yetki + bildirim + PDF + log.

✅ WhatsAppController, WhatsAppService, WhatsAppRepository, WhatsAppProvider, NotificationService, AuditService ayrı.

O (Open/Closed):

❌ if (provider === 'meta') {...} else if (provider === 'twilio') {...} business logic içinde.

✅ NotificationProvider interface + PushProvider, EmailProvider, WhatsAppProvider, SmsProvider implementasyonları.

L (Liskov):

❌ MockEInvoiceProvider, send() içinde belirsiz exception fırlatır.

✅ Mock, gerçek provider ile aynı sözleşmeyi sağlar.

I (Interface Segregation):

❌ Tek IEntityService içinde read/create/update/delete/approve/export/archive.

✅ Readable<T>, Writable<T>, Approvable, Exportable küçük arayüzler.

D (Dependency Inversion):

❌ InvoiceService doğrudan iyzico SDK import eder.

✅ PaymentPort interface + IyzicoAdapter, MockAdapter.

29.2. DRY — Tek kaynak ilkesi
Tek kaynaktan yönetilir:

Validation kuralları (Zod şemaları)

Permission kuralları

Status tanımları

İş kuralları

Tarih/saat yardımcıları

Para/Decimal yardımcıları

Telefon normalizasyonu

Hata kodları (packages/shared/errors/codes.ts)

API yanıt sözleşmesi

Aşırı soyutlama yasağı: Yalnızca yüzeysel benzerlik gösteren kodlar zorla birleştirilmez.

29.3. Domain sınırları
text
✅ AppointmentService → ContactPort → ContactService

❌ AppointmentService → ContactRepository → PostgreSQL
29.4. Backend katman standardı
text
Route / Controller → Application Service → Domain Logic
   → Repository / Port → Infrastructure Adapter → DB / External API
Controller: HTTP request/response. İş kuralı yok, SQL yok, harici API yok.

Service: İş kuralları. Transaction sınırı. Repository/Port üzerinden veri.

Repository: Veri erişimi. SQL/Drizzle detayı buraya. İş kuralı yok.

29.5. Frontend ve mobil
UI bileşenleri küçük parçalara ayrılır (Header, FilterBar, DataList, DetailDrawer, ActionBar).

API çağrıları api/ katmanından — ekranlara kopyalanmaz.

getContacts() 7 farklı ekranda tekrar yazılmaz.

29.6. Validation tek kaynağı
Zod şemaları merkezi: contact.schema.ts, phone.schema.ts, pagination.schema.ts, appointment.schema.ts.

TypeScript istemci ile sunucu paylaşır; Flutter doğrudan TS kullanmaz, OpenAPI + ortak test örnekleriyle uyum sağlar.

Kritik doğrulamanın otoritesi backend'dir.

29.7. God class / God service yasağı
MegaService (CRM + WhatsApp + Fatura + Tahsilat + Bildirim + Personel) oluşturulmaz.

29.8. Copy-paste development yasağı
Tekrarlanan kod tespit edilince:

Aynı iş kuralı mı?

Ortaklaştırılabilir domain service mi?

Ortak utility mi?

Ortak component mi?

Yoksa yalnızca yüzeysel benzerlik mi?

Gerçek tekrar → merkezi çözüm. Yüzeysel benzerlik → zorla birleştirme yok.

29.9. Mimari öncelik sırası
text
1. Domain sınırını belirle
2. İş kuralını tanımla
3. Interface/contract oluştur
4. Application Service'i tasarla
5. Repository/adapter sınırını belirle
6. Validation şemasını oluştur
7. API endpointini ekle
8. UI/Mobile ekranını bağla
9. Testleri yaz
10. Log/audit/metric ekle
11. Code review + SOLID/DRY kontrolü
29.10. Ana kural
Yeni özellik eklemek, mevcut çalışan mimariyi gereksiz yere bozmaz. Yeni kod, mevcut domain sınırlarına, SOLID ve DRY'a, ortak sözleşmelere uyar.

29.11. Modüler backend dizin yapısı
text
src/
├── modules/
│   ├── core/
│   ├── platform/
│   ├── contacts/
│   ├── stock/
│   ├── trade/
│   ├── cashbank/
│   ├── einvoice/
│   ├── subscription/
│   ├── accounting/
│   ├── cheque/
│   ├── reports_plus/
│   ├── management/
│   ├── sms/
│   └── integrations/
├── db/
├── middleware/
├── queues/
├── workers/
└── shared/
30. TEST, İŞLETİM VE KALİTE KAPISI
30.1. Test katmanları
Unit: Finans hesabı, durum geçişi, permission.

Integration: PostgreSQL, RLS, transaction, migration.

API: Yetkisiz erişim, hata, idempotency.

E2E: Kayıt, şirket açılışı, cari, stok, satın alma.

Entegrasyon: Webhook tekrarı, sırasız olay.

İşletim: Yedekten dönüş, worker yeniden başlatma.

Modül bazlı regresyon: Repository, permission, tenant isolation, queue-worker.

Zorunlu regresyon: kritik finansal işlemler, yetkilendirme, tenant izolasyonu, dış entegrasyonlar.

30.2. Performans hedefleri (kabul edilecek hedef)
Liste API: p95 < 500 ms (temsili yükte).

Dashboard API: p95 < 1 s (temsili yükte).

Ağır rapor: asenkron.

Sorgu: sayfalama + uygun index + sınırlı veri.

Kapasite: veri hacmi + eşzamanlı kullanıcı test raporunda.

Frontend performans bütçesi (staging, masaüstü, temsili yükte):

Metrik	Hedef
Initial JS bundle (gzip)	< 250 KB
Route lazy chunk (gzip)	< 100 KB
LCP	< 2.5 s
CLS	< 0.1
TBT	< 200 ms
Lighthouse Performance	≥ 85
CI'da bundle-size kontrolü zorunludur; eşik aşımı PR'ı reddeder.

30.3. Yedek ve kurtarma
Hedefler: RPO ≤ 1 saat, RTO ≤ 4 saat. Bunlar ölçülmeden SLA olarak satılmaz.

Strateji:

Katman	Sıklık	Saklama	Şifreleme	Konum
PostgreSQL tam	Günlük	7 gün	pgBackRest + AES-256	Yerel + farklı sağlayıcı
PostgreSQL WAL	Sürekli	35 gün	AES-256	Farklı bölge
PostgreSQL aylık arşiv	Aylık	12 ay	AES-256	Farklı bölge (cold)
Object storage (S3/MinIO)	Günlük bucket snapshot	30 gün	Sunucu tarafı	Farklı bölge
Şifreleme anahtarları	Değişimde	Süresiz	Ayrı vault (SOPS/Doppler)	Kurtarma planında
Kurtarma planı: PostgreSQL + object storage + yapılandırma + şifreleme anahtarları birlikte kurtarılır. Tenant bazlı kurtarma ayrı senaryodur; tüm DB geri yüklenerek diğer şirketlerin yeni verileri kaybedilmez.

Prosedür: docs/operations/restore-drill-YYYYMMDD.md şablonu kullanılır.

30.3.1 Ölçüm prosedürü
Tatbikat: staging'de tam DB + object storage kurtarma.

RPO ölçümü: son WAL arşiv zamanı → kurtarma başlangıcı arasındaki fark.

RTO ölçümü: kurtarma başlangıcı → uygulama ready olana kadar geçen süre.

Sıklık: Faz 2 beta öncesi + Faz 5 GA öncesi + 6 ayda bir.

Kayıt: docs/operations/restore-drill-YYYYMMDD.md.

Onay: platform_owner.

30.4. Code review kalite kapısı
PR öncesi:

□ SOLID ihlali var mı?
□ Aynı iş kuralı tekrar ediyor mu?
□ Domain sınırı delinmiş mi?
□ Controller büyümüş mü?
□ Service birden fazla sorumluluk mu?
□ Harici servis doğrudan business logic'e mi bağlı?
□ Ortak bileşen varken kopya mı oluşmuş?
□ Testler yazılmış mı?
□ Tenant izolasyonu korunuyor mu?
□ Log'a gizli veri sızıyor mu?
CI/CD'de mümkün olduğunca otomatik.

30.5. Definition of Done
□ İş kuralı + kabul senaryoları.
□ Migration + veri kısıtları.
□ Validation + API sözleşmesi.
□ Permission, entitlement, tenant izolasyonu.
□ Arayüz + boş/hata durumları.
□ Audit + metrikler.
□ Otomatik testler.
□ Dokümantasyon.
□ Staging doğrulaması.
□ Güvenli dağıtım + geri dönüş.
□ SOLID/DRY uyumu.

Test coverage eşiği:

Genel: %75 (statement + branch).

Kritik alanlar: %95 — packages/shared/money, packages/shared/id, permission değerlendirme zinciri, finansal durum makineleri (invoice, journal_entry, payment).

CI eşik altı PR'ı reddeder.

30.6. Mimari kalite kriteri
text
Fonksiyonel + SOLID + DRY + Test edilmiş = Kabul
30.7. İşletim (Operations)
Health endpoint'leri:

GET /healthz — liveness (bağımlılıksız).

GET /readyz — readiness (DB + Redis ping).

Metrik: Prometheus + OpenTelemetry. Minimum: request latency, error rate, queue length, DB pool, worker throughput.

Hata izleme: Sentry (backend + frontend). Release tag zorunlu.

Log saklama: 180 gün (uygulama), 1 yıl (audit).

Ortamlar: local, staging, production. Aynı migration zinciri — ortama özgü kod yolu yok.

Migration adlandırma: YYYYMMDDHHMM_<slug>.sql (Drizzle + ham SQL).

Migration geri alma: Her migration'ın down SQL'i zorunlu; üretimde otomatik down yoktur; geri alma manuel onayla.

Preview environment: Her PR için web (apps/web) ve site (apps/site) otomatik preview deploy alır (Cloudflare Pages preview + Vercel/Netlify opsiyonel). API ve worker preview yoktur (maliyet); merge sonrası staging'e gider.

Incident yönetimi: Prosedür docs/operations/incident-runbook.md (severity SEV1–SEV4, yanıt süreleri, iletişim kanalları, müşteri duyuru şablonu, post-mortem formatı). Faz 2'de boş şablon, Faz 5 GA öncesi doldurulur.

Platform faturalama: İşletmeci şirket VKN, entegratör hesabı, fatura serisi, KDV ayarları docs/operations/platform-billing.md'de tutulur. Detay ROADMAP Faz 4 önkoşulunda.

31. ERP ENTEGRASYONU
Yönetim katmanı ERP'nin yerine geçmez; ERP verisinin kullanıcıya anlamlı iş akışları halinde sunulmasını sağlar.

text
ERP (Cari · Fatura · Tahsilat · Banka · Personel · Stok)
   ↓ (event veya query)
Görev / Takvim / Notification / Dashboard
Örnek: Cari vadesi geldi → hatırlatıcı → patrona push → istenirse WhatsApp/görev.

32. VERİ MODELİ İLKELERİ
Task ≠ Reminder ≠ Notification. Üç ayrı kavram, üç ayrı tablo.

WhatsApp Message ≠ Notification. Mesaj = iletişim kaydı; notification = bilgi ulaştırma.

Contact ortak merkezdir. Müşteri, tedarikçi, WhatsApp kişisi, randevu sahibi, görev ilgilisi → ortak contact.

Dashboard verisi tekrarlı tutulmaz. Özet gerçek business tablolarından; performans için cache/view/materialized view.

Contact üzerinde elle güncellenen bakiye otorite değildir. Bakiye kesinleşmiş alt hesap hareketlerinden üretilir.

Kesinleşmiş finansal hareket değişmez. Düzeltme = ters kayıt / iade / düzeltme belgesi.

33. GELİŞİM ÖNCELİĞİ
Silindi. Öncelik tek kaynak: ROADMAP.md §3.

İki farklı öncelik listesi tutmak yerine tek liste kullanılır.

34. DEĞİŞMEZ İLKELER
UUID v7 birincil anahtar standardıdır (§0.1).

Redis kalıcı finansal kayıt kaynağı değildir. İş kayıtlarının otoritesi PostgreSQL'dir.

Kesinleşmiş finansal hareket düzenlenmez veya silinmez.

Tenant izolasyonu hem RLS hem ilişkisel kısıtlarla korunur.

Permission biçimi module.resource.action; modül kodu GOVERNANCE §2'den gelir.

Entitlement ≠ Permission.

Aynı transaction ilkesi: belge + cari + stok + muhasebe + audit + outbox birlikte.

İdempotency finansal, ödeme, webhook akışlarında zorunlu.

Türkçe metinler NFC ile işlenir; email/token/UUID üzerinde Türkçe büyük/küçük harf dönüşümü yapılmaz.

Finansal alanlarda FLOAT/DOUBLE yok; decimal string taşınır.

Platform yönetimi: tek platform_owner + platform rolleri; çapraz tenant erişimi yalnızca support_access_grants ile.

Owner tekil ve transfer süreçleri kilitli transaction ile korunur.

Audit kayıtları uygulama rolü tarafından değiştirilemez.

SOLID ve DRY ihlalleri kalite kapısında reddedilir.

Bir özellik; iş kuralı, migration, validation, permission, tenant izolasyonu, UI, audit, test, dokümantasyon ve staging doğrulaması tamamlanmadan kabul edilmez.

Yeni özellik eklemek, mevcut çalışan mimariyi gereksiz yere bozmaz.

legal_texts ve legal_acceptances global tablolardır; tenant_id taşımazlar (ADR-0011).

apps/site = Astro (statik); apps/web = Vue 3 + Vite. İkisi ayrı ama packages/ui ortak (ADR-0012).

OpenAPI sözleşmesi Zod'dan üretilir; tek doğruluk kaynağı Zod'dur (ADR-0013).

Erişilebilirlik hedefi WCAG 2.1 AA'dır; klavye navigasyonu zorunludur.

Test coverage genel %75, kritik finansal/yetki alanları %95'tir; CI eşik altı PR'ı reddeder.