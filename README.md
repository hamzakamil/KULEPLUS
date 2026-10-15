evren_llm_XeoVBDNYuxTS4dkho8cCcvQ5aVsuUr7uVhPw4M3LzjA

betulevren
evren_llm_jWdZcjS5zHVWNRati09LTJop_k5JfPb3KQgiz5WJuug

deepseek-v4.1-flash
mimo-v2.6-pro
glm-5.3
qwen3.8-flash-next
gemma-4-31b
https://evren-llmapi.ssyz.org.tr/v1





# Kurumsal Bulut ERP & Ön Muhasebe Platformu

### Şirketinizin tüm süreçleri tek bir merkezde. Modüler, çok şirketli (multi-tenant) bulut yazılımı.

**Sürüm:** 4.3.0 · **Güncelleme:** 13 Ekim 2026 · **Durum:** Planlama / Faz 0
**İlgili dokümanlar:** [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) · [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md)

> Bu README ürünün **ne olduğunu, kime satıldığını ve nasıl ayağa kaldırılacağını** anlatır.
> Teknik kararlar için `docs/TECHNICAL_SPEC.md`, sıralama için `docs/ROADMAP.md`, doküman hiyerarşisi için `docs/GOVERNANCE.md`.

### v4.3.0 — Önizleme (K-03 Fiyatlandırma kararları)

*Nasıl hazırlandı: `git log --reverse v4.1.0..HEAD --pretty=format:'%h|%ad|%an|%s' --date=iso` + `npm run governance:check`.*

| # | Değişiklik |
|---|-----------|
| 1 | **K-03: Fiyatlandırma kararları** (6f31a89) — Core+ `299 ₺/ay`, `2990 ₺/yıl`, Enterprise `799 ₺/ay`, `7990 ₺/yıl`. Her ikisi de KDV hariç. Seed + migration + site fiyat sayfası birleştirildi. |
| 2 | **Faz 8 tamamlandı — Entegrasyon & Webhook** (405f15f, 37ee3a4) — `/api/v1/integrations` CRUD + `webhook_events` / `integration_credentials` / `external_mappings` tabloları (RLS), HMAC-SHA256 imza doğrulama (`SPEC §20`), `GET /integrations/:id/events` ucu. Web'de `IntegrationsView` + Pinia store + `/integrations` rotası + nav linki. |
| 3 | **Faz 8: WhatsApp + Public API** (bbab236, 8d716c4) — `WhatsAppProvider` arayüzü + `MockProvider` (`SPEC §18/§29.1`), `GET /api/v1/public/status` (kimliksiz sistem durumu ucu). |
| 4 | **Faz 4 Hat B: iade + alacak eşleştirme** (5848a2b) — `billing_refunds`, `billing_allocations` tabloları + webhook işleyicisi. |
| 5 | **Faz 4 Hat B: Subscription billing (mock)** (0123389, 18ea46f) — checkout, webhook, subscription billing alt yapısı. |

*Doğrulama: `typecheck` ✓ · `vue-tsc` ✓ · testler **216/216** ✓ · `governance:check` ✓ (14 modül, 156 tablo).*

---

### v4.0.0'da Ne Değişti?

| # | Değişiklik |
|---|-----------|
| 1 | Lisans **özel/ticari** olarak sabitlendi (MIT kaldırıldı). |
| 2 | Modül kodları `GOVERNANCE §2` tek tablosuna bağlandı; `plan_modules`/`plan_limits` yerine SPEC tabloları (`plan_features` + `plan_limits`) kullanıldı. |
| 3 | `OWNER`, `PATRON`, `MALI_MUSAVIR` rolleri SPEC §6.6 ile uyumlu hale getirildi. |
| 4 | Flutter → PWA-first (Faz 2); Flutter Faz 9 koşullu. |
| 5 | e-Belge: entegratör adapter kararı net; "kendi UBL-TR hattı" tamamen kaldırıldı. |
| 6 | Repo yapısı SPEC §1.2 ile birebir uyumlu; `apps/site` var, `apps/mobile` yok. |
| 7 | Teknoloji matrisi SPEC §1.3 ile birebir. |
| 8 | Platform yönetimi modeli: `platform_owner` + roller (Super Admin singleton DEĞİL). |
| 9 | Onboarding varsayılanı `manual`. |

