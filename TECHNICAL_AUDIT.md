# Kuleplus / Muhasebe — Kapsamlı Mimari & Sağlamlık Analizi

## 0) Yöntem ve doğrulanmış ölçümler

Analizi *okuyarak değil, çalıştırarak* yaptım. Kanıt değeri olan, bu oturumda ürettiğim sayılar:

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| API unit test | **153/156 geçti, 3 kırmızı (2 dosya)** | `vitest run --root apps/api` |
| Typecheck (6 workspace) | **Hepsi geçti** | `npm run typecheck --workspaces` |
| ESLint | **24 hata → CI'da kırmızı** | `npm run lint` |
| GOVERNANCE kontrolü | **5 ihlal → CI'da kırmızı** | `node scripts/governance-check.mjs` |
| `npm run migrate` | **Deterministik çöküyor** | `Error: Down SQL eksik: 202610220000_accounting.down.sql` |
| Route sayısı | **204 handler, 15 route dosyası, 14 iş modülü** | `_route_inventory` taraması |
| Migration | **23 up / 22 down** (accounting'in down'ı yok) | `packages/db/migrations` |

Bu sayıların bir kısmı "sağlam mı?" sorusunun cevabını doğrudan etkiliyor. Detaya geçiyorum.

---

## 1) Teknoloji Yığını & Monorepo

```
kuleplus (npm workspaces)
├── apps/
│   ├── api/       Express 4 + TS, pino, jose, argon2, otplib, zod, pg   (modüler monolit)
│   ├── worker/    BullMQ worker (outbox→email-send), DIP port'lar
│   ├── web/       Vue 3 + Vite 8 + Pinia + Vue Router + Tailwind 4 + PWA
│   └── site/      Astro (pazarlama / yardım merkezi)
├── packages/
│   ├── db/        pg pool, RLS/tenant çekirdeği, ham SQL migrator (tsx)
│   ├── shared/    AppError katalog, para (decimal.js), TR/TCKN/VKN/IBAN, izin kataloğu
│   └── ui/        temel Vue komponentleri (+vitest)
├── docs/          TECHNICAL_SPEC(1245), ROADMAP(1134), GOVERNANCE, 21 ADR, legal, api
└── scripts/       governance-check, a11y, bundle-budget + _*.mjs teşhis
```

**Stack seçimleri isabetli**: Express 4 sadelik için mantıklı (gerçekten monolit-ön-modüler), ham SQL + pg doğrudan (ORM katmanı yok — DB trigger/RLS ile birlikte okunabilirlik avantajı), npm workspaces, Node ≥22.

## 2) Backend İstek Yaşam Döngüsü (Middleware Pipeline)

`createApp()` (app.ts) tam sırayla:

1. **Request-ID**: `x-request-id` istemci verirse korunur, yoksa `newId()` (UUID v7). Yanıtta da döner → dağıtık izleme iskontosu.
2. **pino-http**: `genReqId` aynı ID'yi kullanır. **Redaction aktif** (`authorization`, `cookie`, `password/secret/token` → `[MASKED]`) — iyi.
3. **helmet** → temel güvenlik başlıkları.
4. **cors**: `origin: env.APP_URL` (sıkı, wildcard değil) + `credentials: true`.
5. **cookieParser** + `express.json({ limit: '1mb' })`.
6. Modül mount'ları → 7. 404 → 8. **Merkezi hata middleware'i** (AppError → ilgili HTTP+code; bilinmeyen → prod'da genel mesaj, dev'de detay).

