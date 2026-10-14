# GOVERNANCE.md — Doküman Yönetişimi ve Çelişki Çözümü

**Sürüm:** 1.1.0 · **Tarih:** 5 Ekim 2026 · **Durum:** Bağlayıcı

Bu doküman; `README.md`, `docs/TECHNICAL_SPEC.md`, `docs/ROADMAP.md` ve `docs/adr/*` arasındaki **yetki hiyerarşisini** ve **çelişki çözüm prosedürünü** tanımlar. Bir ajan veya geliştirici, çelişki tespit ettiğinde bu dokümanı uygular.

---

## 1. Yetki Hiyerarşisi (Konu Bazlı)

| Konu | Yetkili Doküman |
|------|-----------------|
| Ürün önceliği, faz sırası, süreler, çıkış kapıları | **ROADMAP** |
| Kullanıcıya sunum, modül kodları, paket içeriği, kurulum | **README** |
| Domain sınırları, veri modeli, tablolar, permission formatı, RLS, güvenlik, finansal standart | **TECHNICAL_SPEC** |
| Yeni ürün/mimari kararı | **ADR** (`docs/adr/`) |
| Çelişki halinde | Önce **ADR** yazılır, sonra ilgili doküman(lar) aynı PR'da güncellenir |

**Kural:** "TECHNICAL_SPEC esas alınır" ifadesi **yalnızca teknik kural** (veri modeli, RLS, permission, finansal hesap, tenant izolasyonu) içindir. **Ürün önceliği ve faz sırası** konusunda ROADMAP esastır. Bu ikisi çelişirse, çelişki değil **katman** vardır: SPEC "nasıl", ROADMAP "ne zaman/ne önce".

---

## 2. Tek Modül Kodu Tablosu (Tek Kaynak)

Aşağıdaki tablo **tek doğruluk kaynağıdır**. `permission_prefix`, klasör adı, entitlement kodu, README modül kodu ve SPEC tablo grupları buradan türetilir. Yeni modül eklemek için bu tabloya satır eklenir + ADR yazılır.

| module_code | permission_prefix | Klasör | Faz | Kapsanan tablolar |
|-------------|-------------------|--------|-----|-------------------|
| `core` | `core.*` | `modules/core/` | 1 | `users`, `user_sessions`, `refresh_tokens`, `password_reset_tokens`, `tenants`, `tenant_users`, `tenant_user_roles`, `tenant_user_departments`, `tenant_invitations`, `branches`, `departments`, `roles`, `permissions`, `role_permissions`, `tenant_settings`, `audit_logs`, `email_outbox`, `idempotency_keys`, `legal_texts`, `legal_acceptances`, `company_applications`, `demo_items` (test/RLS iskeleti) |
| `platform` | `platform.*` | `modules/platform/` | 1 | `platform_users`, `platform_roles`, `platform_user_roles`, `platform_settings`, `support_access_grants`, `backup_jobs`, `backup_settings`, `platform_metrics_daily` |
| `contacts` | `contacts.*` | `modules/contacts/` | 2 | `contacts`, `contact_roles`, `contact_addresses`, `contact_phones`, `contact_emails`, `contact_relations`, `party_accounts`, `party_ledger_entries`, `settlements`, `settlement_allocations`, `settlement_templates` |
| `stock` | `stock.*` | `modules/stock/` | 2 | `products`, `product_barcodes`, `units`, `unit_conversions`, `warehouses`, `stock_documents`, `stock_document_lines`, `stock_movements`, `stock_balances`, `stock_reservations`, `inventory_counts`, `inventory_count_lines`, `stock_cost_entries` |
| `trade` | `trade.*` | `modules/trade/` | 3 | `sales_quotes`, `sales_quote_lines`, `sales_orders`, `sales_order_lines`, `purchase_orders`, `purchase_order_lines`, `deliveries`, `delivery_lines`, `invoices`, `invoice_lines`, `invoice_payments`, `invoice_sequences`, `tax_rates`, `document_links`, `document_number_sequences`, `expenses`, `expense_categories`, `expense_payments` |
| `cashbank` | `cashbank.*` | `modules/cash-bank/` | 3 | `cash_bank_accounts`, `cash_bank_movements`, `cash_accounts`, `bank_accounts`, `cash_transactions`, `bank_transactions`, `account_transfers`, `bank_import_batches`, `bank_import_rows`, `bank_reconciliation_matches`, `bank_loans`, `credit_cards`, `pos_accounts`, `exchange_rates` |
| `einvoice` | `einvoice.*` | `modules/einvoice/` | 4 | `einvoice_outbox`, `einvoice_inbox`, `einvoice_documents`, `einvoice_status_events` |
| `subscription` | `subscription.*` | `modules/subscription/` | 5 | `modules`, `features`, `module_dependencies`, `plans`, `plan_versions`, `plan_features`, `plan_limits`, `prices`, `tenant_entitlements`, `tenant_module_settings`, `subscriptions`, `subscription_items`, `subscription_changes`, `usage_counters`, `commercial_orders`, `commercial_order_items`, `billing_invoices`, `billing_invoice_lines`, `payment_attempts`, `billing_payments`, `billing_refunds`, `billing_allocations`, `dunning_attempts`, `provider_webhook_events`, `coupons`, `coupon_redemptions`, `partners`, `partner_referrals`, `partner_commissions` |
| `accounting` | `accounting.*` | `modules/accounting/` | 6 | `fiscal_periods`, `accounting_accounts`, `journal_entries`, `journal_lines`, `posting_rules`, `account_mappings`, `period_locks`, `cost_centers`, `project_tags`, `invoice_line_dimensions`, `journal_line_dimensions`, `expense_dimensions` |
| `cheque` | `cheque.*` | `modules/cheque/` | 6 | `cheques`, `cheque_transactions`, `cheque_portfolio` |
| `reports_plus` | `reports_plus.*` | `modules/reports_plus/` | 6 | `report_generations` (yalnızca view + konfigürasyon) |
| `management` | `management.*` | `modules/management/` | 7 | `tasks`, `reminders`, `calendars`, `calendar_events`, `appointments`, `notes`, `activities`, `notifications`, `user_devices`, `notification_deliveries`, `notification_preferences`, `management_rule_settings`, `approval_requests` |
| `sms` | `sms.*` | `modules/sms/` | 4 | `sms_credits`, `sms_messages` |
| `integrations` | `integrations.*` | `modules/integrations/` | 8 | `integrations`, `integration_credentials`, `webhook_events`, `external_mappings`, `whatsapp_accounts`, `whatsapp_conversations`, `whatsapp_messages`, `message_status_events` |