---

## 1. Ürün Özeti

Türkiye mevzuatına (e-Fatura, e-Arşiv, e-Defter, KDV, Tek Düzen Hesap Planı, KVKK) uyumlu, **modül modül satılan** bulut ön muhasebe / ERP platformu. KOBİ'leri hedefler; çok kiracılı SaaS.

Üç temel fikir:

| # | Fikir | Anlamı |
|---|-------|--------|
| 1 | **Tek sistem, iki yüz** | Aynı veri; işletme sahibi için sade özet, muhasebeci için klavye odaklı derin veri girişi. |
| 2 | **Ücretsiz model, ücretli modüller** | Yeni kayıt olan herkes süresiz ücretsiz başlangıç paketine sahip (Cari veya Stok). Diğer modüller satın alınır. Demo süresi yoktur. |
| 3 | **Platform kendi gelirini görür** | Şirketler, abonelikler, MRR/ARR, kuponlar ve mali müşavir komisyonları platform panelinden izlenir. |

Çalışma alanları:
- **Tanıtım/satış sitesi** (`apps/site` — Astro)
- **Müşteri uygulaması** (`apps/web` — Vue 3 + Vite, PWA)
- **Platform yönetimi** (aynı `apps/web` içinde ayrı rota)

Platform gelirleri, müşterilerin ticari kayıtlarından **ayrıdır**.

---

## 2. Ürün İlkeleri

1. Tek kayıt kaynağı — aynı işlem modüller arasında tekrar girilmez.
2. Kademeli ayrıntı — temel alanlar önce, uzman alanları gerektiğinde.
3. Finansal bütünlük — kesinleşmiş parasal hareket sessizce değişmez; ters kayıt ile düzeltilir.
4. Tenant izolasyonu — hem uygulama hem veritabanı seviyesinde.
5. Modüler satış — müşteri yalnızca ihtiyacı olanı satın alır.
6. **Veri taşınabilirliği** — ücretsiz veya ücretli, her kullanıcı verisini dışa aktarabilir. **ZIP formatı** SPEC §23.2.
7. Kontrollü büyüme — mikroservis/Kubernetes/veri ambarı ilk sürümde yok.
8. Doğrulanabilir kalite — bir özellik test + yetki + denetim + dokümantasyon ile tamamlanır.
9. **Erişilebilirlik** — WCAG 2.1 AA hedefi; klavye navigasyonu zorunlu (SPEC §24).

---

## 3. Kullanıcı Profilleri

### 3.1. Patron / yönetici
Finansal terim bilmeden aksiyon alabilecek şekilde tasarlanır: bugün ne var, kim borçlu, bu hafta ne ödemeliyim.

- **Bugün:** geciken tahsilat, yaklaşan ödeme, görev, randevu.
- **Para:** kasa + banka, alacak + borç.
- **Satış:** satış, iade, tahsilat, dönem karşılaştırma.
- **Operasyon:** kritik stok, sipariş, teslimat.
- **Onaylar:** harcama, ödeme, indirim.

### 3.2. Muhasebe / finans
- Yoğun veri girişi (klavye, satır çoğaltma, Excel import).
- Belge yönetimi (fatura, tahsilat, ödeme, banka, gider).
- Kontrol (cari mutabakat, banka eşleştirme, dönem kilidi).
- Ayrıntılı rapor (ekstre, yaşlandırma, nakit akış).
- Mali müşavir aktarımı.

### 3.3. Satış / satın alma / depo
Kullanıcı yalnızca yetkili olduğu kayıtları görür.

### 3.4. Mali müşavir (harici)
Farklı şirketlere ayrı üyeliklerle erişir; her şirketin yetkisi bağımsız. Varsayılan: **okuma + dışa aktarma**. Kayıt değiştirme/dönem açma ayrıca verilir.

### 3.5. Platform sahibi
`platform_owner` + destek/satış/finans rolleri (SPEC §5.1). Panel üzerinden şirket, abonelik, tahsilat, destek yönetir.