**Not**: `validate.ts` içinde `throw` kullanımı senkron fonksiyonda olduğu için Express 4'te güvenli; `authenticate`/`tenantContext` gibi async middleware'ler ise bilinçli olarak `next(error)` kalıbını kullanıyor (Express 4 async rejection yakalamaz — bunu `server.ts`'teki yorumlarla bilip `unhandledRejection` koruması bile eklemişler). Hata sözleşmesi tek biçim (`{ error: { code, message } }`), katalog `ERROR_CODES`'ta tek kaynakta.

---

## 3) Route Mimarisi — 204 Endpoint Envanteri

| Modül | Mount | Route | Koruma zinciri |
|---|---|---|---|
| identity | `/api/v1/auth` | 10 | public (register/login/refresh/logout/reset) |
| company | `/api/v1/company` | 9 | auth, bazıları **platform** |
| entitlement | `/api/v1/entitlements` | 4 | auth |
| authorization | `/api/v1/authorization` | 19 | **yalnız auth** (RBAC uçları!) |
| platform | `/api/v1/platform` | 10 | auth + requirePlatformUser / Owner / Role |
| audit | `/api/v1` | 2 | auth |
| contacts | `/api/v1/contacts` | 13 | auth + tenant + **entitlement('contacts')** |
| trade | `/api/v1/trade` | 24 | auth + tenant + **entitlement('trade')** |
| invoice | `/api/v1/invoices` | 9 | auth + tenant + **entitlement('trade')** |
| stock | `/api/v1/stock` | 14 | auth + tenant + **entitlement('stock')** |
| cash-bank | `/api/v1/cash-bank` | 12 (5+6+12) | auth + tenant + **entitlement('cashbank')** |
| expense | `/api/v1/expenses` | 11 | auth + tenant + **entitlement('trade')** |
| reports_plus | `/api/v1/reports` | 14 | auth + tenant + **entitlement('reports_plus')** |
| accounting | `/api/v1/accounting` | 36 | auth + tenant + **entitlement('accounting')** |
| backup | `/api/v1/backups` | 6 | **yalnız auth** |

**Mimari kararlar (artılar)**:
- Modül başına `routes.ts` + `service.ts` + `schemas.ts` düzeni tek tip; her yerde aynı kalıp.
- **Route sıralama bilinci yüksek**: sabit alt-rotalar (`/export`, `/import`, `/stats`, `/with-balances`, `/movements`, `/bank`) parametrik `/:id`'den önce; cash-bank `/:id` tuzak 500'üne düştüklerini fark edip app.ts'e DİKKAT yorumu bile bırakmışlar. Bu, yaşanmış hatalardan ders çıkaran bir ekip sinyali.
- Ölçülü `validate(schema, source)` kullanımı (query/body/params), zod `.coerce`, whitelist sort (SQL enjeksiyon koruması `ALLOWED_SORT` set).

**Route envanterinden çıkan zayıflıklar**: `authorization` ve `backup` modülleri **sadece `authenticate`** taşıyor (aşağıda P0 bulgusu).

---

## 4) Çok Kiracılılık (Multi-tenancy) — Projenin En Güçlü Parçası

Mimari şu şekilde işliyor:

1. `tenantContext` (middleware/tenant.ts): JWT'deki `tenantId`'yi **körü körüne kabul etmez** — `tenant_users`'tan üyelik sorgusu yapar (`SELECT 1 ... LIMIT 1`). Haklı gerekçe: RLS çekirdekten gelen GUC değeri JWT'den türediği için üyeliğin hâlâ geçerli olduğunun her istekte kanıtlanması şart (yorumlarda SPEC §7.1'e bağlıyorlar).
2. `beginTenantScope(getPool('app'), tenantId)` → `BEGIN` + `set_config('app.tenant_id', $1, true)` (transaction-local GUC) + **AsyncLocalStorage** 'a istek-scoped `{ client }` koyar.
3. **`TenantAwarePool`** (packages/db/client.ts): aktif scope varsa **TÜM `pool.query` çağrılarını o isteğe ayrılmış bağlantıya kilitler**. Bu, klasik "set_config ayrı bağlantıda çalışır, sonraki sorgu başka bağlantıya düşer, `current_tenant_id()` null görür" veri-sızıntısı/boş-liste hatasını kökten çözen, üzerinde düşünülmüş bir tasarım. Ayrıca `connect()` içinde `set_config(..., false)` session-seviyesi kurup `release()`'de `RESET` ile **kirli bağlantının havuzdan çıkmasını engelliyor**. Buna ve RLS politikalarına (ör. `demo_items`) bakınca tenancy katmanı yıldız seviyede.
4. `res.on('close')` → statusCode < 400 ise COMMIT, değilse ROLLBACK.

**Ama bu desenin iki bedeli var (P1)**:
- **Her istek (GET dahil) tam HTTP yanıtı boyunca 1 bağlantıyı tıkar.** Havuz `max: 20` → **~20 eşzamanlı istek sert tavanı**. Bir CSV export (tanıtımda `send(csv)`) veya yavaş client bağlantı kapanana kadar bağlantı açık kalır. Trafik artınca `connectionTimeoutMillis: 5000`'i aşan istekler 500 fırtınasına dönüşür. Upload/stream ve uzun raporlar için bağlantı yaşam döngüsünün istek-scoped değil *işlem-scoped* olması gerekir.
- COMMIT, yanıt gönderildikten **sonra** (`res.close`) olur → çok küçük pencere: client 200 görür, süreç o anda çökerse işlem DB'ye yazılmamıştır (uygulama-idempotensi yoksa kayıp).

---

## 5) Kimlik, Oturum & Yetkilendirme Algoritmaları

**Oturum akışı** (identity/service.ts) olgun:
- **Argon2id** OWASP parametreleri (m=19456, t=2, p=1).
- **Access token 15 dk** (HS256 / jose), yükünde `sub`, `tenantId`, `authVersion`; **refresh token 30 gün**, `jti`'li, DB'de **SHA-256 hash** olarak saklanır (`user_sessions`).
- **Hisse döndürme (rotation)**: her refresh'te eski kayıt `revoked_at`'lenir, yenisi eklenir. **Kısa oturum ("beni hatırla" kapalı) refresh ile uzatılamaz** — oturum süresi korunur.
- **`authVersion`** (tenants.auth_version) — rol/üyelik değişince tenant çapında tüm access token'ları tek artışla geçersiz kılan zarif mekanizma.
- **DB kilitlenme** gerçekten uygulanmış (satır 649-663): `failed_login_attempts + 1 >= 5` → `locked_until = now() + 15 dk`, başarıda sıfırlanır. Login satırı kilit kontrolü yapıyor.
- **TOTP**: `otplib/authenticator.check` ile login'de doğrulama + setup/verify/disable metotları + **8 yedek kod** (sha256 hash'li saklanıyor). `otplib` bağımlılığı mevcut.
- Refresh cookie: `httpOnly`, `sameSite: lax`, **`path: '/api/v1/auth/refresh'`** (path-scoped — darbe yüzeyini daraltıyor), prod'da `secure`.

**Entitlement (modül kapısı)**: `requireEntitlement(moduleCode)` → `tenant_entitlements.status = 'active'` değilse 403 `MODULE_NOT_ENTITLED`. Sağlıklı.

**Permission kataloğu (RBAC)**: `packages/shared/permissions.ts` (module.resource.action, delegatable kuralları, tek kaynak) + authorization modülü (roller, davetler, departmanlar, transfer-ownership) eksiksiz. **AMA (P0): `requirePermission` diye bir middleware YOKTUR — kodun tamamında yalnızca tenant.ts'teki bir yorumda geçer.** Rol/izin tabloları yazılıp servis ediliyor, hiçbir iş rotası tarafından *zorlanmıyor*. Yani davet edilmiş her kullanıcı (düşük rol bile) `core.role.manage`, `core.user.delete`, `core.owner.transfer`, fişleri onaylama vb. çağırabilir. Katalog ile zorunlama arasındaki boşluk bugün mevcut en ciddi güvenlik açığı.

---


## 6) İş Modülleri & Çekirdek Algoritmalar

### 6.1 Faturalar (trade/invoice/service.ts)
- **Numaralandırma**: `invoice_sequences` (tenant × fiscal_year, `prefix 'FAT'`), insert-if-not-exists + **atomik `UPDATE ... RETURNING`** → boşluksuz (gap-free), eşzamanlı yarışa karşı güvenli. `FAT-2026-000000001` (9 hane).
- **Satır hesaplama**: `qty*price` → iskonto `%` → matrah → KDV → satır toplamı; üst toplamlar bunların toplamı.
- `addPayment` bakiye/`paid_amount`/`status` ('draft'→'partial'→'paid') günceller. **Ama (P1)**: fazla ödeme koruması yok (bakiye negatife düşebilir); `newStatus` satırında ölü dal var; **`updateInvoice` satırları değiştirirken `balance = total` yapıyor → ödeme varken satır değişince bakiye sıfırlanıp borç silinmiş gibi görünür.**

### 6.2 Kasa/Banka (cash-bank)
- **Bakiye tek doğruluk kaynağı**: saklı `balance` kolonu; movement transaction içinde `balance_before`/`balance_after` snapshot'ı alınır, hesap `balance ±= amount` atomik UPDATE. (Yorumda açıkça belirtilmiş: yeniden hesaplama çift kaynak yaratıp transferleri saymadığı için terk edildi — güzel mühendislik kararı ve bunu doğrulayan yaşanmış hata.)
- Çekimde `INSUFFICIENT_BALANCE`, silinmiş hesaba işlem engeli, transferde aynı hesap engeli.
- **Banka ekstraları** (loans/credit-cards/pos) 12 rotalık tam CRUD.
- **İyileştirme yapıldı**: `GET /cash-bank` artık `latest_balance` + `account_count` dönüyor; UI "son işlem bakiyesi" yerine gerçek anlık bakiyeyi gösteriyor.

### 6.3 Muhasebe (accounting — projenin en disiplinli modülü)
- **Çift taraflı fiş denge koruması** servis katmanında: negatif yasak, satır tek taraflılık, borç=alacak (onayda), boş satır yasak.
- **Dönem kilitleri**: `fiscal_periods.status='closed'` veya `period_locks.lock_date` geçmişse → `PERIOD_LOCKED` (409). Gerçek mali dönem kapama semantiği.
- **Gap-free yevmiye numarası**: `pg_advisory_xact_lock(hashtext(tenantId))` + `MAX(entry_no)+1` — yarışsız ardışık numara.
- **Gerçek iş kuralları**: TDHP hesabı silinemez, hareketli hesap silinemez, draft dışı fişe satır eklenemez, kaynak (source_type+source_id) ikinci kez otomatik fiş üretemez.
- **TDHP şablonu** (accounting/tdhp.ts): kısaltılmış hesap planı, `ensureChartOfAccounts` ile tenant'a idempotent bootstrap; group/detail ayrımı.

### 6.4 Raporlar (reports_plus)
- **Canlı hesaplama** kararı doğru: sayılar arşivden değil gerçek tablolardan, `Promise.all` ile paralel aggregate KPI'lar (satış/alış/gider/stok/kasa/yaşlandırma/KDV). `report_generations` yalnızca arşiv kaydı.
- **Ama (P1)**: `POST /reports/generate` "pdf|excel|csv" kabul edip `status: 'completed'` döner, **hiçbir dosya üretmez** (`fileUrl` hiç set edilmiyor) — yani format ucu bir taslak/stub.

### 6.5 Cari (contacts) & İmport Algoritması
- **Ledger**: `party_ledger_entries` üzerinden borç/alacak bakiyeler; `listContactsWithBalances` tek büyük SQL'de `FILTER (WHERE type=...)` aggregate + `COALESCE`.
- **CSV import** (import.service.ts) teknik kalite yüksek: BOM atma, ayraç otomatik tespiti, tırnak-escape, TR karakter normalizasyonu, TR/EN başlık alias'ı, TCKN/VKN/telefon doğrulama, **dry-run → onay → commit** sözleşmesi ve entitlement limiti (`max_import_rows_monthly`).
- **P1 (kontrol boşluğu)**: `express.json limit '1mb'` ama import şeması `max(2_000_000)` karakter → 1MB üzeri CSV daha validation'a girmeden **413 döner**; sözleşmede yazan 2MB limiti fiilen geçersiz.

### 6.6 Yedekleme (backup)
- Migrator-rol ayrı havuzla (`DATABASE_MIGRATOR_URL`) RLS'siz tam dump; **süreç içi seri kuyruk** (aynı anda tek yedek) + süreç başına bir kez stale-run temizliği (`ensureSwept`); zamanlayıcı (`next_run_at` DB'de) → süreç yeniden başlasa takvim korunur. İyi.
- **P0**: backup route'ları yalnızca `authenticate` taşıyor → **herhangi bir tenant'ın herhangi bir kimliği doğrulanmış üyesi tüm çok-kiracılı DB dump'ını indirebilir / yedekleri silebilir / ayarları değiştirebilir.** `GET /:id/download` migrator rolüyle okur (RLS'siz). Bu kapatılması gereken bir veri sızıntısı.