**Kurallar:**
- Yeni modül eklemek = yeni satır + ADR.
- Modül kodu ile permission öneki **her zaman aynıdır**.
- `purchasing.*` ve `logistics.*` önekleri **kaldırılmıştır**; satın alma `trade.purchase_*`, lojistik `trade.delivery_*` altındadır.
- `accounting.invoice.*` **kaldırılmıştır**; fatura `trade.invoice.*` altındadır.
- **v1.1.0 değişikliği:** `legal_texts` ve `legal_acceptances` tabloları `subscription` modülünden `core` modülüne taşınmıştır (ADR-0011). Gerekçe: Kayıt/kimlik akışının parçasıdır, abonelikle doğrudan ilişkisi yoktur; ROADMAP gereği Faz 1'de teslim edilir.
- **Faz 1 kod senkronu (bu güncelleme):** §2 tablosu, uygulanan migration'lardaki gerçek tablo adlarına göre hizalandı — `tenant_user_roles`, `tenant_user_departments` (eski `user_roles`), `password_reset_tokens`, `email_outbox` `core` satırına eklendi; `company_applications` tek kaynak kabul edilerek `platform` satırındaki yinelenen `tenant_applications` kaldırıldı. `gen_random_uuid()` yasağı `scripts/governance-check.mjs` ile CI'da zorlanır.

---

## 3. ID ve Ortak Kolon Standardı (Özet)

Detay `TECHNICAL_SPEC §0`'dadır. Özet:
- **Birincil anahtar:** `UUID v7` (zaman sıralı, index dostu).
- **`tenant_id`:** Tenant verisi taşıyan tüm tablolarda `NOT NULL`. İstisnalar `TECHNICAL_SPEC §7.0`'da listelenmiştir.
- **`created_at` / `updated_at`:** `TIMESTAMPTZ`, `NOT NULL`, uygulama tarafından yazılır.
- **`created_by` / `updated_by`:** `UUID`, `users.id` FK (platform işlemlerinde `NULL`).
- **`version`:** Optimistic lock için `INTEGER`, `NOT NULL DEFAULT 1`.
- **Soft delete:** Yalnızca kart niteliğindeki tablolarda (`contacts`, `products`, `users` vb.). Finansal belgelerde **yasak**.
- **v1.1.0 notu:** `legal_texts` ve `legal_acceptances` **global** tablolardır; `tenant_id` taşımazlar. Kabul kayıtları yalnızca `user_id` bazlıdır (bkz. SPEC §0.3).

---

## 4. Platform Yönetimi Kararı (Bağlayıcı)

- **Tek `platform_owner`** vardır (`platform_users.is_platform_owner = TRUE` üzerinde `UNIQUE` kısmi index). Bu, SPEC v4.0.0'daki "Super Admin singleton" ilkesinin karşılığıdır.
- Diğer platform rolleri: `platform_support`, `platform_sales`, `platform_finance`, `platform_readonly` (`platform_roles` tablosunda).
- **Çapraz tenant erişimi** yalnızca `support_access_grants` kaydıyla, süreli ve gerekçeli yapılır. Grant olmadan hiçbir platform kullanıcısı tenant verisi göremez.
- `platform_settings` singleton **yoktur**; ayarlar `platform_settings (key, value)` anahtar-değer tablosundadır.

---

## 5. Onboarding Kararı (Bağlayıcı)