### 3.6. Müşteri portalı (harici son kullanıcı)
Şirketin müşterileri için süreli link ile ekstre/fatura görüntüleme (Faz 8). Tam giriş akışı ileri faz.

---

## 4. Modül Haritası ve Paketleme

Modül kodu listesi **tek kaynak**: [`docs/GOVERNANCE.md §2`](docs/GOVERNANCE.md). Bu README yalnızca **paket** açısından özetler.

| Modül | Kod | Faz | Varsayılan paket |
|-------|-----|-----|------------------|
| Çekirdek | `core` | 1 | Her zaman açık |
| Cari Hesap | `contacts` | 2 | **Ücretsiz (limitli)** |
| Stok | `stock` | 2 | **Ücretsiz (limitli)** |
| Fatura & Belgeler | `trade` | 3 | Ücretli |
| Kasa & Banka | `cashbank` | 3 | Ücretli |
| e-Dönüşüm | `einvoice` | 4 | Eklenti |
| Abonelik/Altyapı | `subscription` | 4 | Altyapı |
| Muhasebe | `accounting` | 5 | Ücretli |
| Çek / Senet | `cheque` | 6 | Ücretli |
| Gelişmiş Raporlar | `reports_plus` | 6 | Ücretli |
| Yönetim Paketi | `management` | 7 | Ücretli |
| SMS Kredisi | `sms` | 4 | Eklenti (kullandıkça öde) |
| Entegrasyonlar | `integrations` | 8 | Eklenti / Kurumsal |

### 4.1. Paketleme ilkeleri

1. **Veri rehin alınmaz.** Dışa aktarma her planda açık. Paket düştüğünde modül **salt okunur** olur; veri silinmez.
2. **Kilitli modül görünür kalır.** Menüde 🔒, örnek veriyle önizleme, "Yükselt" butonu doğrudan satın alma akışına gider.
3. **Paket tanımı veridir.** `modules`, `plans`, `plan_features`, `plan_limits`, `prices` tablolarından okunur (SPEC §8).
4. **Her limit tek yerde kontrol edilir.** Backend zorlar; frontend bilgilendirir.

### 4.2. Ticari kurallar

- Aylık ve yıllık fiyat; ilk sürümde tek satış para birimi.
- Fiyatın KDV dahil/hariç olduğu açıkça belirtilir.
- Bağımlılıklar (`module_dependencies`) satın alma öncesinde gösterilir.
- Paket düşürme **dönem sonunda**; veri silinmez, ücretli yazma durur.
- Kota aşımı: yeni işlem engellenir, mevcut kayıt bozulmaz.
- SMS/WhatsApp/e-belge kullanımı ücretsiz pakete **sınırsız dahil edilmez**.
- **Özel rol oluşturma:** ücretsiz pakette en fazla 1, ücretli pakette sınırsız. Bu limit `plan_limits.max_custom_roles` üzerinden backend'de zorlanır (ücretsiz: 1, ücretli: `NULL` = sınırsız). Kod tarafında `checkLimit('max_custom_roles')` çağrılır; frontend yalnızca bilgilendirir.

### 4.3. Şirket açılışı

Varsayılan `onboarding_mode = 'manual'` (SPEC §4.3). Platform incelemesi sonrası **tek transaction** ile kurulum:

```text
Ücretsiz kayıt → E-posta doğrulama → Başlangıç paketi seçimi
   → Şirket başvurusu → Platform incelemesi
   → TENANT + OWNER + roller + ücretsiz haklar + modüller
   → Kurulum rehberi → İlk gerçek kayıt
Beta sonrası veriye göre hybrid moda geçiş ADR ile değerlendirilir.

5. Ekran Kavramı
5.1. Patron Görünümü (sade)
Az alan, sade kavram, aksiyon odaklı özet. Her kart ilgili listeye açılır. Önemli işlem en fazla 3 tıklama. Muhasebe terimleri yerine sade dil ("Alacaklarım", "Para aldım").

5.2. Uzman Görünümü (derin)
Klavye odaklı grid: Enter yeni satır, F2 hesap ara, Ctrl+S taslak, Ctrl+Enter onayla. Detaylı kolonlar, hesap kodları, toplu işlem.

5.3. Müşteri Portalı (harici)
Süreli link ile ekstre/fatura görüntüleme; giriş akışı ileri faz (Faz 8).

Her kullanıcı Basit/Gelişmiş mod seçebilir; roller varsayılanı belirler.

Tam ekran listesi: docs/product/screens.md

6. Roller ve Yetkilendirme
6.1. Rol listesi
Platform: platform_owner (tek), platform_support, platform_sales, platform_finance, platform_readonly.

Tenant: OWNER (tek), COMPANY_ADMIN, MUHASEBE_YONETICISI, MUHASEBE_PERSONELI, FINANS_YONETICISI, SATINALMA, SATIS, LOJISTIK, DEPO, RAPORLAMA, MALI_MUSAVIR.

Not: PATRON ayrı rol değil; OWNER veya COMPANY_ADMIN içinde patron_view = true kullanıcı ayarıdır. IK/URETIM roller yok (modülü yok).

6.2. Yetki zinciri
text
Tenant Membership → Role(s) → Permission → Scope → Record-Level Access
Bir kullanıcı birden fazla rol alabilir; yetkiler birleşimden hesaplanır.

Tam permission kataloğu: docs/api/permissions-catalog.md

7. Platform Paneli
Ekran	İçerik
Dashboard	MRR, ARR, yeni kayıt, dönüşüm, churn, tahsilat bekleyen, başarısız ödeme
Şirketler	Plan, durum, kullanım, manuel şirket açma
Abonelikler	Yenilemeler, başarısız ödeme, havale onayı, iade
Faturalar	Müşterilerimize kestiğimiz e-Fatura/e-Arşiv
Kuponlar & Ortaklar	İndirim kodları, mali müşavir ortaklık linkleri, komisyon
Planlar & Modüller	Fiyat, limit, hangi modül hangi pakette
Destek	support_access_grants ile süreli, gerekçeli, denetimli erişim
Denetim & Sağlık	Audit, kuyruk durumu, hata özeti, yasal metin sürümleri
Not: Tahsilat, kesilen fatura, yinelenen gelir ve muhasebeleştirilmiş gelir ayrı gösterilir (SPEC §8.9).

8. Mimari Özet
Modüler monolit. Mikroservis yok.

Katman zinciri: Controller → Application Service → Domain → Repository/Port → Adapter → DB/API.

Finansal tutarlılık tek transaction'da.

Dış dünya adapter ile. e-Belge/ödeme/SMS/e-posta değiştirilebilir; dev'de mock.

Muhasebe değişmez. Ters kayıt.

Uzun işler API'yi bekletmez. Outbox → BullMQ → Worker.

Domain ayrımları:

Task ≠ Reminder ≠ Notification

WhatsApp Message ≠ Notification

Contact ortak merkez

9. Teknoloji Yığını
Detay: SPEC §1.3. Özet:

Katman	Teknoloji
Backend	Node.js 22 LTS + TypeScript + Express 4
DB	PostgreSQL 16+ + Drizzle + RLS
Validasyon	Zod (paylaşılan paket)
Para	decimal.js
Web (müşteri + platform)	Vue 3 + Vite + Pinia + Vue Router + Tailwind + Lucide
Web ek	vite-plugin-pwa, vue-i18n, Chart.js, TanStack Table
Pazarlama sitesi	Astro (statik, @astrojs/vue ile paket paylaşımı)
Queue	Redis + BullMQ
Dosya	S3 uyumlu depolama, ExcelJS, fast-xml-parser, pdfkit, multer
Mobil	PWA (Faz 2) · Flutter (Faz 9, koşullu)
e-Belge	Özel entegratör REST API (adapter)
Ödeme	iyzico + havale/EFT
E-posta	SMTP (Postmark önerisi) — dev: Mailpit
Analitik	Plausible (KVKK dostu)
Test	Vitest + Playwright + axe-core (a11y)
OpenAPI	Zod'dan otomatik üretim (ADR-0013)
10. Türkiye Uyumluluğu
Konu	Yaklaşım
e-Fatura/e-Arşiv/e-İrsaliye	GİB onaylı özel entegratör REST API (adapter)
e-Defter	Yevmiye/kebir XML, entegratör/saklayıcı ile (Faz 6)
Hesap planı	TDHP şablonu; şirket alt hesap ekler
KDV	Tarih aralıklı oran tablosu; tevkifat/istisna kodları seed'li
KVKK	DPA, aydınlatma, saklama/imha, ihlal prosedürü, alt işleyen listesi
Saklama	Muhasebe verisi silinmez, arşivlenir (VUK/TTK)
Türkçe	UTF-8, tr-TR locale, İ/ı duyarlı, 1.234,56 biçim
Erişilebilirlik	WCAG 2.1 AA hedefi
Not: Mevzuat bilgileri 5 Ekim 2026 itibarıyla kamuya açık kaynaklardan derlenmiştir. Canlıya almadan önce mali müşavir + hukukçu doğrulaması gerekir.

11. Güvenlik
Argon2id parola hash

Kısa ömürlü JWT access + döner refresh (HttpOnly cookie)

PostgreSQL RLS (ayrı DB rolleri: app_user, app_migrator, app_platform)

2FA (platform kullanıcıları + kritik roller zorunlu)

Helmet, CORS, rate limiting

Parametreli SQL

Entegrasyon sırları AES-256-GCM

Idempotency (webhook + ödeme)

Değişmez denetim izi

API permission + scope + entitlement kontrolü

Günlük yedek + WAL arşivi; farklı bölge replikasyonu

Secrets: SOPS + .env (Faz 0–3) → Doppler/AWS SM (Faz 4+, ADR ile)

Tenant bazlı tam dışa aktarma (ZIP)

12. Kurulum
12.1. Gereksinimler
Node.js 22 LTS+

Docker + Docker Compose

npm 10+ (workspaces)

12.2. Adımlar
bash
git clone <ozel-repo-adresi>
cd erp-platform
npm install
cp .env.example .env
docker compose up -d          # postgres, redis, minio, mailpit
npm run db:migrate            # şema + RLS politikaları
npm run db:seed               # modül/plan kataloğu, TDHP, KDV, roller
npm run dev                   # api + worker + web
npm run dev:site              # apps/site (Astro) — isteğe bağlı
Üretimde sürümlenmiş migration kullanılır. db:push gibi kontrolsüz şema eşitleme üretim yöntemi değildir.

12.3. .env.example
env
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:5173
SITE_URL=http://localhost:4321
API_URL=http://localhost:3000

DATABASE_URL=postgresql://app_user:CHANGE_ME@localhost:5432/erp_db
DATABASE_MIGRATOR_URL=postgresql://app_migrator:CHANGE_ME@localhost:5432/erp_db
DATABASE_PLATFORM_URL=postgresql://app_platform:CHANGE_ME@localhost:5432/erp_db
REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=               # 32 byte base64

SMTP_URL=smtp://localhost:1025
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=erp-files
S3_ACCESS_KEY=
S3_SECRET_KEY=

EINVOICE_PROVIDER=mock
PAYMENT_PROVIDER=mock         # mock | iyzico | manual
SMS_PROVIDER=mock
IYZICO_API_KEY=
IYZICO_SECRET_KEY=
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com

PLATFORM_BOOTSTRAP_EMAIL=

# Public site (apps/site)
PUBLIC_API_URL=http://localhost:3000
PUBLIC_PLAUSIBLE_DOMAIN=
Boş ve örnek değerlerle üretim başlatılamaz. Parolalar, tokenlar ve anahtarlar kaynak koduna eklenmez.

12.4. Komutlar
Komut	Açıklama
npm run dev	API + worker + web
npm run dev:site	Pazarlama sitesi (Astro) — isteğe bağlı
npm run db:migrate / db:seed	Şema + başlangıç verisi
npm test	Unit + integration
npm run test:e2e	Playwright
npm run test:a11y	axe-core (WCAG 2.1 AA)
npm run openapi:generate	Zod'dan openapi.yaml üret
npm run lint && npm run typecheck	Kalite kapısı
13. Repo Yapısı
Detay: SPEC §1.2.

text
apps/
  api/        Express API (src/modules/<modül>/…)
  worker/     BullMQ worker'ları
  web/        Vue 3 uygulaması (Patron · Uzman · Platform)
  site/       Astro — pazarlama sitesi + yardım merkezi (statik, SEO)
packages/
  shared/     Zod şemaları, money/tr/id/errors
  db/         Drizzle şeması, migration, RLS SQL, seed
  ui/         Ortak Vue bileşenleri (web + site arasında paylaşılır)
docs/
  GOVERNANCE.md  TECHNICAL_SPEC.md  ROADMAP.md
  brand.md
  adr/  api/  operations/  legal/  product/  archive/
docker-compose.yml
.github/workflows/
Not: apps/mobile/ yok. Flutter Faz 9 koşullu.

14. Geliştirme Kuralları (SOLID + DRY)
Detay: SPEC §29.

Kodun çalışması yeterli değildir. Bir iş; çalışır + SOLID + DRY + test edilmiş + yetki/denetim/paket kontrolü tamam olduğunda biter.

text
Controller → Application Service → Domain Logic → Repository/Port → Adapter → DB / Dış API
Controller'da iş kuralı/SQL yok; Service'te HTTP/UI bağımlılığı yok.

Aynı iş kuralı iki yerde yazılmaz.

Bir modül başka modülün repository'sine sorgu atmaz; Port veya event kullanır.

Para için number/float yasak; decimal.js + PostgreSQL NUMERIC.

GodService/GodComponent ve copy-paste kabul edilmez.

Her yeni özellik için tamamlanma zinciri: migration → şema doğrulama → service → API → yetki → entitlement → denetim → test → dokümantasyon.

15. Yol Haritası
Detay: docs/ROADMAP.md.

Faz	Başlık	Çıkış kapısı
0	Temel ve altyapı	CI yeşil, izolasyon testi yeşil
1	Platform çekirdeği	Kayıt → şirket → rol → paket kilidi e2e
2	Ücretsiz model (Cari + Stok + içe aktarma + site)	Genel Beta
3	Fatura, tahsilat/ödeme, kasa/banka, gider	İlk ücretli modüller
4	e-Dönüşüm + SaaS ticari altyapı	İlk ücretli satış
5	Muhasebe	SMMM golden test imzası
6	İleri finans (çek/senet, döviz, KDV/Ba-Bs, e-Defter)	Üst paket
7	Yönetim paketi ve patron deneyimi	Günlük özet + onay akışı canlı
8	Entegrasyonlar ve büyüme	—
9	Koşullu: native mobil, offline, AI, otomasyon	Tetikleyici
16. Dokümantasyon
Doküman	Amaç
docs/GOVERNANCE.md	Doküman hiyerarşisi, modül kodu tablosu, çelişki çözümü
docs/TECHNICAL_SPEC.md	Mimari, veri modeli, iş kuralları, standartlar
docs/ROADMAP.md	Fazlar, çıkış kriterleri, riskler, açık kararlar
docs/brand.md	Marka adı, logo, ton-of-voice (placeholder — Faz 0'da doldurulur)
docs/adr/	Mimari karar kayıtları
docs/api/openapi.yaml	REST API sözleşmesi (Zod'dan üretilir)
docs/api/permissions-catalog.md	Tam permission kataloğu
docs/api/error-codes.md	Tam hata kodu kataloğu
docs/product/screens.md	Ekran listesi (route + yetki + faz)
docs/product/i18n.md	i18n anahtar kuralı + hata kodu çeviri eşlemesi
docs/product/email-templates.md	E-posta şablon envanteri
docs/product/seo-analytics.md	SEO + analitik planı
docs/product/help-center.md	Yardım merkezi makale başlıkları
docs/product/import-templates/	Excel/CSV import şablon sözleşmeleri
docs/legal/	KVKK, ToS, çerez, DPA, komisyon sözleşmeleri
docs/operations/	Runbook, yedek/kurtarma, incident, platform-billing
docs/archive/	Eski sürümler ve çelişki logları
Dokümanlar arası çelişkiler GOVERNANCE.md §7 prosedürüyle giderilir; geliştirmeye başlamadan önce çözülür.

17. Lisans
Ticari / özel lisans (tüm hakları saklıdır).

MIT değildir. Repo özel (private) tutulur. Kaynak kodun kopyalanması, satılması veya türev çalışma üretilmesi yazılı izne tabidir.