### 6.7 Outbox + Worker (e-posta hattı)
- Tasarım (ADR-0020) doğru yönde: transactional outbox → BullMQ (`outbox-dispatch` → `email-send`), `jobId = outboxId` ile **idempotency**, "at-least-once" semantiği.
- **Ama hat GERÇEKTE ÇALIŞMIYOR (P1)**: `OutboxService.processItem` yalnızca `attempts+1` yapıyor — hiçbir provider çağrısı yok; **worker `runner.ts` handlers'sız başlıyor** ("Worker iskelet hazır"). Sonuç: prod'da parola sıfırlama/kayıt e-postaları **hiç gönderilmez** (dev'de token JSON'da dönüyor). Ayrıca `processItem` `SELECT ... FOR UPDATE`'i transaction dışında yapıyor → kilidi anında bırakır, çift işleme riski.

---

## 7) Ön Yüz Mimarisi (apps/web)

- **Yapı**: 18 view, 4 komponent, `lib/` altında axios istemcisi + domain bazlı API modülleri, Pinia store'lar, Vue Router, PWA manifest (Tailwind 4, `@kuleplus/ui`).
- **Auth entegrasyonu iyi yazılmış**: `withCredentials`, 401'de **tek uçuşlu (single-flight) sessiz refresh** (eşzamanlı N×401 → tek `/refresh` çağrısı), auth-endpoint 401'lerini form hatası sayan istisna, oturum temizleyip login'e gönderme. Access token `rememberMe`'ye göre localStorage/sessionStorage ayrımı.
- **P1 – 2FA yönetim ekranları kırık**: store `POST /auth/2fa/verify` ile `{ totp }` gönderiyor ama backend `req.body.totpCode` bekliyor ve **bu rotalarda `authenticate` yok** → `req.user` undefined → 500.
- **P2**: `api.ts` varsayılan baseURL `http://localhost:4000/api` (gerçek 3000; `.env` ile eziliyor ama varsayılan ölü). `apps/web/package.json`'da `nodemailer` ve `google-auth-library` gibi **sunucu bağımlılıkları browser paketinde** duruyor.
- Router guard minör: kimliği doğrulanmış kullanıcı `/` (home) ekranına erişemez, dashboard'a itilir.

