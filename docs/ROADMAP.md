# YOL HARİTASI (ROADMAP.md)

## Kurumsal ERP ve İşletme Yönetim Platformu — Ürün, Teknik ve Ticari Geliştirme Planı

**Sürüm:** 5.1.0
**Tarih:** 5 Ekim 2026
**Durum:** Onay bekliyor
**İlgili dokümanlar:** [`../README.md`](../README.md) v4.1.0 · [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md) v5.1.0 · [`GOVERNANCE.md`](GOVERNANCE.md) v1.1.0 · [`adr/`](adr/)

**Kaynaklar:** Bu doküman; `ROADMAP.md v3.0`, `ROADMAP - astra.md`, `ROADMAP gpt.md v2.0.2`, `ROADMAP deep.md v4.0.0-birleşik` ve `ROADMAP v4.1.0 çelişki düzeltmeleri` dosyalarının en güçlü bölümleri birleştirilerek, **TECHNICAL_SPEC v5.1.0**, **README v4.1.0** ve **GOVERNANCE v1.1.0** ile tam uyumlu hale getirilmiştir.

### v5.1.0'da Ne Değişti?

| # | Değişiklik | Kaynak |
|---|-----------|--------|
| 1 | Faz 3 iş listesindeki "Belge düzeyinde çok para birimi" maddesi yeniden yazıldı: **Faz 6'ya ertelendi**, Faz 3'te yalnızca `NUMERIC(20,8)` kolon standardı ve `exchange_rates` altyapısı hazırlanır (UI ve iş akışında kullanılmaz). | A1 (B seçeneği) |
| 2 | §3 Faz Özeti tablosuna **"Bağımlılık"** kolonu eklendi; Faz 6/7 paralel çalışma netleştirildi. | A3 (C seçeneği) |
| 3 | §10 Açık Kararlar tablosuna **K-15, K-16, K-17, K-18, K-19, K-20** (kapalı kararlar) eklendi. | txt + ADR-0003/0005/0008/0011/0012/0013 |
| 4 | Faz 0 "Süreç" bölümüne **CI GOVERNANCE kural kontrolü** maddesi eklendi. | txt |
| 5 | Faz 2 "Pazarlama Sitesi" alt bölümü **Astro + Cloudflare Pages** olarak netleştirildi. | A5 |
| 6 | Faz 2 çıkış kapısına **erişilebilirlik (axe-core CI)** ve **frontend performans bütçesi** maddeleri eklendi. | B10, B12 |
| 7 | Faz 2 "Pazarlama Sitesi" altına **SEO/analitik** referansı eklendi (`docs/product/seo-analytics.md`). | B9 |
| 8 | Faz 4 önkoşullarına **işletmeci şirket kurulumu + entegratör hesabı** ve **destek SLA tanımı** eklendi. | B20 (B), B23 |
| 9 | Faz 4'e **platform faturalama detay referansı** eklendi (`docs/operations/platform-billing.md`). | B20 (B) |
| 10 | Faz 5 çıkış kapısına **RPO/RTO ölçüm tatbikatı** referansı eklendi (`docs/operations/restore-drill-*`). | A6 |
| 11 | Faz 0 önkoşullarına **marka adı** (placeholder — `docs/brand.md`) maddesi eklendi. | B1 |
| 12 | §0.1 Ajan okuma sırasına **yeni referans dokümanları** eklendi (permissions-catalog, error-codes, screens, i18n, email-templates). | B2, B3, B5, B6, B7 |
| 13 | §8 Kalite kapılarına **test coverage eşiği** eklendi (genel %75, kritik %95). | B13 |
| 14 | §8.1 Sürüm Aşamaları'na **preview environment** notu eklendi. | B14 |
| 15 | Yeni dosya referansları: `docs/product/import-templates/`, `docs/legal/`, `docs/operations/incident-runbook.md`. | B17, B22, B25 |

### v5.0.0'da Ne Değişti?

| # | Değişiklik | Kaynak |
|---|-----------|--------|
| 1 | Onboarding varsayılanı **`manual`** olarak düzeltildi; `hybrid` geçişi Faz 2 beta verisi sonrası ADR ile değerlendirilir. | GOVERNANCE §5, SPEC §4.3 |
| 2 | "Super Admin singleton" kaldırıldı; **`platform_owner` (tek) + platform rolleri + `support_access_grants`** modeli benimsendi. `platform_settings` key-value tablosu. | GOVERNANCE §4, SPEC §5.1 |
| 3 | Varsayılan rol listesinden `IK` ve `URETIM` çıkarıldı; **`MALI_MUSAVIR`** eklendi. | SPEC §6.6 |
| 4 | K-10 kapatıldı: modül kodu = permission öneki = klasör = entitlement kodu; tek kaynak **GOVERNANCE §2**. `crm.*`, `purchasing.*`, `logistics.*`, `accounting.invoice.*` kalıcı olarak yasak. | GOVERNANCE §2, ADR-0006/0007 |
| 5 | Abonelik tablolarının faz dağılımı SPEC §8.2 ile uyumlu: Faz 1'e `plan_limits` eklendi; `module_dependencies`, `subscriptions`, `subscription_items`, `subscription_changes` Faz 4'e taşındı. | SPEC §8.2 |
| 6 | ID standardı **UUID v7** (uygulama tarafında üretim; `gen_random_uuid()` kullanılmaz). Ortak kolon standardı ve `If-Match` optimistic lock eklendi. | SPEC §0 |
| 7 | `tenant_domains` iş listesinden çıkarıldı; şirket profili `tenant_settings.settings` JSONB içinde. | SPEC §6.9 |
| 8 | RPO/RTO hedefleri düzeltildi: **RPO ≤ 1 saat, RTO ≤ 4 saat** (saniye değil); ölçülmeden SLA olarak satılmaz. | SPEC §30.3 |
| 9 | SPEC bölüm referansları güncellendi: davet §4.6, aynı transaction §10.3, çift kayıt önleme §10.4, muhasebe dengesi §10.5, belge durumları §12.2, numara üretimi §12.3, hata kodu kataloğu §22.2. | SPEC v5.0.0 |
| 10 | Faz 1 Platform Paneli'ne **şirket başvurusu inceleme ekranı** eklendi (manual onboarding varsayılanının zorunlu parçası). | README §4.3, §7 |
| 11 | Ajan yasaklarına 3 madde eklendi: grantsız çapraz tenant erişimi, GOVERNANCE §2 dışı modül kodu, `Idempotency-Key` atlamak. | SPEC §5.1, §22.2; GOVERNANCE §2 |
| 12 | Ajan okuma sırasına **GOVERNANCE.md** eklendi; §1.2'de yetki hiyerarşisi özeti ("SPEC nasıl, ROADMAP ne zaman") yer alıyor. | GOVERNANCE §1 |

---

## 0. Bu Doküman Nasıl Kullanılır — AI Ajan Protokolü

Bu bölüm, Roadmap'i DeepSeek, Codex veya benzeri bir kod üretme ajanına verdiğinizde ajanın nasıl davranacağını tanımlar. Ajan bu protokolü ihlal edemez.

### 0.1. Ajan İçin Bağlayıcı Okuma Sırası

Her oturum başında ajan şu sırayı izler:

1. **README.md** — ürünün ne olduğu, kime satıldığı, modül/paket yapısı.
2. **docs/GOVERNANCE.md** — doküman yetki hiyerarşisi, tek modül kodu tablosu, bağlayıcı kararlar.
3. **docs/TECHNICAL_SPEC.md** — mimari kararlar, domain sınırları, veri modeli, güvenlik.
4. **docs/ROADMAP.md** (bu dosya) — fazlar, kabul kriterleri, tavsiyeler.
5. **docs/adr/** — alınmış mimari kararlar.
6. **docs/api/permissions-catalog.md** — tam permission kataloğu (modül.resource.action + delegatable).
7. **docs/api/error-codes.md** — tam hata kodu kataloğu (kod, HTTP, modül, mesaj).
8. **docs/product/screens.md** — ekran listesi (route + yetki + faz).
9. **docs/product/i18n.md** — anahtar kuralı + backend hata kodu → frontend çeviri eşlemesi.
10. **docs/product/email-templates.md** — e-posta şablon envanteri.

**Yetki kuralı (GOVERNANCE §1):** Ürün önceliği, faz sırası, süreler ve çıkış kapılarında bu doküman; veri modeli, permission formatı, RLS ve finansal standartlarda TECHNICAL_SPEC esastır. İkisi çelişirse bu bir çelişki değil **katmandır**: SPEC "nasıl", ROADMAP "ne zaman / ne önce" söyler. Gerçek çelişkide önce ADR yazılır, etkilenen dokümanlar aynı PR'da güncellenir (GOVERNANCE §7).

### 0.2. Tamamlanma Zinciri (Her Özellik İçin Zorunlu)

Bir özellik "tamamlandı" sayılmaz; aşağıdaki zincir tamamlanana kadar açık kalır:

```text
migration → şema doğrulama → service → API → yetki (permission)
   → paket kontrolü (entitlement) → denetim (audit)
   → test (unit + integration + e2e) → dokümantasyon
   Bu zincirin herhangi bir halkası atlanırsa özellik "Definition of Done" (§8.2) kapsamında reddedilir.

0.3. Tavsiye ve Onay Mekanizması (Zorunlu Davranış)
Her fazın başında ajan:

Fazın "🤖 AI Ajanı için Tavsiyeler" tablosunu okur.

Tablodaki her satırı kullanıcıya açıkça sunar: tavsiye, gerekçe, alternatif, öneri.

Kullanıcı her satır için Onay / Red / Değiştir kararı verir.

Kararları docs/adr/ altına kısa ADR olarak yazar (bir dosya = bir karar).

Ancak onaydan sonra iş listesine geçer.

Kural: Ajan, onaylanmamış bir tavsiyeyi uygulayamaz; ama tavsiye sunmadan da iş listesine geçemez. Tablo boş olsa bile "Bu fazda önerilen bir ek karar yok" beyanı zorunludur.

0.4. Faz Geçiş Kapısı
text
Faz N tamamlandı mı?
   ↓
Kabul kriterleri test raporuyla kanıtlandı mı?
   ↓
Çıkış kapısı kontrol listesi imzalandı mı?
   ↓
KULLANICI ONAYI alındı mı?
   ↓
Faz N+1 başlar
Kullanıcı onayı olmadan sonraki faza geçilmez. Ajan kendi başına "yeterince iyi" kararı veremez.

0.5. Ajan İçin Yasaklar
❌ FLOAT/DOUBLE ile para hesabı yapmak (SPEC §9.1).

❌ Controller içine iş kuralı veya SQL yazmak (SPEC §29.4).

❌ Domain katmanını başka domain'in repository'sine bağlamak (Port/Application Service kullanılmalı — SPEC §2, §29.3).

❌ Tenant izolasyonunu yalnızca frontend'de sağlamak (RLS + ilişkisel kısıtlar zorunlu — SPEC §7).

❌ MAX(number) + 1 ile belge numarası üretmek (kilitli sayaç — SPEC §12.3).

❌ Kesinleşmiş finansal hareketi güncellemek/silmek; finansal belgelerde soft delete kullanmak (SPEC §0.4, §10.1).

❌ Webhook veya ödemeyi idempotent olmadan işlemek (SPEC §8.6, §20).

❌ UUID v7 standardı dışına çıkmak; birincil anahtarı gen_random_uuid() ile üretmek (v4 üretir — SPEC §0.1).

❌ Test yazmadan PR açmak (SPEC §30.5).

❌ Kullanıcı onayı olmadan yeni bağımlılık eklemek (lockfile değişikliği — SPEC §1.1).

❌ support_access_grants kaydı olmadan platform tarafından tenant verisi görüntülemek (SPEC §5.1).

❌ GOVERNANCE §2 dışında modül kodu / permission öneki kullanmak (crm.*, purchasing.*, logistics.*, accounting.invoice.* kalıcı yasak).

❌ Finansal kesinleştirme, ödeme, WhatsApp ve senkronizasyon isteklerinde Idempotency-Key başlığını atlamak (SPEC §22.2).

1. Strateji ve Okuma Notları
1.1. Temel Strateji
Önce güvenli çekirdek → sonra ücretsiz değer → sonra ücretli modül → sonra ticari altyapı → sonra derinlik → en son otomasyon ve AI.

Herhangi bir adımın atlanması, ileride en pahalı yeniden yazımı doğurur (kaynak: ROADMAP gpt.md §32, TECHNICAL_SPEC §29).

1.2. Okuma Notları ve Varsayımlar
Süreler gösterge niteliğindedir ve şu ekibe göre hesaplanmıştır: 3 geliştirici (backend ağırlıklı, full-stack, frontend) + yarı zamanlı tasarımcı + danışman mali müşavir (SMMM). Ekip farklıysa süreler orantılı değişir (bkz. §10 K-09).

"Hf" = hafta. Süreler test, dokümantasyon ve hata düzeltmeyi içerir.

Bu roadmap, mevcut teknoloji yığınını (Node.js 22 LTS, PostgreSQL 16+, Drizzle, Vue 3, Redis/BullMQ, decimal.js — SPEC §1.3) değiştirmeden uygulanabilir.

SMMM danışman bir "lüks" değil kalite kapısıdır: muhasebe doğruluğu (Faz 5) onun imzasına bağlıdır.

Fiyatlar ve ücretsiz sayısal kotalar ticari karar olarak açık bırakılmıştır; mimari bu değerleri konfigürasyondan yönetir (plans, plan_features, plan_limits, prices — SPEC §8).

Doküman sürümleri: TECHNICAL_SPEC 5.1.0, README 4.1.0, GOVERNANCE 1.1.0. Modül kodu/permission öneki uyumsuzluğu (eski K-10) GOVERNANCE §2 ile kapatılmıştır.

Bu dokümanın faz sırası yetkisi GOVERNANCE §1'den gelir; teknik "nasıl" sorularında SPEC'e atıf yapılır, tekrar yazılmaz.

1.3. Neden Bu Sıra? (Kısa Karşılaştırma)
#	Eski Yaklaşım (v2.0.2)	Sorun	Bu Roadmap
1	ERP en sonda (Faz 8)	Satılacak asıl ürün en geç geliyordu	ERP (Cari→Stok→Fatura→Kasa→e-Dönüşüm→Muhasebe) ana hat
2	Önce Flutter + WhatsApp + offline	Yüksek maliyet, gelire etki düşük	Web + PWA; native/WhatsApp/offline koşullu (§6)
3	Her şirket tam otomatik kayıt	Kalite ve kötüye kullanım kontrolsüz	onboarding_mode ayarı (auto/manual/hybrid); varsayılan manual, beta verisiyle hybrid'e geçiş ADR ile (GOVERNANCE §5)
4	Tek Super Admin	Ölçeklenmez, tek hata noktası	platform_owner (tek) + platform_support/platform_sales/platform_finance/platform_readonly + support_access_grants (SPEC §5.1)
5	SaaS faturalama en sonda	Gelir takibi sonradan sökülür	Entitlement motoru Faz 1'de
6	Kendi UBL-TR/XSD hattı	Yüksek efor/risk	Entegratör adapter'ı (EDocumentPort — SPEC §21)
7	AI/marketplace erken	Dikkat dağıtıcı	Ertelenenler + geri dönüş tetikleyicileri (§6)
8	Başarı = "çalışıyor"	Ticari hedefle bağlantısız	Aktivasyon, dönüşüm, MRR odaklı ölçütler (§2)
1.4. Kritik Mevzuat Bulgusu
1 Ocak 2026'dan itibaren e-Fatura/e-Arşiv kapsamında olmayan mükelleflerin faturaları da tutara bakılmaksızın e-Arşiv olarak düzenlenmek zorundadır; 3M TL üzeri brüt satış hasılatı olanlar için e-Fatura geçiş son tarihi 1 Temmuz 2026'ydı. Bu nedenle Fatura modülü tek başına satılabilir değildir; e-Dönüşüm entegrasyonu ilk ücretli sürümün zorunlu parçasıdır (Faz 4). Faz 3'te "dış sistemde kesilen faturayı kaydet" modu ile köprü kurulur.

Not: Mevzuat bilgileri 5 Ekim 2026 itibarıyla kamuya açık kaynaklardan derlenmiştir; canlıya almadan önce mali müşavir + hukukçu doğrulaması gerekir (README §10).

2. Başarı Ölçütleri
Başarı yalnızca "ekran var mı" ile ölçülmez. Üç eksende ölçülür:

2.1. Ürün Ölçütleri
Ölçüt	Tanım	Neden
North Star	Son 30 günde en az 1 belge/hareket giren aktif şirket sayısı	Gerçek kullanım
Aktivasyon	Kayıttan sonraki 7 gün içinde ≥ 10 kayıt giren şirket oranı	Onboarding kalitesi
İlk değer süresi	Kayıt → ilk cari/ürün/hareket girişi (dk)	Sadelik
Veri kalitesi	Başarısız import ve düzeltme oranı	Güven
Kullanılabilirlik	Temel görev tamamlama oranı (kullanıcı testi)	UX
Destek yükü	Aktif şirket başına destek talebi	Ölçeklenebilirlik
2.2. Ticari Ölçütler
Ölçüt	Tanım
Ücretliye dönüşüm	Ücretsiz → ücretli şirket oranı (kohort bazlı)
MRR / ARR	Aylık/yıllık yinelenen gelir (KDV hariç, indirim sonrası; tanımlar SPEC §8.9)
Churn	Aylık ayrılan ücretli şirket ve gelir oranı (müşteri ve gelir kaybı ayrı)
Tahsilat başarısı	Yenilemede başarılı ödeme oranı
Modül başına satış	Hangi modül ne kadar satıyor
Maliyet	Aktif tenant başına altyapı + destek maliyeti
2.3. Teknik Ölçütler
Ölçüt	Tanım
Hata oranı	API ve worker 5xx/hata oranı
Hız	p95 yanıt: Liste <500ms, Dashboard <1s (SPEC §30.2)
Kuyruk	Bekleyen ve kalıcı başarısız iş sayısı
Entegrasyon	Belirsiz ve mutabakatsız işlem sayısı
Kurtarma	Ölçülen RPO/RTO (hedef: RPO ≤ 1 saat, RTO ≤ 4 saat — SPEC §30.3; ölçülmeden SLA olarak satılmaz)
Güvenlik	Kritik açık, yetki ihlali, tenant sızıntı sayısı = 0
Frontend hız	LCP < 2.5s, CLS < 0.1, TBT < 200ms, Lighthouse ≥ 85 (staging, masaüstü)
Frontend bundle	Initial JS < 250 KB gzip, route chunk < 100 KB gzip
Sayısal hedefler Faz 2 beta verisi geldikten sonra belirlenir; baştan tahmin edilmez.

3. Faz Özeti
Faz	Başlık	Süre	Kümülatif	Bağımlılık	Çıkış Kapısı	Ticari Etki
0	Temel ve Altyapı	2–3 hf	2–3 hf	—	CI yeşil, izolasyon testi yeşil	—
1	Platform Çekirdeği	5–6 hf	7–9 hf	Faz 0	Kayıt→başvuru→onay→rol→paket kilidi e2e	—
2	Ücretsiz Çekirdek (Cari+Stok+İçe aktarma+Site)	6–8 hf	13–17 hf	Faz 1	Genel Beta: kayıt açık	Kullanıcı tabanı
3	Ücretli Çekirdek: Fatura, Tahsilat, Kasa/Banka, Gider	6–8 hf	19–25 hf	Faz 2	Pilotlar gerçek faturalarını kaydediyor	Satışa hazırlık
4	e-Dönüşüm + SaaS Ticari Altyapı	6–8 hf (2 paralel hat)	25–33 hf	Faz 3	İlk ücretli satış	Gelir başlar
5	Muhasebe	8–10 hf	33–43 hf	Faz 4	SMMM golden test imzası → GA	Mali müşavir kanalı
6	İleri Finans	6–8 hf	39–51 hf	Faz 5 (Faz 7 ile paralel)	KDV/Ba-Bs/e-Defter hazır	Üst paket
7	Yönetim Paketi ve Patron Deneyimi	6–8 hf	39–51 hf	Faz 5 (Faz 6 ile paralel)	Günlük özet + onay akışı canlı	Elde tutma
8	Entegrasyonlar ve Büyüme	sürekli	—	Faz 7	Her entegrasyon kendi tetikleyicisine bağlı	Büyüme
9	Koşullu: Native Mobil, Offline, AI, Otomasyon	Tetikleyiciye bağlı	—	Faz 8 + tetikleyici	§6 tetikleyicileri	—
Not: Kümülatif sütun, Faz 6 ve 7 için ortak bitiş değerini gösterir (paralel yürütme senaryosu). Sıralı yürütülürse 45–59 hf olur.

İlk ücretli satıra kadar (Faz 0–4): yaklaşık 25–33 hafta. Faz 3 ve Faz 4'ün iki hattı paralel yürütülürse 4–6 hafta kazanılır. Faz 6 ve Faz 7 paralel yürütülebilir (ikisi de Faz 5'e bağımlı).

Erken gelir seçeneği: Faz 3 sonunda, ödeme altyapısı hazır olmadan, havale/EFT ile manuel aktivasyon (platform panelinden modül tanımlama) ile ilk pilot satışlar yapılabilir (SPEC §8.5 ile uyumlu).

4. Fazlar (Detaylı)
Her faz aynı şablonla yapılandırılmıştır:
Hedef · Önkoşullar · İş Listesi · Kabul Kriterleri · 🤖 Ajan Tavsiyeleri · Çıkış Kapısı · Sonraki Faz Onayı

FAZ 0 — Temel ve Altyapı
Süre: 2–3 hafta
Bağımlılıklar: Yok
İlgili SPEC: §0 (ID/ortak kolon), §1 (Mimari), §3 (Dil/UTF-8), §29 (SOLID+DRY), §30 (Test/İşletim)
İlgili README: §9 (Teknoloji Yığını), §12 (Kurulum), §13 (Repo Yapısı)
İlgili GOVERNANCE: §2 (Modül kodları), §3 (ID standardı), §7 (Çelişki çözümü)

Hedef
Kod yazmaya başlamadan önce geri döndürülemez kararları sabitlemek ve güvenli bir iskelet kurmak.

Önkoşullar
□ Proje sahibi, ürün adı ve marka kararını vermiş.
□ Hedef kitle önceliği netleşmiş (bkz. §10 K-01).
□ Lisans metni hazırlanmış (özel/ticari — K-13; MIT değil).
□ Hosting bölgesi kararı verilmiş (TR) — KVKK için kritik (K-12).
□ Marka/ürün adı netleşmiş ve docs/brand.md'ye yazılmış (**Kuleplus** — tek kaynak: `apps/site/src/config/site.ts`).
İş Listesi
Karar ve Envanter

□ Mevcut kod/tablo/route/ekran envanteri çıkar (varsa) → "mevcut / eksik / yenilenecek / kapsam dışı" etiketleri.
□ FLOAT/DOUBLE kullanımı taraması: finansal alanlarda bulunan her kullanım kırmızı bayrak.
□ Bağımlılık ve lisans envanteri.
□ ADR şablonu oluştur (docs/adr/0000-template.md); mevcut ADR index (GOVERNANCE §8) ile uyumlu numaralandırma.
□ Eski dokümanları docs/archive/ altına taşı.
□ Teknik karar kayıtları: mimari, ID standardı (UUID v7, uygulama tarafında üretim), ortak kolonlar (SPEC §0.2), timezone, soft delete (yalnız kart tabloları — SPEC §0.4), optimistic lock (If-Match / VERSION_MISMATCH — SPEC §0.5), audit, error sözleşmesi, pagination kuralı (hareket tabloları cursor, kart listeleri offset — SPEC §22.2), sıralama/filtreleme.
□ Ücretsiz paket kapsamı ve limitleri kesinleştir (K-02, K-03).
Monorepo İskelet

□ apps/api, apps/worker, apps/web, apps/site; packages/shared, packages/db, packages/ui (SPEC §1.2 — apps/mobile yoktur).
□ npm workspaces (README §12.1).
□ TypeScript strict: true, ESLint, Prettier, commit kuralları.
□ .env.example + env.ts (Zod ile doğrulama; eksikse uygulama başlamaz).
□ CI: lint → typecheck → test → build (GitHub Actions).
Altyapı İskeleti

□ docker-compose.yml: PostgreSQL 16, Redis, MinIO, Mailpit.
□ Drizzle migration altyapısı + ham SQL migration desteği (RLS, trigger, fonksiyon). Migration adlandırma YYYYMMDDHHMM_<slug>.sql; her migration'ın down SQL'i zorunlu (SPEC §30.7).
□ Üç ayrı DB rolü: app_migrator, app_user, app_platform. app_user BYPASSRLS olamaz (SPEC §7.1).
□ RLS iskeleti: set_config('app.tenant_id', $1, true) transaction-local bağlam.
□ withTenant() yardımcı fonksiyonu + tenant izolasyon test çerçevesi.
□ Ortak altyapı: request ID, yapılandırılmış log (pino, gizli veri maskeleme — SPEC §27.4), merkezi hata sözleşmesi (SPEC §22.1) ve hata kodu kataloğu packages/shared/errors/codes.ts (SPEC §22.2).
□ packages/shared: id (UUID v7), money (decimal.js), tr (normalize, collator, toLocaleUpperCase('tr-TR')), TCKN/VKN/IBAN/telefon doğrulayıcıları + test vektörleri.
□ Tasarım sistemi başlangıcı: renk, tipografi, Button, Input, MoneyInput, DataTable, Drawer, Modal, EmptyState (SPEC §24).
□ Mock sağlayıcılar: e-posta, SMS, ödeme, e-Dönüşüm (EDocumentPort arayüzü + MockEInvoiceProvider — SPEC §21.1; Mock, gerçek provider ile aynı sözleşmeyi sağlar).
Süreç

□ SMMM danışmanla çalışma düzeni; golden test envanteri başlatılır (bkz. Ek B).
□ CI'ya GOVERNANCE kural kontrolü ekle: yeni tablo adı modül koduyla eşleşmiyorsa, permission formatı bozuksa veya yeni FLOAT/DOUBLE tanımı varsa PR reddedilir.
□ Preview environment: apps/web ve apps/site için her PR'a otomatik preview deploy (Cloudflare Pages preview); API/worker preview yok (maliyet).
□ Test coverage eşiği CI'da zorunlu: genel %75, kritik alanlar (packages/shared/money, packages/shared/id, permission değerlendirme zinciri, finansal durum makineleri) %95.
□ axe-core (a11y) CI adımı ekle: WCAG 2.1 AA hedefi (SPEC §24).
□ Bundle-size CI kontrolü ekle: initial < 250 KB gzip, route chunk < 100 KB gzip.
□ docs/ iskelet klasörleri oluştur: api/, operations/, legal/, product/, product/import-templates/, brand.md, archive/.
Kabul Kriterleri
□ docker compose up -d sonrası npm run dev üç süreci başlatıyor.
□ Boş uygulama staging'e CI ile deploy oluyor.
□ "Tenant A, tenant B'nin verisini okuyamaz" testi yeşil.
□ packages/shared/money birim testleri: 0.1 + 0.2 = 0.3 decimal.js ile geçiyor.
□ packages/shared/id: üretilen UUID'ler v7 ve zaman sıralı (ardışık iki ID'de ikincisi büyük).
□ toLocaleUpperCase('tr-TR') ile "i" → "İ", "ı" → "I" testi geçiyor.
□ CI, GOVERNANCE kural kontrolünü çalıştırıyor (kasıtlı ihlal testi yeşil).
□ Preview environment bir PR'da doğrulandı.
□ axe-core CI adımı çalışıyor (boş sayfa bile olsa).
□ Bundle-size CI adımı çalışıyor.
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-0.1	npm workspaces mi, pnpm workspaces mi?	README npm der; pnpm hızlı ve disk verimli	npm (README uyumu)	npm (README ile uyum için)
T-0.2	Sürüm numaralandırma: 0.1.0 mı, 2026.10 mu?	Takvim sürümü pazarlama için kolay	SemVer	SemVer (npm uyumu)
T-0.3	Monorepo görev çalıştırıcı: Turborepo, Nx, sade npm script?	Turborepo hafif ve modern	Nx (ağır), sade npm (yavaş)	Turborepo (hafif, cache'li)
T-0.4	Test runner: Vitest mi, Jest mi?	Vitest ESM/Vite dostu, hızlı	Jest	Vitest (SPEC §1.3 zaten Vitest diyor)
T-0.5	Log kütüphanesi: pino mu, winston mu?	pino hızlı, düşük overhead	winston	pino (SPEC §27.4 ile uyumlu)
T-0.6	Local object storage: MinIO mu, LocalStack mi?	MinIO sade, S3-uyumlu	LocalStack (ağır)	MinIO (README §12.2 zaten MinIO diyor)
T-0.7	Rate limiter: express-rate-limit mi, Redis tabanlı mı?	Redis tabanlı dağıtık ortamda tutarlı	express-rate-limit (RAM)	Redis tabanlı (worker ile uyumlu)
T-0.8	UUID v7 üretimi: hangi paket?	Uygulama tarafında üretim zorunlu (SPEC §0.1); gen_random_uuid() v4 üretir	DB default	Bakımlı bir uuidv7 paketi (ör. uuid v9+), packages/shared/id arkasında
Çıkış Kapısı
□ CI yeşil.
□ Staging deploy başarılı.
□ Tenant izolasyon testi yeşil.
□ Tüm ADR'ler docs/adr/ altında.
□ docs/brand.md oluşturulmuş (marka ismi ya da placeholder).
□ docs/api/permissions-catalog.md, docs/api/error-codes.md, docs/product/screens.md, docs/product/i18n.md, docs/product/email-templates.md, docs/product/seo-analytics.md, docs/product/help-center.md oluşturulmuş.
□ docs/legal/ klasörü + 6 şablon dosyası hazır.
□ docs/operations/ klasörü + incident-runbook, platform-billing, restore-drill-template hazır.
□ docs/product/import-templates/ + 4 sözleşme hazır.
□ docs/archive/ROADMAP-v4-conflict-log.md oluşturulmuş.
□ Kullanıcı onayı alındı.
FAZ 1 — Platform Çekirdeği
Süre: 5–6 hafta
Bağımlılıklar: Faz 0 tamamlanmış olmalı
İlgili SPEC: §4 (Kimlik/Tenant/Şirket), §5 (Platform Yöneticisi/Owner), §6 (Yetkilendirme), §7 (Tenant İzolasyonu), §8 (Abonelik/Entitlement)
İlgili README: §4 (Modül/Paketleme), §6 (Roller/Yetkilendirme), §7 (Platform Paneli)
İlgili GOVERNANCE: §4 (Platform yönetimi), §5 (Onboarding)

Hedef
Üzerine her modülün oturacağı kimlik, şirket, yetki ve paket (entitlement) motorunu kurmak.

Önkoşullar
□ Faz 0 çıkış kapısı geçildi.
□ Onboarding modu kararı teyit edildi: varsayılan manual (K-04, GOVERNANCE §5).
□ Ücretsiz paket limit sayıları belirlendi (K-02).
İş Listesi
Kimlik (Identity)

□ Kayıt (e-posta + şifre), e-posta doğrulama, giriş/çıkış.
□ Döner refresh token (rotation + tekrar kullanım tespiti), şifre sıfırlama, aktif oturum/cihaz listesi.
□ 2FA (TOTP + kurtarma kodları); platform kullanıcıları ve kritik roller için zorunlu (SPEC §27.1).
□ Kayıt koruması: rate limit, CAPTCHA, tek kullanımlık e-posta alan adı engeli.
□ Parola: Argon2id (SPEC §27.1).
□ Kullanıcı yaşam döngüsü durumları: invited, active, suspended, removed (SPEC §4.5).
Şirket (Tenant)

□ Şirket başvurusu formu ve durum takibi. Tenant durum otoritesi tek status alanı: pending, active, suspended, closed, archived (SPEC §4.2; ek is_active yoktur).
□ tenant_settings.onboarding_mode: auto | manual | hybrid; varsayılan manual (SPEC §4.3, GOVERNANCE §5). Hybrid'e geçiş beta sonrası ADR ile.
□ Onay işlemi tek kilitli transaction: başvuru doğrulama → tenant oluştur → owner ata → varsayılan roller/izinler → ücretsiz haklar → varsayılan modüller → audit + outbox (SPEC §4.3). Başvuru ↔ tenant ilişkisi benzersiz.
□ Şirket ayarları: ünvan, VKN/TCKN (isteğe bağlı), vergi dairesi, para birimi, mali yıl, saat dilimi (tenant_settings — SPEC §4.4).
□ Çok şirket: bir kullanıcı birden fazla şirkete üye; şirket değiştirme (yeni token).
□ tenant_settings.settings JSONB şirket profili altyapısı (SPEC §6.9 — tenant_domains tablosu yoktur).
Yetki (Authorization)

□ Davet sistemi (tek kullanımlık, süreli — 7 gün, hash'li token — SPEC §4.6).
□ Permission kataloğu module.resource.action formatında; modül kodu tek kaynak GOVERNANCE §2 (SPEC §6.1, §6.5).
□ Scope: all, own_branch, own_department, assigned_only, created_by_me, self; ilk sürümde fiilen all, created_by_me, assigned_only (SPEC §6.2).
□ Varsayılan tenant rolleri: OWNER, COMPANY_ADMIN, MUHASEBE_YONETICISI, MUHASEBE_PERSONELI, FINANS_YONETICISI, SATINALMA, SATIS, LOJISTIK, DEPO, RAPORLAMA, MALI_MUSAVIR (SPEC §6.6; IK/URETIM yoktur).
□ Departman / organizasyon ağacı (SPEC §6.7).
□ Yetki devri sınırı: role_permissions.delegatable; kritik finansal onaylar (*.approve) ve Owner transferi devredilemez (SPEC §6.4).
□ Tek aktif Owner kısmi unique index ile korunur; Owner transferi kilitli transaction + yeniden kimlik doğrulama + audit (SPEC §5.2).
□ Rol/yetki değişikliği: oturum ve cache sürümlemesiyle etkili olur.
Paket / Entitlement Motoru (Faz 1'in en kritik parçası)

□ Tablolar (SPEC §8.2 Faz 1 dağılımı): modules, features, plans, plan_versions, plan_features, plan_limits, prices, tenant_entitlements, tenant_module_settings, usage_counters, legal_texts, legal_acceptances (ADR-0011).
Not: module_dependencies, subscriptions, subscription_items, subscription_changes SPEC §8.2 gereği Faz 4'tedir. legal_texts/legal_acceptances SPEC §8.2 gereği core modülü altında Faz 1'e çekilmiştir (ADR-0011).

□ Ücretsiz plan seed'i (hangi modüller, hangi limitler; ücretsiz haklar için bitiş tarihi NULL — sahte ücretli abonelik oluşturulmaz, SPEC §8.1).
□ requireModule() / checkLimit() ara katmanları.
□ Hata sözleşmesi: MODULE_NOT_ENTITLED, LIMIT_EXCEEDED (SPEC §22.2).
□ Frontend useEntitlements() + kilitli modül bileşeni + "Yükselt" CTA (README §4.1).
□ Düşürme davranışı: salt okunur mod (veri silinmez — README §4.1, SPEC §8.4).
□ Kota kontrolü transaction ile (yalnızca Redis sayacına güvenilmez; usage_counters otoriter — SPEC §8.4).
Altyapı

□ Audit log (audit_logs tablosu; app_user güncelleyemez/silemez — SPEC §27.3).
□ Outbox + worker iskeleti (outbox_events, tenant_id dahil — SPEC §19.1).
□ E-posta servisi (Mailpit dev, SMTP prod).
□ Yasal metin sürümleme ve kabul kaydı (legal_texts, legal_acceptances).
□ Health endpoint'leri: /healthz, /readyz (SPEC §30.7).
Platform Paneli v0 (SPEC §28.1, README §7)

□ Platform girişi (2FA zorunlu).
□ Şirket başvuruları inceleme ekranı (onay/red) — varsayılan manual onboarding'in zorunlu parçası.
□ Şirket listesi / detayı.
□ Manuel plan/modül tanımlama (grant).
□ Askıya alma / açma.
□ Denetim günlüğü görüntüleme.
□ Platform yönetimi modeli (SPEC §5.1, GOVERNANCE §4): tek platform_owner (platform_users.is_platform_owner = TRUE üzerinde kısmi unique index), bootstrap + kurtarma prosedürü, son aktif owner'ı etkisiz bırakma engeli, platform_settings (key, value) tablosu (singleton yok), çapraz tenant erişimi yalnızca support_access_grants (gerekçe + süre zorunlu, her kullanım audit'li).
Kabul Kriterleri
□ İzolasyon: Başka tenant ID'si verilerek veri okunamaz/değiştirilemez.
□ Eşzamanlılık: Aynı başvuru iki kez onaylansa da tek tenant oluşur.
□ Yetki: Rol düşürülmesi mevcut oturumda etkili olur.
□ Dayanıklılık: E-posta servisi kapalı olsa da şirket kurulumu yarım kalmaz (outbox).
□ Paket kilidi: Kilitli modül endpoint'i MODULE_NOT_ENTITLED döner (yalnızca frontend gizleme değil).
□ Platform güvenliği: Grant'sız platform kullanıcısı tenant verisi göremez; grant kullanımı audit'te görünür.
□ Kayıt → şirket başvurusu → platform onayı → kullanıcı daveti → rol → kilitli modül e2e testi yeşil.
□ İzolasyon ve entitlement testleri CI'da zorunlu.
□ legal_texts ve legal_acceptances tabloları core modülü altında; ikisi de global (tenant_id yok).
□ Kayıt akışında KVKK aydınlatma kabulü legal_acceptances'e yazılıyor (kullanıcı bazlı).
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-1.1	Onboarding modu	GOVERNANCE §5 bağlayıcı: varsayılan manual	auto / hybrid	manual başla; beta sonrası hybrid (risk skoru düşükse auto) ADR ile değerlendirilir
T-1.2	2FA kapsamı	Tüm kullanıcıya dayatmak terk oranını artırır	Tümü / sadece platform	Platform + kritik roller (Owner, Finans) — SPEC §27.1 ile uyumlu
T-1.3	Ücretsiz plan limitleri	Ticari karar	—	K-02 onayı bekleniyor
T-1.4	E-posta doğrulama zorunlu mu?	Spam önleme için zorunlu önerilir	Opsiyonel	Zorunlu (kayıt sonrası 24 saat tolerans)
T-1.5	Şifre minimum gereksinimleri	—	—	12 karakter, karmaşıklık kontrolü, sızmış şifre kontrolü (HaveIBeenPwned API)
T-1.6	Davet süresi: 7 gün mü, 14 gün mü?	SPEC §4.6: 7 gün	14	7 gün (SPEC ile uyumlu)
T-1.7	usage_counters için Redis + DB çift yazma stratejisi	Tek başına Redis yetmez (SPEC §8.4)	Yalnızca DB (yavaş)	DB otoriter + Redis cache + periyodik mutabakat
T-1.8	Audit log immutability: trigger mı, ayrı rol mü?	Ayrı rol daha güçlü	Trigger (yetersiz)	Ayrı rol + trigger + WAL arşivi (SPEC §27.3)
T-1.9	E-posta şablon envanteri hazır mı?	Faz 1'de transactional e-postalar başlıyor	Şablonlar kod içinde	docs/product/email-templates.md envanteri Faz 1'de doldurulur (metinler Faz 2)
T-1.10	Tam permission kataloğu nerede?	CI senkron kontrolü için	SPEC içine gömme	docs/api/permissions-catalog.md + packages/shared/permissions.ts (üretilen)
T-1.11	Tam hata kodu kataloğu nerede?	Frontend çevirisi için	SPEC içine gömme	docs/api/error-codes.md + packages/shared/errors/codes.ts (üretilen)
Çıkış Kapısı
□ Kabul kriterleri test raporuyla kanıtlandı.
□ Tüm ADR'ler yazıldı.
□ docs/product/email-templates.md envanteri doldurulmuş.
□ docs/api/permissions-catalog.md ve docs/api/error-codes.md iskeleti doldurulmuş.
□ Kullanıcı onayı alındı.
□ Sonraki faza (Ücretsiz Çekirdek) geçiş onayı.
FAZ 2 — Ücretsiz Çekirdek (Cari + Stok + İçe Aktarma + Site)
Süre: 6–8 hafta
Bağımlılıklar: Faz 1 tamamlanmış olmalı
İlgili SPEC: §11 (Contact/Cari), §14 (Stok), §23 (Import/Export), §24 (UX/UI), §25 (Web/PWA)
İlgili README: §4 (Modül), §5 (Ekran Kavramı), §13 (Repo)
Çıkış: GENEL BETA

Hedef
İnsanların kayıt olup gerçekten kullanacağı, süresiz ücretsiz başlangıç paketini yayına almak.

Önkoşullar
□ Faz 1 çıkış kapısı geçildi.
□ Tasarım sistemi ilk sürümü hazır (Faz 0'dan).
□ Pazarlama sitesi metinleri ve yasal metinler hazır.
İş Listesi
Cari Hesap (contacts — Ücretsiz)

□ contacts, contact_roles, contact_addresses, contact_phones, contact_emails, contact_relations tabloları (SPEC §11; iletişim verisi yalnızca alt tablolarda, inline alan yok).
□ Müşteri/tedarikçi kartı (kişi/kurum ayrımı).
□ VKN/TCKN doğrulama (biçim + kontrol basamağı; resmi doğrulama olarak sunulmaz — SPEC §3.2).
□ Cari kodu üretimi (tenant + seri bazlı).
□ party_accounts, party_ledger_entries — cari hareket defteri (borç/alacak).
□ Açılış bakiyesi.
□ Açık kalem eşleştirme (settlements, settlement_allocations).
□ Tahsilat / ödeme girişi (kasa/banka bağlantısı opsiyonel — kasa modülü Faz 3).
□ Kısmi kapama ve avans.
□ Ekstre (PDF/Excel), vade günü, yaşlandırma raporu, risk limiti uyarısı.
□ Türkçe duyarlı arama (autocomplete, İ/ı, aksansız eşleşme; Intl.Collator('tr-TR') + pg_trgm + unaccent — SPEC §3.1).
□ Mükerrer kayıt uyarıları (VKN/TCKN + isim kombinasyonu).
□ Excel içe/dışa aktarma (UTF-8 BOM — SPEC §3).
Stok (stock — Ücretsiz)

□ products, product_barcodes, units, unit_conversions, warehouses, stock_documents, stock_document_lines, stock_movements, stock_balances, stock_reservations, inventory_counts, inventory_count_lines, stock_cost_entries tabloları (SPEC §14).
□ Ürün/hizmet kartı, kategori, birim ve birim dönüşümü, barkod.
□ Tek depo (ücretsiz kapsam — SPEC §14.3).
□ Stok hareketi: giriş/çıkış/transfer/sayım düzeltme.
□ Açılış stoğu.
□ Hareketli ağırlıklı ortalama maliyet (SPEC §14.1; FIFO eklenmez).
□ Negatif stok politikası (başlangıç: block — tenant_settings.negative_stock_policy, SPEC §14.1).
□ Kritik stok uyarısı.
□ Stok durum, hareket ve değerleme raporu.
□ Sayım → onaylandığında fark hareketi oluşturur (miktarı doğrudan ezmez — SPEC §14.2).
Ortak

□ İçe aktarma sihirbazı: cari, ürün, açılış bakiyeleri (cari/stok) — kolon eşleştirme → dry-run → hata raporu → onay → kontrollü batch (SPEC §23.1).
□ Büyük dosya tek uzun transaction içine alınmaz; finansal belgede transaction birimi belgedir.
□ Satır bazlı Zod doğrulama; tekrarlanan import mükerrer kayıt oluşturmaz.
□ Dışa aktarma: Excel, CSV UTF-8 BOM; tam veri dışa aktarma (ZIP) — manifest + data/*.csv + files/ + README.txt (SPEC §23.2).
□ Patron Görünümü v1 (cari + stok kartları).
□ Onboarding kontrol listesi.
□ Boş durum ekranları (EmptyState).
□ Kilitli modül önizlemesi (örnek veriyle) + "bekleme listesi / bize ulaşın" CTA (README §4.1).
□ Ürün analitiği olayları (aktivasyon ölçümü).
Pazarlama Sitesi (apps/site — Astro, statik)

□ Astro projesi iskeleti (@astrojs/vue ile packages/ui paylaşımı); Cloudflare Pages'e otomatik deploy.
□ Ana sayfa, özellikler, fiyatlandırma taslağı, SSS, "Mali Müşavirler İçin" sayfası.
□ Yasal sayfalar: kullanım koşulları, gizlilik/KVKK aydınlatma, çerez politikası — kaynak docs/legal/.
□ Yardım merkezi v0: ilk 15 makale (docs/product/help-center.md başlık listesine göre).
□ Blog altyapısı (Astro Content Collections + markdown), sitemap/robots, temel SEO.
□ SEO/analitik: docs/product/seo-analytics.md uygulanır (keyword hedefleri, Plausible event'leri, UTM kuralı, dönüşüm hunisi).
□ İletişim formu → POST /api/v1/public/contact → outbox → e-posta.
□ i18n iskeleti (docs/product/i18n.md kuralına göre) — şimdilik yalnızca TR.
UX

□ Responsive uygulama kabuğu.
□ Şirket seçici ve kullanıcı menüsü.
□ Yetki ve modül bazlı navigasyon.
□ Tablo: kolon bazında Asc/Desc sıralama (SPEC §24).
□ Master-detail + drawer akışları (SPEC §24).
□ Context-aware quick actions (Faz 2: Müşteri → [+Not] — SPEC §24).
□ PWA manifest, service worker (offline iskelet — finansal kesinleştirme yok, çevrimdışı finansal belge yalnızca taslak — SPEC §25).
Kabul Kriterleri
□ Kullanılabilirlik: Yeni kullanıcı yardım almadan cari kart ve ilk hareketi oluşturur.
□ Doğruluk: Hareketler, ekstre ve bakiye tutarlıdır (bakiye kesinleşmiş hareketlerden üretilir — SPEC §11.2).
□ İdempotency: Aynı tahsilat isteği tekrarlanınca ikinci kayıt oluşmaz.
□ Düzeltme: Kesinleşmiş hareket silinmez; ters kayıtla düzeltilir.
□ Ticari model: Paket için süre bitimi veya demo geri sayımı yok.
□ Beta kapısı: En az 10 pilot şirket gerçek veriyle 4 hafta kullanmış; kritik hata yok.
□ Yedek: Yedekten geri yükleme tatbikatı yapılmış (RPO/RTO ölçülmüş).
□ Aktivasyon oranı ölçülüyor.
□ Erişilebilirlik: axe-core CI'da yeşil; klavye ile tüm ana akışlar tamamlanabiliyor (WCAG 2.1 AA).
□ Performans bütçesi: Initial JS < 250 KB gzip, LCP < 2.5s, Lighthouse ≥ 85 (staging).
□ Import şablonları: docs/product/import-templates/ sözleşmeleri ile üretilen .xlsx örnekleri birebir uyumlu.
□ E-posta şablonları: docs/product/email-templates.md envanterindeki tüm şablonlar çalışıyor; test e-postaları Mailpit'te görünüyor.
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-2.1	İçe aktarma: senkron mu, kuyruk mu?	<1000 satır senkron olabilir; büyük dosya kuyruk	Her zaman kuyruk	Eşik: 1000 satır (üstü kuyruk — SPEC §23.1)
T-2.2	Arama: PG ILIKE mi, pg_trgm mi, unaccent mi?	Türkçe aksansız arama için unaccent + trgm	Sadece ILIKE (yavaş)	pg_trgm + unaccent (Türkçe özel karakter eşlemesi — SPEC §3.1)
T-2.3	Cari bakiye: gerçek zamanlı mı, cache mi?	party_ledger_entries üzerinden hesaplama yavaş olabilir	Her istekte SUM	Materialized view + trigger ile refresh (SPEC §11.2)
T-2.4	PDF ekstre: pdfkit mi, Puppeteer mi?	pdfkit hafif ve hızlı; Türkçe font gömülü	Puppeteer (ağır)	pdfkit + Noto Sans (SPEC §1.3)
T-2.5	PWA offline: hangi veriler?	Finansal yazma yasak (SPEC §25)	Sadece okuma snapshot	Sadece okuma (cari/stok liste)
T-2.6	PWA push: Web Push mı, OneSignal mı?	Web Push ücretsiz ve standart	OneSignal (3. parti)	Web Push (VAPID)
T-2.7	Pilot müşteri gizlilik sözleşmesi (DPA)	KVKK zorunlu	—	Her pilota DPA imzalat
Çıkış Kapısı (Genel Beta)
□ Kabul kriterleri karşılandı.
□ Yedek-geri yükleme tatbikatı yapıldı ve raporlandı.
□ Yasal metinler yayında.
□ Hata izleme açık (Sentry — SPEC §30.7).
□ axe-core + Lighthouse CI raporları arşivlendi.
□ Yardım merkezi ilk 15 makale yayında.
□ Kullanıcı onayı alındı.
FAZ 3 — Ücretli Çekirdek: Fatura, Tahsilat, Kasa/Banka, Gider
Süre: 6–8 hafta
Bağımlılıklar: Faz 2 tamamlanmış olmalı
İlgili SPEC: §9 (Finansal Veri), §10 (Yaşam Döngüsü), §12 (Ticari Belge), §13 (Kasa/Banka/Gider)
İlgili README: §4.1 (Paketleme), §5.2 (Uzman Görünümü)

Hedef
Satılacak ilk ücretli modülleri hazırlamak. (Resmi e-belge gönderimi Faz 4'tedir.)

Önkoşullar
□ Faz 2 beta çıkış kapısı geçildi.
□ Belge numaralandırma şeması onaylandı (K-06).
□ Çoklu para birimi kapsamı netleşti (K-05).
İş Listesi
Fatura & Belgeler (trade)

□ Tablolar: sales_quotes, sales_quote_lines, sales_orders, sales_order_lines, purchase_orders, purchase_order_lines, deliveries, delivery_lines, invoices, invoice_lines, invoice_line_taxes, document_links, document_number_sequences (SPEC §12.1).
□ Belge zinciri: teklif → sipariş → irsaliye → fatura (document_links).
□ Satış/alış faturası, iade, iskonto, satır bazlı KDV, tevkifat ve istisna alanları.
□ Karşı taraf ünvan/adres/vergi bilgisi belgede snapshot (contact değişikliği geçmiş faturayı değiştirmez — SPEC §12.1).
□ Çoklu para birimi Faz 6'ya ertelendi (K-05, T-3.1). Faz 3'te yalnızca:
NUMERIC(20,8) kur kolonu standardı (SPEC §9.1) şemada hazır.

exchange_rates tablosu altyapı olarak seed'lenir (TCMB kaynağı).

UI ve iş akışında kullanılmaz; belgeler yalnızca TRY.

□ Yuvarlama kuralları (tek kaynak: packages/shared/rounding; belge türü + vergi kuralına göre sürümlenir).
□ Belge numaralandırma: MAX+1 yasak; kilitlenen sayaç (tenant + belge türü + seri + dönem — SPEC §12.3).
□ Belge durumları beş ayrı alan: business_status, posting_status, payment_status, fulfillment_status, einvoice_status; izinli kombinasyonlar DB CHECK ile (SPEC §12.2).
□ İç belge PDF şablonları (Türkçe font gömülü).
□ "Dış sistemde kesilen faturayı kaydet" modu (resmi numara/ETTN elle girilir).
□ Faturadan otomatik cari hareket ve stok hareketi (aynı transaction'da — SPEC §10.3; stok maliyet kilidi SELECT ... FOR UPDATE).
□ Çift kayıt önleme: (tenant_id, source_type, source_id, effect_type) unique (SPEC §10.4).
□ Durum geçiş matrisi (rol × geçiş) uygulanır: draft → pending_approval → posted → reversed (SPEC §10.2).
Tahsilat / Ödeme

□ Faturaya mahsup, kısmi ödeme, avans, fazla ödeme.
□ Yöntemler: nakit, havale/EFT, kredi kartı/POS (komisyon).
□ settlement_allocations ile çoktan-çoğa ilişki; aynı ödeme tutarı birden fazla belgeye fazla dağıtılamaz (SPEC §11.2).
□ Dağıtılmamış ödeme avans olarak izlenir.
Kasa & Banka (cashbank)

□ Tablolar: cash_accounts, bank_accounts, cash_transactions, bank_transactions, account_transfers, bank_import_batches, bank_import_rows, bank_reconciliation_matches, exchange_rates (SPEC §13.1).
□ Kasa/banka hesapları, hareket, virman, bakiye.
□ Virman: tek para biriminde dengeli; dövizlide kaynak tutar, hedef tutar, kur ve komisyon ayrı.
□ Banka ekstresi içe aktarma (CSV/Excel) — doğrudan muhasebe kaydı oluşturmaz, önce mükerrer kontrolü + kullanıcı eşleştirmesi.
□ Banka hareketi eşleştirme önerisi.
Gider / Masraf (trade modülü altında — ADR-0008)

□ expenses, expense_categories tabloları (SPEC §13.2 — alış faturası değildir, ayrı tablodur).
□ Hızlı gider girişi (tarih, tutar, KDV, kategori, ödeme hesabı, belge fotoğrafı/dosya).
□ Gider kategorileri ve hesap eşleme alanı.
□ Gider kesinleşince cari (varsa) + muhasebe (aktifse) aynı transaction'da.
Yönetim ve Rapor

□ Patron Görünümü v2: nakit durumu, bu hafta gelecek/ödenecek, aylık satış–gider.
□ Raporlar: satış/alış, cari yaşlandırma, kasa/banka defteri, vade takvimi.
□ Domain olayları: InvoicePosted, PaymentRecorded, … + idempotent tüketiciler.
□ Context-aware quick actions (Faz 3+: Müşteri → [+Fatura] [+Tahsilat] — SPEC §24).
Finansal Standart

□ PostgreSQL NUMERIC(20,6) miktar, (20,6) birim fiyat, (20,8) kur, (9,6) vergi, (24,8) ara, (20,4) belge toplamı (SPEC §9.1).
□ FLOAT/DOUBLE yok.
□ API'de parasal değerler decimal string.
□ TypeScript tarafında decimal.js.
□ Yuvarlama belge türü ve vergi kuralına göre sürümlenir.
□ Sunucu sonucu otoriter; istemci yalnızca önizleme.
□ Finansal kesinleştirme uçlarında Idempotency-Key başlığı zorunlu (SPEC §22.2).
Kabul Kriterleri
□ Finans: Fatura, cari ve tahsilat birbiriyle mutabık.
□ Hesap: Decimal, kur ve yuvarlama senaryoları testli (golden test seti).
□ Durum: Tahsilat (payment_status) ile fatura kesinleştirme (posting_status) ayrı izleniyor.
□ Kontrol: Kilitli döneme kayıt girilemiyor (PERIOD_LOCKED).
□ İz: Belgeden tüm parasal etkilerine ulaşılabiliyor.
□ Golden test: Fatura, kısmi tahsilat, iade, döviz, yuvarlama senaryoları yeşil.
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-3.1	Çoklu para birimi MVP'de şart mı?	Pilot müşteri ihtiyacına bağlı	Faz 6'ya ertele	Faz 6'ya ertelendi (K-05). Faz 3'te yalnızca şema kolonu + exchange_rates altyapısı hazır; UI/iş akışı yok.
T-3.2	Belge numaralama formatı: SERI-YIL-SIRA mı?	Yaygın format	SERI/SIRA	SERI-YIL-SIRA (ör. A-2026-00001)
T-3.3	İade belgesi: negatif satır mı, ayrı belge mi?	Ayrı belge denetim için daha iyi	Negatif satır	Ayrı belge türü (sales_return)
T-3.4	Kısmi faturalama: irsaliye→fatura desteği MVP'de mi?	Karmaşık; MVP'yi geciktirir	Faz 8'e ertele	Faz 8'e ertele (MVP'de tam fatura)
T-3.5	Banka ekstre formatı: hangi bankalar?	Pilot müşterilere bağlı	Genel CSV	Genel CSV/Excel + parametrik kolon eşleme
T-3.6	Dönem kilidi: ay bazlı mı, tarih bazlı mı?	Ay bazlı sade; tarih bazlı esnek	Tarih bazlı	Tarih bazlı (varsayılan: son ay kapanmış — SPEC §15)
T-3.7	Sunucu tarafı PDF: worker'da mı, API'de mi?	Ağır işler worker'a	API (bloklar)	Worker (BullMQ)
Çıkış Kapısı (Ticari Beta Öncesi)
□ Kabul kriterleri karşılandı.
□ Golden test seti SMMM danışmanla imzalandı (Faz 5 için hazırlık).
□ Pilot müşteriler gerçek fatura kaydediyor.
□ Kullanıcı onayı alındı.
FAZ 4 — e-Dönüşüm + SaaS Ticari Altyapı
Süre: 6–8 hafta (iki paralel hat)
Bağımlılıklar: Faz 3 tamamlanmış olmalı
İlgili SPEC: §8 (Abonelik/Ticari), §20 (Webhook), §21 (e-Belge)
İlgili README: §7 (Platform Paneli), §10 (Türkiye Uyumluluğu)
Çıkış: İLK ÜCRETLİ SATIŞ

Hedef
e-Dönüşüm entegrasyonunu ve SaaS ticari altyapısını devreye alıp ilk ücretli satışı yapmak.

Önkoşullar
□ Faz 3 çıkış kapısı geçildi.
□ e-Dönüşüm entegratörü seçildi (K-07).
□ Ödeme sağlayıcısı seçildi (K-08).
□ Fiyatlandırma onaylandı (K-03).
□ İşletmeci şirket kurulmuş: VKN alınmış, entegratör hesabı açılmış, platform fatura serisi ve KDV ayarları tanımlı. Detay: docs/operations/platform-billing.md.
□ Destek SLA tanımı yazılı: P1 (kritik) 2 saat, P2 8 saat, P3 1 iş günü; kanal e-posta + panel içi; iş saatleri 09:00–18:00 TR (hafta içi). Detay: docs/operations/incident-runbook.md §destek.
İş Listesi
Hat A — e-Dönüşüm (einvoice)

□ Entegratör seçimi (sandbox, API kalitesi, fiyat, destek) ve sözleşme.
□ EDocumentPort arayüzü + ilk implementasyon (JSON/REST — SPEC §21.1; her metot idempotent: send aynı invoice.id ile ikinci kez çağrılırsa önceki sonucu döner).
□ Mükellef/alias sorgulama (önbellekli) ve fatura profili/tipi belirleme.
□ e-Fatura, e-Arşiv gönderimi, durum takibi, PDF/XML indirme (e-İrsaliye Faz 6).
□ Gelen kutusu → alış faturası taslağı, kabul/ret.
□ İptal/iade akışı (entegratör + mevzuat kuralları).
□ Hata ve yeniden deneme stratejisi.
□ Belirsiz sonuç: timeout sonrası körlemesine yeniden gönderim yasak; önce sağlayıcıda durum sorgusu (SPEC §21.2).
□ Şirket bazlı entegrasyon ayarı (şifreli kimlik bilgileri — AES-256-GCM).
□ Bağlantı testi ekranı.
□ Canlı test faturası kontrol listesi.
□ Tablolar: einvoice_outbox, einvoice_inbox, einvoice_documents, einvoice_status_events; orijinal belge + sağlayıcı cevabı arşivlenir (SPEC §21.3).
□ UBL-TR / XSD / Schematron doğrulaması entegratörün sorumluluğundadır; fast-xml-parser yalnızca entegratör payload'ını parse eder (SPEC §21).
□ XML dış varlıkları (XXE) ve tehlikeli dönüşümler engellenir.
Hat B — SaaS Ticari Altyapı (subscription)

□ Tablolar (SPEC §8.2 Faz 4 dağılımı): module_dependencies, subscriptions, subscription_items, subscription_changes, commercial_orders, commercial_order_items, billing_invoices, billing_invoice_lines, payment_attempts, billing_payments, billing_refunds, billing_allocations, provider_webhook_events, coupons, coupon_redemptions, partners, partner_referrals, partner_commissions.
□ Plan/fiyat yönetimi (Platform Paneli); paket sürümleme: müşteri satın aldığı fiyat/kapsam sürümüne bağlanır, sipariş üzerinde snapshot (SPEC §8.3).
□ Canlı fiyatlandırma sayfası.
□ Checkout akışı.
□ PaymentProvider arayüzü: iyzico abonelik + havale/EFT (manuel onay). Kart numarası/CVV uygulamada saklanmaz (SPEC §8.5).
□ Güvenli aktivasyon zinciri (SPEC §8.6):
text
Sipariş → Ödeme girişimi → Sağlayıcı/havale doğrulaması
   → Kalıcı ödeme kaydı → Fatura/alacak eşleştirme
   → Entitlement aktivasyonu → Audit + outbox
□ Tarayıcının başarı sayfasına yönlenmesi modül açmak için yeterli değil.
□ Webhook: imza doğrulama (ham içerikle), olay tekrarı engelleme, sağlayıcı işlem kimliği/tutar/para birimi/sipariş ilişkisi kontrolü (SPEC §20).
□ Abonelik/ödeme durumları ayrı: pending_activation | active | past_due | suspended | cancelled | expired ve pending | succeeded | failed | partially_refunded | refunded | disputed (SPEC §8.7).
□ Başarısız ödeme yeniden deneme ve dunning (bildirim → ek süre → ücretsiz plana düşme).
□ Abonelik yaşam döngüsü: yükselt, düşür (dönem sonunda), iptal, yeniden etkinleştir; ilk sürümde proration yok (SPEC §8.8).
□ Kupon, yıllık indirim, KDV'li fiyat gösterimi.
□ Platform faturası: her başarılı ödemede müşteriye e-Arşiv/e-Fatura (kendi entegratör hesabımız).
□ Platform faturalama detayları: işletmeci şirket bilgileri, fatura serisi, GİB kodu, KDV oranı docs/operations/platform-billing.md'de tutulur ve seed'e yansıtılır.
□ Gelir paneli: MRR, ARR, yeni/ayrılan, plan dağılımı, günlük platform_metrics_daily snapshot.
□ Gösterge tanımları ayrı (SPEC §8.9): Tahsilat ≠ Net nakit giriş ≠ Faturalanan tutar ≠ MRR ≠ ARR ≠ Alacak ≠ Dönüşüm ≠ Churn.
□ Yıllık ödeme, MRR hesabında aylara normalize edilir.
□ Ortak (mali müşavir) programı v1: referans linki, atıf, komisyon hakedişi kaydı (partners, partner_referrals, partner_commissions).
□ Platform tarafından şirket açma sihirbazı (satış ekibi).
□ SMS kredisi (opsiyonel eklenti; sms_credits, sms_messages).
□ Platform satış gelirleri tenantların satış faturalarından ayrı (SPEC §8.9).
□ İşletmeci şirketin resmi muhasebesi için ayrı işletmeci tenant (tenants.is_operator = TRUE, tek satır; idempotent aktarım — SPEC §8.9).
Kabul Kriterleri
□ Satış: Ücretsiz müşteri ücretli modül satın alabilir.
□ Ayrım: Müşterinin cari tahsilatı platform geliri sayılmaz.
□ Güvenlik: Tarayıcıdan başarı isteği göndererek modül açılamaz.
□ Devamlılık: Abonelik bitince ücretsiz haklar korunur.
□ Şeffaflık: Kullanıcı ücret, vergi, dönem ve kapsamı satın almadan görür.
□ Tekrarsızlık: Yinelenen webhook ikinci ödeme veya belge üretmez.
□ Belirsiz sonuç: Timeout sonrası körlemesine yeniden gönderim yapılmaz.
□ Doğrulama: Gerçek uçtan uca test ve sağlayıcı kabulü tamamlanır.
□ Arşiv: Belge, yanıt ve durum geçmişi erişilebilir.
□ Uçtan uca: Bir şirket kayıt olur → Fatura + e-Dönüşüm paketini kartla satın alır → ilk e-Arşiv faturasını gönderir → platform ona fatura keser → gelir paneli MRR'ı doğru gösterir.
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-4.1	Entegratör: hangi sağlayıcı?	K-07 kararı	—	K-07 onayı bekleniyor (kısa liste + sandbox testi)
T-4.2	Ödeme: iyzico mu, PayTR mi, Param mı?	iyzico abonelik desteği güçlü	PayTR/Param	iyzico (README §9 / SPEC §1.3 zaten iyzico diyor)
T-4.3	Havale ile manuel aktivasyon ilk sürümde şart mı?	Pilot satış için hızlı çözüm (SPEC §8.5)	Sadece kart	İkisi birden (havale öncelikli)
T-4.4	Dunning: kaç deneme, ne zaman?	—	—	3 deneme / 1, 3, 7. gün; sonra 7 gün ek süre
T-4.5	Proration (gün bazlı fark): MVP'de?	Karmaşık, geciktirir (SPEC §8.8)	Dönem sonuna ertele	Ertele (yalnızca dönem sonu değişim)
T-4.6	Kupon: yüzde mi, sabit mi?	İkisi de	—	İkisi de (kupon tipi enum)
T-4.7	Platform faturası: otomatik mi, manuel mi?	Otomatik ölçeklenir	Manuel başla	Otomatik (entegratör hazırsa)
T-4.8	MRR hesabı: taahhüt bazlı mı, tahsilat bazlı mı?	SPEC §8.9 tanımı	—	Taahhüt bazlı (yıllık → aylık normalizasyon)
Çıkış Kapısı (İlk Ücretli Satış)
□ Kabul kriterleri karşılandı.
□ Ödeme canlı testi tamamlandı (sandbox → canlı geçiş).
□ e-Dönüşüm canlı test faturası gönderildi.
□ Destek süreci tanımlandı (SLA, kanal, saatler).
□ Durum sayfası yayında.
□ Destek SLA dokümante edildi ve ilk müşterilere bildirildi.
□ İşletmeci şirket platform faturası canlıda kesildi (1 test müşterisine).
□ Kullanıcı onayı alındı.
FAZ 5 — Muhasebe
Süre: 8–10 hafta
Bağımlılıklar: Faz 4 tamamlanmış olmalı
İlgili SPEC: §15 (Muhasebe/Dönem), §10.5 (Denge)
İlgili README: §3.2 (Muhasebe çalışanı), §10 (TDHP)

Hedef
Muhasebe/finans uzmanının güvenle veri girebileceği derinliği sağlamak. SMMM golden test imzası.

Önkoşullar
□ Faz 4 çıkış kapısı geçildi.
□ SMMM danışman golden test senaryolarını hazırladı (Ek B).
□ Ön muhasebe → genel muhasebe geçiş kesim tarihi politikası onaylandı (K-11).
İş Listesi
□ Tablolar: fiscal_periods, accounting_accounts, journal_entries, journal_lines, posting_rules, account_mappings, period_locks (SPEC §15).
□ Tek Düzen Hesap Planı (TDHP) şablonu seed; şirket alt hesap ekler.
□ Hesap planı içe/dışa aktarma.
□ Hesap eşleme (posting rules) ekranı: satış, alış, KDV, kasa, banka, stok, maliyet hesapları.
□ Fiş girişi: mahsup, tahsil, tediye, açılış; grid ekranı, kısayol tuşları (Enter: yeni satır, F2: hesap ara, Ctrl+S: taslak, Ctrl+Enter: onayla — README §5.2).
□ Fiş şablonları.
□ Excel'den toplu giriş.
□ Ek belge (fişe dosya ekleme; attachments.entity_type allowlist'ine ADR ile ekleme).
□ Otomatik muhasebeleştirme: fatura, tahsilat/ödeme, stok maliyeti, kasa/banka hareketi.
□ Geriye dönük muhasebeleştirme (backfill): muhasebe modülü sonradan açılırsa önizleme + toplu fiş üretimi.
□ Dönem yönetimi: mali yıl, ay kilidi/kapatma, kapalı döneme kayıt engeli.
□ Onaylı fiş değişmezliği: düzeltme ters kayıt (SPEC §10.1).
□ Gap-free yevmiye madde numarası (SPEC §15).
□ Muhasebe dengesi: fiş kesinleşirken yerel para biriminde toplam borç = alacak; form doğrulamasına bırakılmaz — servis + transaction + DB kuralı (SPEC §10.5).
□ Kaynak ilişkisi: otomatik fiş ticari belgeye bağlı; tekrar üretim engellenir (SPEC §15).
□ Defterler ve raporlar: yevmiye, defter-i kebir, hesap ekstresi, mizan (dönem/kümülatif), bilanço, gelir tablosu; Excel/PDF.
□ Açılış fişi / devir.
□ Kapanış sihirbazı v1 (kontrol listesi + kapanış fişleri).
□ Mali Müşavir Paneli v1: çok firma, hızlı geçiş, firma bazlı bekleyen iş özeti (MALI_MUSAVIR rolü; varsayılan okuma + dışa aktarma — README §3.4).
□ Fiş onayı (maker-checker) — ayardan açılır.
□ Hesap kontrolü: hareketli hesap silinemez (SPEC §15).
□ Genel muhasebe devreye alınmadan önce kesim tarihi belirlenir; doğrulanmış açılış fişi ve açık kalem aktarımı (geçmişi sessizce yeniden muhasebeleştirmek yasak — SPEC §15).
Kabul Kriterleri
□ Denge: Her kesinleşmiş fiş dengeli.
□ Mutabakat: Cari alt hesap ile kontrol hesabı uyumlu.
□ Kaynak: Otomatik fiş kaynağına bağlı ve tekrarsız.
□ Geçiş: Önceki dönem verileri doğrulanmış açılışla devralınıyor.
□ SMMM Golden Test: SMMM danışman senaryoları imzaladı.
□ Pilot mutabakat: Bir pilot şirketin 1 aylık verisi, mevcut programdaki mizanla birebir mutabık.
□ Not: e-Defter, amortisman, resmi bordro ve ileri dönem sonu işlemleri bu fazın otomatik parçası değildir; ayrı kapsam onayı gerekir.
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-5.1	TDHP: tam mı, kısaltılmış mı?	Tam TDHP yaklaşık 2000+ hesap	Yaygın 500 hesap	Tam TDHP + arama
T-5.2	Posting rules: kullanıcı tanımlı mı, hazır mı?	Hazır + özelleştirilebilir	Sadece manuel	Hazır varsayılan + düzenlenebilir
T-5.3	Maker-checker zorunlu mu?	KOBİ'de genelde tek kişi	Opsiyonel (ayardan)	Opsiyonel, varsayılan kapalı
T-5.4	Backfill: hangi tarihe kadar?	Şirket kuruluşuna kadar	Sabit pencere	Şirket açılışından bugüne (K-11)
T-5.5	Kapanış sihirbazı: kaç adım?	—	—	5 adım: Mutabakat → Stok değerleme → Amortisman (manuel) → KDV → Kapanış fişi
T-5.6	Fiş numarası: şirket genelinde mi, dönem bazlı mı?	Dönem bazlı yaygın; gap-free zorunlu	Şirket geneli	Dönem bazlı
T-5.7	KDV: oran tablosu tarih aralıklı mı?	Mevzuat değişir	Sabit tablo	Tarih aralıklı + kesinleşmiş belgede oran snapshot (SPEC §9.3)
Çıkış Kapısı (GA — Genel Yayın)
□ Kabul kriterleri karşılandı.
□ SMMM golden test imzası alındı.
□ Güvenlik taraması (SAST/DAST) tamamlandı.
□ Yük testi yapıldı (p95 hedefleri karşılandı — SPEC §30.2).
□ Olay müdahale prosedürü yazılı.
□ RPO/RTO ölçüm tatbikatı tamamlandı; docs/operations/restore-drill-YYYYMMDD.md raporu arşivlendi; ölçülen değerler hedefi karşılıyor (RPO ≤ 1s, RTO ≤ 4s).
□ Test coverage raporu: genel ≥ %75, kritik alanlar ≥ %95.
□ Erişilebilirlik denetimi: axe-core tam suite yeşil; manuel klavye testi raporlandı.
□ Kullanıcı onayı alındı.
FAZ 6 — İleri Finans
Süre: 6–8 hafta
Bağımlılıklar: Faz 5 tamamlanmış olmalı (Faz 7 ile paralel yürütülebilir)
İlgili SPEC: §9 (Kur), §13, §15, §21

Hedef
Muhasebe derinliğini tamamlayıp üst pakete değer katmak.

İş Listesi
□ Çek / Senet (cheque): cheques, cheque_transactions, cheque_portfolio — portföy, ciro, tahsil, karşılıksız, vade takvimi, durum geçmişi + muhasebe kaydı.
□ Döviz: TCMB kur içe aktarma (exchange_rates — SPEC §9.2), kur farkı, dönem sonu değerleme.
□ Çoklu para birimi (Faz 3'ten ertelenen — K-05): belge düzeyinde çok para birimi ve kur; UI + iş akışı tam aktif.
□ KDV hazırlık raporu (hesaplanan/indirilecek/devreden, tevkifat, istisna) + belge–defter mutabakatı.
□ Ba-Bs raporu, cari mutabakat mektubu.
□ e-İrsaliye (entegratör adapter'ı üzerinden).
□ e-Defter: yevmiye/kebir XML üretimi, berat süreci (EDefterProvider port'u).
□ Sabit kıymet ve amortisman (basit).
□ Maliyet merkezi / proje etiketi (opsiyonel boyut).
□ Vade bazlı nakit akış tahmini, gelişmiş yaşlandırma (reports_plus).
□ Banka ekstre eşleştirmede kural öğrenme (kullanıcı onaylı).
Kabul Kriterleri
□ e-Defter: XML şema doğrulaması geçiyor.
□ KDV raporu ile defter mutabakatı.
□ Çek/senet muhasebe kaydı mizanla uyumlu.
□ Çoklu para birimi: dövizli fatura, kur tarihi, belge toplamı TL karşılığı doğru.
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-6.1	e-Defter: kendi mi, saklayıcı mı?	Saklayıcı zorunlu olabilir	Kendi	Saklayıcı entegratörü
T-6.2	Kur farkı: günlük mü, dönem sonu mu?	Dönem sonu standart	Günlük (karmaşık)	Dönem sonu
T-6.3	Amortisman: yasal mı, yönetimsel mi?	Yasal (VUK) esas	İkisi	VUK + isteğe bağlı yönetimsel
T-6.4	Ba-Bs: hangi eşik?	Mevzuat (5000 TL)	—	Mevzuat eşiği (tarih aralıklı parametre)
Çıkış Kapısı
□ Kabul kriterleri karşılandı.
□ Kullanıcı onayı alındı.
FAZ 7 — Yönetim Paketi ve Patron Deneyimi
Süre: 6–8 hafta
Bağımlılıklar: Faz 5 tamamlanmış olmalı (Faz 6 ile paralel yürütülebilir)
İlgili SPEC: §16 (Görev/Takvim/Randevu), §17 (Bildirim), §19 (Queue/Outbox), §26 (Yönetici Çekirdek), §31 (ERP Entegrasyonu)
İlgili README: §5.1 (Patron Görünümü)

Hedef
Kayıt sistemini günlük aksiyon sistemine dönüştürmek.

İş Listesi
□ Görev (management.task.*): tasks tablosu, oluştur/ata/öncelik/durum/son tarih/alt görev/etiket/dosya/not/yorum/mention/geçmiş. Durumlar: todo | in_progress | waiting | completed | cancelled (SPEC §16.1).
□ Tekrarlayan görevler: günlük/haftalık/aylık/yıllık/özel RRULE.
□ Hatırlatıcı (reminders): push/in-app/email/WhatsApp/SMS kanalları, sessiz saatler, ertele, tamamlandı işaretle (SPEC §16.2).
□ Takvim (calendars, calendar_events): kişisel/şirket/personel; paylaşım; görünürlük izinleri; renkler; tekrarda IANA timezone ayrı kolon (SPEC §16.3, §16.4).
□ Etkinlik: başlangıç/bitiş, tüm gün, konum, açıklama, katılımcılar, ilgili müşteri/görev/belge.
□ Randevu (appointments): talep/onay/iptal/no-show/tamamlandı/hatırlatma/geçmiş (pending | confirmed | completed | cancelled | no_show).
□ Çakışma kontrolü (ayardan), çalışma saatleri, tatil günleri.
□ Randevu linki (müşteri tarafından randevu alma — Faz 8'e taşınabilir).
□ Notlar ve aktiviteler (notes, activities; activities ≠ audit_logs — SPEC §16.5).
□ Bildirim Platformu: notifications, user_devices, notification_deliveries, notification_preferences (SPEC §17); türler merkezi notification_type enum'una bağlı (serbest string yok).
Push: FCM (Android) + APNs (iOS) + Web Push (PWA).

Delivery tracking, retry, dead-letter.

Görev tamamlandı ≠ hatırlatıcı tetiklendi ≠ bildirim teslim edildi: üç ayrı olay, üç ayrı kayıt (SPEC §17.2).

□ Onay kutusu: ödeme limiti, fatura iptali, fiş onayı.
□ Günlük özet e-postası (sabah 08:00) ve haftalık özet.
□ Kural bazlı uyarılar: vadesi geçen alacak, kritik stok, olağandışı gider, çek vadesi.
□ Vergi/SGK takvimi (şirket türüne göre).
□ Web Push (PWA), bildirim tercihleri ve sessiz saatler.
□ Kayıtlı rapor ve zamanlanmış rapor e-postası.
□ Patron Görünümü v3: trafik ışığı göstergeleri (yapay "sağlık skoru" yok — kural bazlı, SPEC §26).
□ Dashboard verileri ana iş tablolarından sorgulanır; gereksiz şekilde tekrar veri tutulmaz; performans ihtiyacında cache/view/materialized view (SPEC §26, §32).
□ Outbox + BullMQ devrede (SPEC §19): retry, dead-letter, idempotent job, monitoring.
□ Context-aware quick actions (Faz 7: Müşteri → [+Görev] [+Randevu] — SPEC §24).
Kabul Kriterleri
□ Anlaşılırlık: Yönetici günün önemli konularını ~30 saniyede anlayabilir.
□ Aksiyon: Uyarıdan ilgili kayıt ve işleme ulaşabilir.
□ Güvenlik: Dashboard da kayıt kapsamı yetkilerine uyar.
□ Tutarlılık: Dashboard tutarı ile ayrıntı listesi aynı kuralları kullanır.
□ Queue: Outbox commit sonrası Redis hatası iş kaybına yol açmaz.
□ Idempotency: Aynı olay iki kez işlense de tek sonuç üretir.
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-7.1	Hatırlatıcı: kaç dakika önce varsayılan?	—	—	15 dk, 1 saat, 1 gün (üç varsayılan)
T-7.2	Sessiz saatler varsayılanı	—	—	22:00–08:00
T-7.3	Günlük özet saati	—	—	08:00 (tenant timezone)
T-7.4	Push sağlayıcı: FCM + APNs mı, OneSignal mı?	Native kontrol için FCM/APNs	OneSignal	FCM + APNs (self-managed)
T-7.5	Kural motoru: kod mu, DB kuralı mı?	DB kuralı esnek ama karmaşık	Kod	Kod (hazır kurallar) + DB (parametreler)
T-7.6	Dashboard: gerçek zamanlı mı, cache mi?	p95 <1s için cache şart	Real-time	Materialized view + 5 dk refresh
T-7.7	Randevu linki (müşteri tarafı) MVP'de mi?	Faz 8'e ertelemek makul	Ertele	Faz 8'e ertele
Çıkış Kapısı
□ Kabul kriterleri karşılandı.
□ Kullanıcı onayı alındı.
FAZ 8 — Entegrasyonlar ve Büyüme
Süre: Sürekli
Bağımlılıklar: Faz 7 tamamlanmış olmalı
İlgili SPEC: §18 (WhatsApp — Faz 8, ilk sürüm sözleşmesi değildir), §20 (Webhook), §22 (API)

Hedef
Kanıtlanmış talepleri karşılamak ve büyümeyi hızlandırmak.

İş Listesi
□ Pazaryeri / e-ticaret: sipariş → fatura → stok.
□ Banka entegrasyonları (ekstre otomasyonu, açık bankacılık).
□ WhatsApp (integrations modülü — SPEC §18): integrations, whatsapp_accounts, whatsapp_conversations, whatsapp_messages, message_status_events.
Mesaj tipleri: text/image/document/video/audio/location/template/interactive.

Durum takibi (queued/sent/delivered/read/failed).

external_message_id unique/idempotent.

Mesaj durum olayları sırasız gelebilir; read olmuş mesaj geç gelen sent ile geriye düşmez.

Erişim tokenları düz metin tutulmaz (AES-256-GCM).

Hazır cevaplar, şablon yönetimi, müşteri etiketleri, konuşmayı personele atama, iç not, otomatik görev.

Tetikleyici: Ücretli müşterilerin ≥ %20'si talep ederse (§6).

□ Müşteri portalı v0: ekstre/fatura paylaşım linki (giriş gerektirmeyen, süreli).
□ Public API: API anahtarları, OAuth2, rate limit, webhook abonelikleri, dokümantasyon, versiyonlama (OpenAPI Zod'dan otomatik üretilir — ADR-0013).
□ Randevu ve sektör paketleri (hizmet işletmeleri).
□ Personel avans/maaş kaydı (bordro programından fiş içe aktarma; bordro hesaplama kapsam dışı).
□ Çok şube (branches desteği veri modelinde hazır).
□ Webhook altyapısı: webhook_events, integration_credentials, external_mappings (SPEC §20).
Gövde boyutu sınırı, imza doğrulama ham içerikle, tenant doğrulanmış sağlayıcı hesabından çözülür.

Olay kalıcı ve benzersiz kaydedilir (UNIQUE (integration_id, external_event_id)); hızlı cevap; worker iş etkisini uygular.

Kabul Kriterleri
□ Public API: rate limit ve OAuth2 çalışıyor.
□ WhatsApp: aynı olay iki mesaj kaydı oluşturmaz.
□ Müşteri portalı: bir müşteri başka müşterinin belgesini göremez.
□ Webhook: imza doğrulama, idempotency, retry.
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-8.1	Public API auth: API key mi, OAuth2 mi, ikisi?	İkisi de yaygın	Biri	İkisi (basit için key, kurumsal için OAuth2)
T-8.2	WhatsApp sağlayıcı: Meta direkt mi, BSP mi?	Meta direkt onay süreci zor	BSP (kolay)	Meta direkt (uzun vade)
T-8.3	Müşteri portalı: link mi, login mi?	Link (girişsiz) hızlı	Login	Link v0 → login v1
T-8.4	E-ticaret: hangi platform önce?	Pilot müşterilere bağlı	—	Trendyol (en yaygın)
Çıkış Kapısı
□ Her entegrasyon kendi tetikleyicisine bağlı.
□ Kullanıcı onayı alındı.
FAZ 9 — Koşullu: Native Mobil, Offline, AI, Otomasyon
Süre: Tetikleyiciye bağlı
Bağımlılıklar: Faz 8 ve tetikleyici sağlanmış olmalı

"Şimdi değil" demek "asla" demek değildir; ama her ertelenen madde için geri dönüş koşulu yazılıdır (§6).

İş Listesi (yalnızca tetikleyici sağlanırsa)
□ Flutter native mobil: PWA kısıtı (kamera/push/biyometri) nedeniyle somut müşteri kaybı veya yoğun talep. apps/mobile/ bu fazda açılır (GOVERNANCE §6); token saklama Keystore/Keychain (SPEC §25.1); ikili floating-point kullanılmaz (SPEC §9.1).
□ Offline-first senkronizasyon: saha satışı gibi güçlü talep; ücretli müşterilerin anlamlı kısmı. Çakışma yönetimi client_operation_id + base_version (SPEC §25.3). Sessiz client wins yasak; silme tombstone ile.
□ Yapay zekâ: Faz 6 sonrası ≥ 6 ay veri + net kullanım senaryosu.
AI doğrudan finansal kayıt değiştiremez. Önce AI önerisi → kullanıcı onayı → transaction.

Doğal dil ile arama, görev oluşturma, rapor özeti, müşteri özetleme, WhatsApp konuşma özeti.

Tenant ve kullanıcı yetkilerini devralır.

□ Workflow motoru: ≥ 10 farklı özel kural talebi.
□ Marketplace / plugin: Public API oturup 3. taraf talebi gelince.
□ SSO / Enterprise tenancy: kurumsal müşteri sözleşmesi.
□ Bordro hesaplama: bordro yazılımlarından fiş içe aktarma yetersiz kalırsa.
□ Kendi GİB bağlantısı (özel entegratörlük): entegratör maliyeti marjı kalıcı bozarsa.
□ Mikroservis: ölçek veya ekip bağımsızlığı kanıtlanırsa.
□ Socket.IO / canlı güncelleme: gerçek zamanlı iş birliği ihtiyacı.
Kabul Kriterleri
□ Her madde için tetikleyici yazılı olarak kanıtlandı.
□ AI tenant ve kullanıcı yetkilerini devralıyor; onaysız finansal kesinleştirme yapamıyor.
□ Offline senkronizasyon: client_operation_id ile idempotent.
🤖 AI Ajanı için Tavsiyeler (Onay Gerekli)
#	Tavsiye	Gerekçe	Alternatif	Ajan Önerisi
T-9.1	Hangi ertelenen madde önce?	Tetikleyiciye bağlı	—	Veriye göre karar
T-9.2	AI sağlayıcı: OpenAI mı, yerel mi?	KVKK için yerel önemli	OpenAI (kolay)	KVKK uyumlu AB/TR barındırma
T-9.3	Flutter mı, React Native mi?	README/SPEC Flutter der (GOVERNANCE §6)	RN	Flutter (doküman uyumu)
Çıkış Kapısı
□ Her madde kendi tetikleyicisiyle başlar.
□ Kullanıcı onayı alındı.
5. Modül × Faz × Paket Matrisi
Modül kodlarının tek doğruluk kaynağı GOVERNANCE §2'dir; bu tablo yalnızca faz ve paket açısından özetler (README §4 ile uyumlu).

Modül	Kod	Faz	Paket
Çekirdek (kimlik, şirket, rol, denetim, legal_texts)	core	1	Her zaman açık
Platform yönetimi	platform	1	Altyapı (satılmaz)
Cari Hesap	contacts	2	Ücretsiz (limitli) → sınırsız
Stok	stock	2	Ücretsiz (limitli) → sınırsız
İçe/dışa aktarma	core	2	Tümü
Fatura & Belgeler (gider dahil)	trade	3	Ücretli
Kasa & Banka	cashbank	3	Ücretli
e-Dönüşüm	einvoice	4	Eklenti
Abonelik / faturalama / ortak programı	subscription	4	Altyapı
SMS Kredisi	sms	4	Eklenti (kullandıkça öde)
Muhasebe	accounting	5	Ücretli
Mali Müşavir Paneli (çok firma UI)	accounting	5	Mali müşavirlere ücretsiz
Çek/Senet	cheque	6	Ücretli
Gelişmiş Raporlar	reports_plus	6	Ücretli
Yönetim Paketi	management	7	Ücretli
Entegrasyonlar (WhatsApp dahil)	integrations	8	Eklenti / Kurumsal
Paket adları, fiyatlar ve limitler karar bekliyor (K-02, K-03).

6. Ertelenenler ve Geri Dönüş Tetikleyicileri
Ertelenen	Neden şimdi değil	Geri dönüş tetikleyicisi
Flutter native mobil	PWA ile başlanabilir; ikinci kod tabanı maliyeti	PWA kısıtı nedeniyle somut müşteri kaybı veya yoğun talep
Offline-first senkron	Muhasebe verisinde çakışma riski yüksek	Saha satışı gibi güçlü talep; ücretli müşterilerin anlamlı kısmı
WhatsApp	Meta onay/maliyet; çekirdek değer değil	Ücretli müşterilerin ≥ %20'si talep ederse
Yapay zekâ	Önce temiz, bol veri ve kullanım	Faz 6 sonrası ≥ 6 ay veri + net senaryo
Workflow motoru	Kural bazlı uyarılar çoğu ihtiyacı karşılar	≥ 10 farklı özel kural talebi
Marketplace / plugin	Ürün–pazar uyumundan önce erken	Public API oturup 3. taraf talebi
SSO / Enterprise tenancy	Küçük işletme hedefi	Kurumsal müşteri sözleşmesi
Bordro hesaplama	SGK/vergi mevzuatı çok karmaşık	Bordro yazılımlarından fiş içe aktarma yetersiz kalırsa
Kendi GİB bağlantısı	Büyük yatırım ve sertifikasyon	Entegratör maliyeti marjı kalıcı bozarsa
Mikroservis	Gereksiz operasyon yükü	Ölçek veya ekip bağımsızlığı
Socket.IO / canlı güncelleme	Polling yeterli	Gerçek zamanlı iş birliği ihtiyacı
Proration (gün bazlı fark)	Karmaşık; dönem sonu değişim yeterli	Müşteri talebi + marj ihtiyacı
Randevu linki (müşteri tarafı)	Faz 8'de yeterli	Randevu modülü kullanım verisi
Website builder / custom domain	İlk sürümde değer kanıtı yok	Ayrı ADR ile geri gelir (SPEC §6.9)
Çoklu para birimi (UI/iş akışı)	Faz 3'te yalnızca şema + exchange_rates; UI/iş Faz 6'da (K-05)	K-05 kapalı: Faz 6
7. Önceliklendirme
Öncelik	Kapsam
P0 — Olmazsa olmaz	Kimlik, şirket, rol/yetki, paket (entitlement) motoru, RLS izolasyonu, denetim izi, Cari, Stok, içe aktarma
P1 — Gelir	Fatura, tahsilat/ödeme, kasa/banka, e-Dönüşüm, abonelik/ödeme, platform faturası, gelir paneli
P2 — Derinlik	Muhasebe, Mali Müşavir Paneli, çek/senet, döviz, KDV/Ba-Bs, e-Defter
P3 — Elde tutma	Yönetim paketi, günlük özet, onay akışı, kural bazlı uyarılar
P4 — Büyüme	Entegrasyonlar, public API, müşteri portalı v0
P5 — Koşullu	§6'daki ertelenenler
8. Sürüm Modeli ve Kalite Kapıları
8.1. Sürüm Aşamaları
Aşama	Anlamı	Kapı
Alpha	İç kullanım, sahte veri	CI yeşil, izolasyon testi yeşil
Beta (Faz 2 sonu)	Pilot şirketler, gerçek veri, ücretsiz	Yedek-geri yükleme tatbikatı, yasal metinler yayında, hata izleme açık, axe-core + Lighthouse CI
Ticari Beta (Faz 4 sonu)	İlk ücretli müşteriler	Ödeme canlı testi, e-Dönüşüm canlı test faturası, destek süreci, durum sayfası, işletmeci şirket kurulumu
GA (Faz 5 sonu)	Herkese açık satış	SMMM golden test imzası, güvenlik taraması, yük testi, olay müdahale prosedürü, RPO/RTO tatbikatı, coverage eşiği
Preview environment: Her PR için apps/web ve apps/site otomatik preview deploy alır (Cloudflare Pages preview). API/worker preview yoktur; merge sonrası staging'e gider.

8.2. Definition of Done (Zorunlu)
Bir özellik ancak aşağıdakiler tamamlandığında kabul edilir (SPEC §30.5):

□ İş kuralı ve kabul senaryoları.
□ Migration ve veri kısıtları.
□ Validation ve API sözleşmesi.
□ Permission, entitlement ve tenant izolasyonu.
□ Arayüz, boş durum ve hata durumları.
□ Audit ve gerekli metrikler.
□ Otomatik testler (unit + integration + e2e).
□ Dokümantasyon.
□ Staging doğrulaması.
□ Güvenli dağıtım ve geri dönüş yaklaşımı.
□ SOLID/DRY uyumu.
□ Test coverage: genel ≥ %75, kritik alanlar ≥ %95 (CI zorunlu).
□ axe-core (a11y) CI yeşil.
□ Bundle-size CI yeşil (initial < 250 KB gzip).
□ OpenAPI güncel (Zod'dan üretildi, commit'lendi).
□ İlgili referans dokümanlar güncellendi (permissions-catalog, error-codes, screens, i18n, email-templates).
8.3. Kod İnceleme Kalite Kapısı
Pull Request öncesi kontrol (SPEC §30.4):

□ SOLID prensipleri ihlal edilmiş mi?
□ Aynı iş kuralı tekrar edilmiş mi?
□ Domain sınırı delinmiş mi?
□ Controller gereğinden fazla büyümüş mü?
□ Service birden fazla sorumluluk üstlenmiş mi?
□ Harici servis doğrudan business logic'e bağlanmış mı?
□ Ortak bileşen/utility varken yeni kopya oluşturulmuş mu?
□ Testler yazılmış mı?
□ Tenant izolasyonu korunuyor mu?
□ Loglara gizli veri sızıyor mu?
8.4. Mimari Kalite Kriteri
text
Fonksiyonel olarak çalışıyor
        +
SOLID uyumlu
        +
DRY uyumlu
        +
Test edilebilir / test edilmiş
        =
Kabul edilebilir geliştirme
9. Riskler
Risk	Etki	Önlem
Yanlış muhasebe kaydı	Müşteri güveni, hukuki	SMMM danışman, golden testler, kayıt değişmezliği, ters kayıt
e-Dönüşüm entegratör bağımlılığı	Gelir akışı	Adapter arayüzü (EDocumentPort), ikinci entegratör için hazırlık, sözleşmede çıkış maddesi
Tenant verisi sızıntısı	Kritik	RLS + ayrı DB rolleri + zorunlu izolasyon testi + sızma testi
Platform kullanıcısının yetkisiz tenant erişimi	Kritik	support_access_grants (gerekçe + süre), her kullanım audit'li (SPEC §5.1)
Ücretsiz kullanıcı maliyeti / kötüye kullanım	Marj	Limitler, CAPTCHA, hız sınırı, pasif şirket arşivleme
Manual onboarding darboğazı	Kayıt → aktivasyon gecikmesi	Başvuru inceleme SLA'sı; beta verisiyle hybrid geçişi ADR ile (GOVERNANCE §5)
Kapsam kayması (WhatsApp, AI cazibesi)	Gecikme	§6 disiplini, tetikleyici ölçütler
Mevzuat değişimi	Uyumsuzluk	Tarih aralıklı oran/kod tabloları, izleme listesi
Abonelik/ödeme karmaşıklığı	Hata, tahsilat kaybı	Başta sabit paketler, idempotent webhook, dunning testleri
KVKK uyumsuzluğu	Ceza, itibar	DPA, aydınlatma, alt işleyen listesi, ihlal prosedürü, saklama/imha politikası (SPEC §27.2, §27.5)
Tek kişiye bağımlılık	Süreklilik	ADR, dokümantasyon, kod inceleme
Performans (büyük hareket tabloları)	Yavaşlık	Bileşik indeksler, özet tablolar, ağır raporlar kuyrukta
FLOAT/DOUBLE sızması	Finansal hata	Migration taraması, CI kuralı, kod inceleme
Belge numarası çakışması	Hukuki/yasal	Kilitli sayaç (MAX+1 yasak — SPEC §12.3)
Frontend bundle şişmesi	Yavaşlık, mobil kullanıcı kaybı	Bundle-size CI eşiği, code-split, route lazy load
Erişilebilirlik ihlali	Kurumsal müşteri kaybı	axe-core CI, klavye testi, WCAG 2.1 AA dokümantasyonu
Yedek kurtarma başarısızlığı	Veri kaybı	6 aylık tatbikat zorunlu, platform_owner onayı, farklı bölge replikasyonu
Secrets sızması	Kritik güvenlik	SOPS + .env (Faz 0–3), Doppler/AWS SM (Faz 4+), rotasyon planı
Marka/ürün adı belirsizliği	Metin/e-posta/domain gecikmesi	docs/brand.md Faz 0'da doldurulur
10. Açık Kararlar
Faz 0'ın ilk haftasında kapatılması önerilir. En kritik olanlar:

#	Karar	Varsayılan Öneri	Durum
K-01	Hedef kitle önceliği: KOBİ patronu mu, mali müşavir ofisi mi, ikisi mi?	KOBİ patronu önce, mali müşavir Faz 5'te	Açık
K-02	Ücretsiz paket içeriği ve limitleri	Cari: 100 kayıt / Stok: 100 ürün / 1 kullanıcı + 1 davet (SPEC §14.3 ile uyumlu)	Açık
K-03	Fiyatlandırma modeli: sabit paketler mi, modül bazlı mı?	Sabit paketler + modül eklentileri	Açık
K-04	Onboarding modu	manual (bağlayıcı — GOVERNANCE §5); beta sonrası hybrid ADR ile	Kapalı (varsayılan belli)
K-05	Çoklu para birimi MVP'de mi?	Faz 6'ya ertele	Kapalı (T-3.1)
K-06	Belge numaralandırma formatı	SERI-YIL-SIRA	Açık
K-07	e-Dönüşüm entegratörü	Kısa liste + sandbox testi sonrası karar	Açık
K-08	Ödeme sağlayıcısı	iyzico	Açık
K-09	Ekip büyüklüğü ve takvim	3 geliştirici + yarı zamanlı tasarımcı + SMMM danışman	Açık
K-10	Modül kodları ile permission öneki uyumu	Çözüldü: tek kaynak GOVERNANCE §2 (ADR-0006, ADR-0007)	Kapalı
K-11	Ön muhasebe → genel muhasebe kesim tarihi politikası	Şirket açılışından bugüne backfill (doğrulanmış açılış fişiyle)	Açık
K-12	Hosting konumu	Türkiye (KVKK + latency); apps/site Cloudflare Pages	**Kapalı (8 Eki 2026 — kullanıcı kararı: TR)**
K-13	Lisans	Özel/ticari (MIT değil)	Kapalı (README v4.1.0)
K-14	TR/EN dil desteği	Sadece TR başlangıç; i18n altyapısı hazır (vue-i18n + docs/product/i18n.md)	Açık
K-15	Platform yönetimi modeli	Kapandı (ADR-0003)	platform_owner + roller + support_access_grants
K-16	Mobil stratejisi	Kapandı (ADR-0005)	PWA-first; Flutter Faz 9 koşullu
K-17	Gider modeli	Kapandı (ADR-0008)	Ayrı expenses tablosu
K-18	Site teknolojisi	Kapandı (ADR-0012)	Astro (statik) + Cloudflare Pages; apps/web Vue 3 + Vite
K-19	OpenAPI üretimi	Kapandı (ADR-0013)	Zod'dan otomatik üretim; tek kaynak Zod
K-20	legal_texts / legal_acceptances kapsamı	Kapandı (ADR-0011)	İkisi de global; tenant_id yok
11. Eski Yol Haritaları → Bu Sürüm Eşlemesi
| Kaynak | Karşılık |
|--------
| ROADMAP.md v3.0 Faz 0–9 | Bu sürüm Faz 0–9 |
| ROADMAP - astra.md Faz 0 (proje inceleme) | Bu sürüm Faz 0 envanter işleri |
| ROADMAP - astra.md Kabul kriterleri | Bu sürüm her fazın "Kabul Kriterleri" bölümü |
| ROADMAP - astra.md Sürüm kapıları | Bu sürüm §8.1 |
| ROADMAP - astra.md Faz bazlı kontroller | Bu sürüm §8.2 (DoD) |
| ROADMAP - astra.md Başarı ölçümü | Bu sürüm §2 |
| ROADMAP gpt.md Faz 0–26 | Bu sürümün fazlarına dağıtıldı |
| ROADMAP gpt.md UI mockup'ları | README §5 referansı |
| ROADMAP gpt.md Mimari değişmezler | TECHNICAL_SPEC §34 ile birebir uyumlu |
| ROADMAP gpt.md Teknik borç kuralı | Bu sürüm §0.2 (Tamamlanma Zinciri) |
| ROADMAP gpt.md P0–P3 önceliklendirme | Bu sürüm §7 (P0–P5) |
| ROADMAP deep.md v4.0.0-birleşik | Bu sürümün doğrudan temeli; v5.0.0 uyum düzeltmeleri üstteki "Ne Değişti?" tablosunda |
| ROADMAP deep.md v4.1.0 çelişki düzeltmeleri | v5.1.0'a işlendi; tam log: `docs/archive/ROADMAP-v4-conflict-log.md` |

---

## 12. Ekler

### Ek A — Terimler Sözlüğü

| Terim | Anlam |
|-------|-------|
| Tenant | Bir yasal işletmeyi temsil eden, veri izolasyonu birimi |
| Entitlement | Tenant'ın belirli bir modül/feature/limiti kullanma hakkı |
| Permission | Kullanıcının belirli bir işlemi yapabilme yetkisi |
| Scope | Permission'ın kayıt kümesi sınırı (`all`, `own_branch`, …) |
| RLS | PostgreSQL Row-Level Security |
| Outbox | İş transaction'ı ile aynı anda yazılan, dış etkileri kuyruğa aktaran tablo |
| Idempotency | Aynı isteğin tekrarında ikinci kayıt oluşturmama |
| Golden Test | SMMM tarafından imzalanan referans muhasebe senaryoları |
| SMMM | Serbest Muhasebeci Mali Müşavir |
| TDHP | Tek Düzen Hesap Planı |
| UBL-TR | Türkiye e-Fatura XML standardı (doğrulaması entegratörün sorumluluğunda) |
| ADR | Architecture Decision Record (`docs/adr/`) |
| PWA | Progressive Web App |
| DPA | Data Processing Agreement (Veri İşleme Sözleşmesi) |
| WCAG | Web Content Accessibility Guidelines (erişilebilirlik standardı) |

### Ek B — Golden Test Envanteri (Başlangıç)

SMMM danışmanla imzalanacak senaryolar:

**Cari & Tahsilat**

- [ ] Açılış bakiyeli cari kart + kısmi tahsilat + kalan bakiye.
- [ ] Çoktan-çoğa mahsup (1 tahsilat → 3 fatura).
- [ ] Fazla ödeme → avans → sonraki faturaya mahsup.
- [ ] İade + ters kayıt.

**Fatura & Vergi**

- [ ] Tek ürünlü fatura, %20 KDV.
- [ ] Çok satırlı fatura, farklı KDV oranları.
- [ ] İskonto (satır + belge düzeyi).
- [ ] Tevkifat (ör. 2/10).
- [ ] İstisna.
- [ ] Yuvarlama (0.005 → 0.01).
- [ ] Dövizli fatura (kur tarihi + belge toplamı TL) — Faz 6.

**Muhasebe**

- [ ] Otomatik fiş: fatura → 120/600/391.
- [ ] Otomatik fiş: tahsilat → 100/120.
- [ ] Dönem sonu mizan eşitliği.
- [ ] Kapanış fişi (gelir/gider hesapları → 690 → 692 → 580).

**Stok & Maliyet**

- [ ] Hareketli ortalama: 2 giriş + 1 çıkış.
- [ ] Sayım farkı → maliyet etkisi.
- [ ] Negatif stok blokaj testi.

### Ek C — Faz Kabul Kontrol Listesi (Şablon)

Her faz için kullanılır:

```markdown
## Faz N — [Başlık] Kabul Kontrol Listesi

### Fonksiyonel
- [ ] Tüm iş listesi tamamlandı.
- [ ] Kabul kriterleri test raporuyla kanıtlandı.

### Teknik
- [ ] Migration'lar staging'e uygulandı (down SQL'ler mevcut).
- [ ] RLS testleri yeşil.
- [ ] Permission testleri yeşil.
- [ ] Entitlement testleri yeşil.
- [ ] p95 hedefleri karşılandı (yük testi).
- [ ] Audit kayıtları yazılıyor.
- [ ] Frontend bundle-size eşiği altında.
- [ ] OpenAPI güncel (Zod'dan üretildi).

### Güvenlik
- [ ] Tenant izolasyon testi yeşil.
- [ ] Hassas veri loglarda yok.
- [ ] Bağımlılık taraması temiz.

### Kalite
- [ ] SOLID/DRY kontrolü yapıldı.
- [ ] Test coverage eşiği aşıldı (genel %75, kritik %95).
- [ ] axe-core (a11y) CI yeşil.
- [ ] Dokümantasyon güncel.
- [ ] ADR'ler yazıldı.

### İşletim
- [ ] Yedek alındı.
- [ ] Rollback planı hazır.
- [ ] Monitoring ve alerting devrede.

### Onay
- [ ] Kullanıcı onayı alındı.
Ek D — Doküman Uyum Haritası
Bu roadmap'in diğer dokümanlarla bağlantı noktaları (hızlı çapraz kontrol için):

Bu doküman	README	TECHNICAL_SPEC	GOVERNANCE
§0.1 Okuma sırası	Başlık bloğu	Başlık bloğu	§1
§0.1 Okuma sırası (yeni referanslar)	§16	§6.5, §22.2	§2
§1.3 Karşılaştırma (satır 3–4)	§4.3, §6.1	§4.3, §5.1	§4, §5
§3 Faz özeti	§4 (Faz kolonu)	§8.2, §16/17/18 damgaları	§2 (Faz kolonu)
Faz 0	§9, §12, §13	§0, §1, §3, §29, §30	§2, §3, §7
Faz 1	§4, §6, §7	§4, §5, §6, §7, §8	§2, §4, §5
Faz 2	§4, §5	§11, §14, §23, §24, §25	§2
Faz 2 (Astro site)	§9, §13	§1.2, §1.3	§6a
Faz 3	§4.1, §5.2	§9, §10, §12, §13	§2, ADR-0008
Faz 4	§7, §10	§8, §20, §21	§2
Faz 4 (platform-billing)	§7	§8.9, §30.7	§4
Faz 5	§3.2, §10	§15, §10.5	§2
Faz 6	—	§9, §13, §15, §21	§2
Faz 7	§5.1	§16, §17, §19, §26, §31	§2
Faz 8	—	§18, §20, §22	§2
Faz 9	§9 (Mobil)	§25.3, §9.1	§6
§5 Modül matrisi	§4	§2	§2 (tek kaynak)
§8 Kalite kapıları	§2 (ilke 8)	§30	—
§8 DoD (coverage)	—	§30.5	—
§10 K-18/K-19/K-20	§16	—	§6a, §6b, §2
§11 v4.1.0 çelişki logu	—	—	§7 (arşiv)
13. Bu Roadmap'in Özeti (Tek Sayfa)
text
FAZ 0  → İskelet + CI + RLS testi + GOVERNANCE kuralı  (2–3 hf)
FAZ 1  → Kimlik + Tenant + Yetki + Paket + legal_texts (5–6 hf)
FAZ 2  → Ücretsiz Cari + Stok + Astro Site + PWA       (6–8 hf)  ← GENEL BETA
FAZ 3  → Fatura + Kasa/Banka + Gider (yalnız TRY)      (6–8 hf)
FAZ 4  → e-Dönüşüm + SaaS + İlk Satış + Platform fatura(6–8 hf)  ← İLK GELİR
FAZ 5  → Muhasebe + SMMM Golden Test + RPO tatbikatı   (8–10 hf) ← GA
FAZ 6  → Çoklu PB + Çek/Senet + Döviz + KDV + e-Defter (6–8 hf)  ┐ paralel
FAZ 7  → Yönetim Paketi + Patron Deneyimi              (6–8 hf)  ┘
FAZ 8  → Entegrasyonlar + Public API + WhatsApp        (sürekli)
FAZ 9  → Native Mobil + AI + Otomasyon                 (tetikleyiciye bağlı)

İlk ücretli satıra kadar: ~25–33 hafta.
Başlangıç Adımı (Faz 0 ilk gün):

docs/GOVERNANCE.md v1.1.0'ı kabul et.

docs/adr/0001 … 0013 yaz (yukarıdaki GOVERNANCE §8 index'i).

TECHNICAL_SPEC.md v5.1.0'ı devreye al.

README.md v4.1.0'ı devreye al.

ROADMAP.md v5.1.0'ı devreye al.

docs/brand.md oluştur (**Kuleplus** + "Executive Trust" renk paleti + logo notları).

docs/api/permissions-catalog.md, docs/api/error-codes.md, docs/product/screens.md, docs/product/i18n.md, docs/product/email-templates.md, docs/product/seo-analytics.md, docs/product/help-center.md oluştur (boş şablon).

docs/legal/ klasörü + 6 şablon dosyası (kvkk-aydinlatma.md, kullanim-kosullari.md, cerez-politikasi.md, dpa.md, pilot-dpa.md, ortak-komisyon-sozlesmesi.md).

docs/operations/ klasörü + 3 dosya (incident-runbook.md, platform-billing.md, restore-drill-template.md).

docs/product/import-templates/ klasörü + 4 sözleşme (contacts.md, products.md, opening-balances.md, opening-stock.md).

docs/archive/ROADMAP-v4-conflict-log.md oluştur (v4.1.0 çelişki logu).

CI'ya GOVERNANCE kural kontrolü + coverage eşiği + axe-core + bundle-size + OpenAPI üretim adımları ekle.

Preview environment kur (web + site).

14. Bu Sürümde Değişen ve Eklenen Dosya Özeti (v5.0.0 → v5.1.0)
Aşağıdaki tablo, bu roadmap sürümüyle birlikte repo genelindeki değişiklikleri özetler.

Dosya	Durum	Notlar
docs/GOVERNANCE.md	Güncelleme	v1.0.0 → v1.1.0; §2'ye legal_texts/legal_acceptances core'a taşındı; §6a/§6b eklendi; ADR-0011/0012/0013 index'e eklendi
docs/README.md	Güncelleme	v4.0.0 → v4.1.0; yeni dosya referansları; WCAG 2.1 AA; Astro; max_custom_roles
docs/TECHNICAL_SPEC.md	Güncelleme	v5.0.0 → v5.1.0; §0.3/§1.2/§1.3/§6.5/§8.1/§8.2/§17/§22/§23.1/§24/§25/§27.1/§27.2/§27.5/§30.2/§30.3/§30.5/§30.7 güncellendi; §34'e 5 yeni değişmez ilke
docs/ROADMAP.md	Güncelleme	v5.0.0 → v5.1.0 (bu dosya)
docs/brand.md	Yeni	Marka placeholder + ton-of-voice
docs/api/permissions-catalog.md	Yeni	Tam permission kataloğu (kod üretir)
docs/api/error-codes.md	Yeni	Tam hata kodu kataloğu (kod üretir)
docs/api/openapi.yaml	Yeni (otomatik)	Zod'dan üretilir; commit'lenir
docs/product/screens.md	Yeni	Ekran listesi (route + yetki + faz)
docs/product/i18n.md	Yeni	i18n anahtar kuralı
docs/product/email-templates.md	Yeni	E-posta şablon envanteri
docs/product/seo-analytics.md	Yeni	SEO + analitik planı
docs/product/help-center.md	Yeni	Yardım merkezi başlıkları
docs/product/import-templates/contacts.md	Yeni	Cari import sözleşmesi
docs/product/import-templates/products.md	Yeni	Ürün import sözleşmesi
docs/product/import-templates/opening-balances.md	Yeni	Açılış bakiyesi import sözleşmesi
docs/product/import-templates/opening-stock.md	Yeni	Açılış stoğu import sözleşmesi
docs/legal/kvkk-aydinlatma.md	Yeni	Boş şablon
docs/legal/kullanim-kosullari.md	Yeni	Boş şablon
docs/legal/cerez-politikasi.md	Yeni	Boş şablon
docs/legal/dpa.md	Yeni	Boş şablon
docs/legal/pilot-dpa.md	Yeni	Boş şablon
docs/legal/ortak-komisyon-sozlesmesi.md	Yeni	Boş şablon
docs/operations/incident-runbook.md	Yeni	SEV1–SEV4, on-call, iletişim
docs/operations/platform-billing.md	Yeni	İşletmeci şirket + fatura serisi
docs/operations/restore-drill-template.md	Yeni	RPO/RTO tatbikat şablonu
docs/adr/0011-legal-texts-core-module.md	Yeni	ADR
docs/adr/0012-site-teknoloji-astro.md	Yeni	ADR
docs/adr/0013-openapi-zod-uretimi.md	Yeni	ADR
docs/archive/ROADMAP-v4-conflict-log.md	Yeni	v4.1.0 çelişki logu
packages/ui/	Yeni	Ortak Vue bileşenleri (web + site paylaşımı)
.github/workflows/	Güncelleme	GOVERNANCE kural kontrolü + coverage + axe-core + bundle-size + openapi:generate
Bu roadmap, TECHNICAL_SPEC v5.1.0, README v4.1.0 ve GOVERNANCE v1.1.0 ile tam uyumludur. Çelişki tespit edilirse GOVERNANCE §1 hiyerarşisi uygulanır: ürün önceliği ve faz sırasında bu doküman, teknik kurallarda TECHNICAL_SPEC esastır; çözüm ADR ile kayıt altına alınır ve etkilenen dokümanlar aynı PR'da güncellenir (GOVERNANCE §7).

Doküman sonu.

text

---

## ✅ `docs/ROADMAP.md` v5.1.0 Tamamlandı