- `tenant_settings.onboarding_mode` enum: `auto | manual | hybrid`.
- **Varsayılan: `manual`** (README ile uyumlu).
- Beta sonrası veriye göre `hybrid`'e geçiş ADR ile yapılır.

---

## 6. Mobil Kararı (Bağlayıcı)

- **PWA-first** (Faz 2'den itibaren responsive + PWA).
- **Flutter Faz 9, koşullu** (§6 tetikleyicileri).
- `apps/mobile/` klasörü **yoktur**; Faz 9'da açılır.
- SPEC §25.1'deki Keystore/Keychain detayları Faz 9'a ertelenmiştir.

---

## 6a. Site Teknoloji Kararı (v1.1.0'da eklendi)

- `apps/web` (müşteri + platform paneli): **Vue 3 + Vite + Pinia + Vue Router + Tailwind + vite-plugin-pwa** (mevcut karar korunur; ADR-0012).
- `apps/site` (pazarlama + yardım merkezi): **Astro** (statik çıktı, `@astrojs/vue` ile `packages/ui` bileşen paylaşımı).
- Barındırma: `apps/web`/api/worker → TR VPS; `apps/site` → Cloudflare Pages.
- Detay: ADR-0012.

---

## 6b. OpenAPI Üretim Kararı (v1.1.0'da eklendi)

- API sözleşmesi (`docs/api/openapi.yaml`) **Zod şemalarından otomatik üretilir** (ADR-0013).
- Tek doğruluk kaynağı: Zod (`packages/shared`).
- Çift bakım yok; doküman koddan türetilir.

---

## 7. Çelişki Çözüm Prosedürü

1. Çelişki tespit edilir.
2. `docs/adr/NNNN-<slug>.md` oluşturulur: bağlam, karar, alternatifler, sonuç.
3. Etkilenen tüm dokümanlar **aynı PR'da** güncellenir.
4. Test edilebilir kapanış kriteri ADR'ye yazılır.
5. PR review'da `GOVERNANCE.md §1` hiyerarşisi kontrol edilir.

---

## 8. ADR Index

| # | Başlık | Durum |
|---|--------|-------|
| 0000 | [ADR Şablonu](adr/0000-template.md) | — |
| 0001 | [Doküman hiyerarşisi ve çelişki çözümü](adr/0001-dokuman-hiyerarsisi.md) | Kabul |
| 0002 | [UUID v7 birincil anahtar standardı](adr/0002-uuid-v7.md) | Kabul |
| 0003 | [Platform yönetimi: platform_owner + roller + support_access_grants](adr/0003-platform-yonetimi.md) | Kabul |
| 0004 | [Onboarding: varsayılan `manual`](adr/0004-onboarding-manual.md) | Kabul |
| 0005 | [Mobil: PWA-first, Flutter koşullu](adr/0005-pwa-first.md) | Kabul |
| 0006 | [Modül kodu = permission öneki = klasör = entitlement](adr/0006-modul-kodu-esitligi.md) | Kabul |
| 0007 | [Fatura `trade.invoice.*` altında; `accounting.invoice.*` iptal](adr/0007-fatura-trade-altinda.md) | Kabul |
| 0008 | [Gider modeli: ayrı `expenses` tablosu](adr/0008-gider-tablosu.md) | Kabul |
| 0009 | [Contact alt tablolar tek doğruluk kaynağıdır (inline alanlar kaldırıldı)](adr/0009-contact-alt-tablolar.md) | Kabul |
| 0010 | [Soft delete yalnızca kart tablolarında; finansal belgelerde yasak](adr/0010-soft-delete-kurali.md) | Kabul |
| 0011 | [`legal_texts` ve `legal_acceptances` `core` modülüne taşındı; ikisi de global](adr/0011-legal-texts-core-module.md) | **Kabul (v1.1.0)** |
| 0012 | [`apps/site` = Astro; `apps/web` = Vue 3 + Vite (değişmez)](adr/0012-site-teknoloji-astro.md) | **Kabul (v1.1.0)** |
| 0013 | [OpenAPI Zod'dan otomatik üretilir; tek kaynak Zod](adr/0013-openapi-zod-uretimi.md) | **Kabul (v1.1.0)** |
| 0014 | [Pagination Kuralı — Cursor vs Offset](adr/0014-pagination-kurali.md) | **Kabul** |
| 0015 | [Optimistic Lock — `version` Kolonu + `If-Match` Header](adr/0015-optimistic-lock.md) | **Kabul** |
| 0016 | [Audit Log — Değişmez Kayıt + RLS](adr/0016-audit-log.md) | **Kabul** |
| 0017 | [Hata Sözleşmesi — Tek Format, `code` Zorunlu](adr/0017-error-contract.md) | **Kabul** |
| 0018 | [Sıralama ve Filtreleme — Standart Parametreler](adr/0018-sorting-filtering.md) | **Kabul** |
| 0019 | [Timezone — `Europe/Istanbul` Varsayılan, Tenant Bazlı](adr/0019-timezone.md) | **Kabul** |
| 0020 | [Mimari — Modüler Monolit, Paylaşılan Kernel](adr/0020-mimari-karar.md) | **Kabul** |