---


## 8) Test, CI, Governance, Dokümantasyon — Doğrulanmış Durum

**İyi taraf**: Test kültürü var — 14 test dosyası, 156 test (auth/sözleşme/entitlement/contacts/stock/expense/accounting/authorization/platform) + gerçek Postgres RLS testi (`packages/db/tests/rls.test.ts`) + `shared` ve `ui` unit testleri + uçtan-uca akış harness'ı (in-memory fake DB ile kayıt→başvuru→onay→davet→rol→kilitli modül senaryosu). CI 9 adımlı, Postgres 16 servisli, governance + a11y + bundle budget içeriyor. 21 ADR, GOVERNANCE, KVKK/DPA/veri envanteri, hata kodu-permission katalogları — **belgeleme kültürü küçük takım için üst sıralarda**.

**Kırmızı gerçekler (CI'nın bugün geçmeme nedenleri)**:
1. `npm run migrate` çöküyor (P0 — aşağıda).
2. GOVERNANCE: 5 tablo katalogda kayıtlı değil (`bank_loans`, `credit_cards`, `pos_accounts`, `backup_jobs`, `backup_settings`) → "GOVERNANCE tek kaynak" sözleşmesi kırılmış, şema dokümandan önce gitmiş.
3. ESLint: 24 hata — çoğu `accounting/service.ts`'te `no-explicit-any` (satır ~1000-1080 makro üretim), 2'si `scripts/_read_log.mjs`.
4. 3 unit test kırmızı: `contacts listContactLedger` ×2 ve `expense kategori oluştur` — servisin eklediği yeni sorgu adımlarına test mock'ları ayak uyduramamış (gerçek prod hatası değil, **test bakım borcu**; ama CI'yı kırıyor ve gelecekteki gerçek regresyonları maskeleme riski oluşturuyor).

---

## 9) Sağlamlık Kararı — Skor Kartı

**Mimari olgunluk karnesi (1–5):**

| Boyut | Skor | Yorum |
|---|---|---|
| Çok kiracılı izolasyon | **5/5** | RLS + GUC + ALS + scope-pinned pool: üzerinde düşünülmüş, yorumlarla kanıtlı |
| Kimlik/session/TOTP/lockout | **4.5/5** | rotation, authVersion, hash-at-rest, OWASP argon2; HTTP rate-limit + reuse-detection eksik |
| Domain bütünlüğü (muhasebe/fatura/stok) | **4.5/5** | advisory lock gap-free numara, dönem kilidi, denge koruması, kaynak tekilliği |
| RBAC zorunlama | **1/5** | katalog var, enforce yok — en zayıf halka |
| Entegrasyon tamlığı (outbox→email, rapor dosyası) | **2/5** | tasarım var, uçlar döşenmemiş |
| Test/CI/gösterim | **3/5** | iyi kapsam + gerçek DB testi; ama migrate/governance/3 unit/lint kırmızı → CI geçmez |
| Dokümantasyon/ADR | **5/5** | 21 ADR, kapsamlı spec, yasal metin seti |
| Repo hijyeni | **2/5** | kök `api.log`/`web.log`/`login.json`/`index.html`, `.vue.backup`, 10 `_*.mjs`, `integtrations/` boş typo klasörü |

**Genel sonuç**: Projenin *temeli* sağlam — ortalamanın net üzerinde. Sektörde birçok ekip tenancy'yi bu disiplinle yazmaz; muhasebe domain kırıcıları ve dokümantasyon ciddi emek ürünü. Ancak mevcut hâliyle **üretime alınamaz**: CI kırmızı (migrate, governance, lint, 3 test), RBAC hiç zorlamıyor, 2FA/backup güvenlik açıkları var, e-posta hattı ve rapor dosyası aslında çalışmıyor. Yani "Faz 0–3 sprint'i; harika bir iskelet + yarım kalmış uçlar" diye özetlenebilir.

---



## 10) Önceliklendirilmiş Aksiyon Planı

### 🔴 P0 — Üretim kilidi / güvenlik (bu hafta)
1. **`202610220000_accounting.down.sql` yaz** (migration'ları listeleyip reverse `DROP TABLE` sırası). `npm run migrate` ve CI derhal yeşile döner.
2. **`requirePermission` middleware'i yaz** ve kritik iş rotalarına bağla (authorization, contacts delete, fiş onaylama, fatura silme dahil tüm mutasyonlar). En azından `authorization/*` uçlarına `tenantContext` + yönetici/owner kapısı koy.
3. **Backup uçlarını kilitle**: `requirePlatformUser()` veya tenant-owner + RBAC; download `/:id` için tenant eşleşmesini doğrula. RLS'siz migrator dump'ını keyfi auth kullanıcısına gösterme.
4. **2FA/password-change rotalarını düzelt**: route'lara `authenticate` ekle; frontend `{totp}` ↔ backend `totpCode` sözleşmesini eşitle; `req.user` yoksa 401 dön (500 değil).
5. **3 unit testi güncelle** (ledger opening sorgusu + expense category kök nedeni: yeni sorgu adımına göre mock şeklini düzelt) ve **GOVERNANCE.md'ye 5 tabloyu işle / governance-check'i geçir**; `_read_log.mjs`'i sil veya ESLint'e izin ver.
6. **`verifyAndEnableTwoFactor`**: yedek kodların **düz metnini** bir kez döndür (şu an sha256 hash'lerini döndürüyor — kullanıcı yedek kodu kaydedemez).

### 🟠 P1 — Mimari sağlamlaştırma (1–2 sprint)
7. **Para standardını uygula**: fatura/kasa/gider toplamlarında `number` → `decimal.js`/`money.ts` (SPEC §0.3 zaten yasaklıyor; DB NUMERIC ama uygulama float — yuvarlama riski).
8. **İstek-scoped transaction / havuz**: okuma isteklerinde bağlantı tıkamayı ve `res.close` COMMIT'inin geç kalmasını çöz (işlem sonunda COMMIT, GET'lerde scope'suz/salt-okunur sorgu).
9. **Outbox → email hattını gerçekten bağla**: api'de SMTP portu, worker'a handlers ver, `runner.ts`'te açıkça bağla; `processItem`'ın `FOR UPDATE`'ini transaction içine al. Parola sıfırlama e-postası böylece çalışır.
10. **Yumuşak silme + referans bütünlüğü**: `contacts.deleteContact` vs soft-delete (ADR-0010); `deleteInvoice`'in ödeme/ledger ile etkileşimini koru; mali mutasyonlara **audit_logs yaz** (şu an sadece company/platform yazıyor — fatura silen, fiş onaylayan izlenemiyor).
11. **Fazla ödeme / bakiye sıfırlama korumaları** (invoice `replaceLines`, `addPayment`), **optimistic lock (ADR-0015)** `If-Match`/`version` kapısı.
12. **Rate limiting** (login/register/kayıt e-posta domain engeli — ROADMAP'te zaten maddeleri var) ve **refresh-token reuse detection**.

### 🟡 P2 — Kalite & hijyen
13. `express.json` limitini import şemasıyla eşitle (2MB) veya ayrı `body-parser` kullan.
14. `report_generations`'a gerçek dosya üretimi (PDF/Excel) veya uçları işaretle.
15. Repo temizliği: `api.log`, `web.log`, `login.json`, kök `index.html`, `.vue.backup`, 10 adet `_*.mjs` teşhis dosyasını `.gitignore`/sil; `integtrations/` boş klasörü; web'den `nodemailer`/`google-auth-library` sök.
16. `updateInvoice` ölü dal (`invoice.balance > 0 ? ...`) ve `replaceLines`'in bakiye davranışını netleştir.
17. OpenAPI (depoda 674 satır) için Zod'dan türetme aracını (ADR-0013 sözü) tamamla ya da resmi olarak "manuel" ilan et.

---

## Ek: Bu oturumda yaptığım dokunuşlar
- Route envanteri için `scripts/_route_inventory.mjs`/`.txt` ve test çıktı dosyalarını oluşturup analiz sonunda **sildim** (repo temiz).
- Önceki görevde eklenen `_verify_bank_final.mjs` vb. teşhis scriptleri duruyor — ister P2 #15 kapsamında sil, ister regresyon probu olarak sakla.

