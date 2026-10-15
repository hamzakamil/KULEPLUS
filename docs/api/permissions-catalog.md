# Permission Kataloğu

**Durum:** Faz 1 doldurulmuş (çekirdek + platform + abonelik)
**Tek kaynak:** `packages/shared/src/permissions.ts` (`PERMISSIONS`) — bu dosya ondan senkron tutulur
**CI kontrolü:** `scripts/governance-check.mjs` (format `module.resource.action` + GOVERNANCE §2 modül kodu)

## Format
`module.resource.action` — `module` alanı GOVERNANCE §2 `module_code` ile birebir aynıdır (SPEC §6.1).
Geçerli scope'lar (SPEC §6.2): `all`, `own_branch`, `own_department`, `assigned_only`, `created_by_me`, `self`.
İlk sürümde fiilen kullanılan: `all`, `created_by_me`, `assigned_only`.

## Katalog

### `core` — SPEC §4, §5, §6

| Modül | Permission | Scope geçerli | Delegatable |
|-------|-----------|---------------|-------------|
| core | `core.user.read` | all, own_department | ✅ |
| core | `core.user.create` | all | ✅ |
| core | `core.user.update` | all, own_department | ✅ |
| core | `core.user.delete` | all | ✅ |
| core | `core.role.read` | all | ✅ |
| core | `core.role.manage` | all | ✅ |
| core | `core.department.read` | all | ✅ |
| core | `core.department.manage` | all | ✅ |
| core | `core.settings.read` | all | ✅ |
| core | `core.settings.update` | all | ✅ |
| core | `core.audit.read` | all | ✅ |
| core | `core.legal.read` | all | ✅ |
| core | `core.owner.transfer` | all | ❌ |

### `platform` — SPEC §5.1 (tümü devredilemez)

| Modül | Permission | Scope geçerli | Delegatable |
|-------|-----------|---------------|-------------|
| platform | `platform.tenant.manage` | all | ❌ |
| platform | `platform.application.manage` | all | ❌ |
| platform | `platform.plan.manage` | all | ❌ |
| platform | `platform.support_access.grant` | all | ❌ |
| platform | `platform.audit.read` | all | ❌ |

### `subscription` — SPEC §8

| Modül | Permission | Scope geçerli | Delegatable |
|-------|-----------|---------------|-------------|
| subscription | `subscription.plan.read` | all | ✅ |
| subscription | `subscription.entitlement.read` | all | ✅ |
| subscription | `subscription.entitlement.manage` | all | ❌ |
| subscription | `subscription.usage.read` | all | ✅ |
| subscription | `subscription.subscription.read` | all, own_branch | ✅ |
| subscription | `subscription.subscription.create` | all | ✅ |
| subscription | `subscription.subscription.update` | all | ✅ |
| subscription | `subscription.subscription.delete` | all | ✅ |
| subscription | `subscription.subscription.manage` | all | ✅ |

### `contacts` — SPEC §11 (Faz 2)

| Modül | Permission | Scope geçerli | Delegatable |
|-------|-----------|---------------|-------------|
| contacts | `contacts.contact.read` | all, own_branch, created_by_me | ✅ |
| contacts | `contacts.contact.create` | all | ✅ |
| contacts | `contacts.contact.update` | all, own_branch, created_by_me | ✅ |
| contacts | `contacts.contact.delete` | all | ✅ |
| contacts | `contacts.ledger.read` | all, own_branch | ✅ |
| contacts | `contacts.ledger.create` | all | ✅ |

### `stock` — SPEC §14 (Faz 2)

| Modül | Permission | Scope geçerli | Delegatable |
|-------|-----------|---------------|-------------|
| stock | `stock.product.read` | all, own_branch | ✅ |
| stock | `stock.product.create` | all | ✅ |
| stock | `stock.product.update` | all | ✅ |
| stock | `stock.product.delete` | all | ✅ |
| stock | `stock.movement.post` | all | ✅ |
| stock | `stock.movement.adjust` | all | ✅ |

### `trade` — SPEC §12, ADR-0007/0008 (Faz 2–3)

| Modül | Permission | Scope geçerli | Delegatable |
|-------|-----------|---------------|-------------|
| trade | `trade.invoice.read` | all, own_branch, created_by_me | ✅ |
| trade | `trade.invoice.create` | all | ✅ |
| trade | `trade.invoice.update` | all | ✅ |
| trade | `trade.invoice.delete` | all | ✅ |
| trade | `trade.invoice.approve` | all | ❌ |
| trade | `trade.expense.read` | all, own_branch | ✅ |
| trade | `trade.expense.create` | all | ✅ |
| trade | `trade.expense.update` | all | ✅ |
| trade | `trade.expense.delete` | all | ✅ |

### `cheque` — ROADMAP Faz 6 (çek/senet)

| Modül | Permission | Scope geçerli | Delegatable |
|-------|-----------|---------------|-------------|
| cheque | `cheque.cheque.read` | all, own_branch | ✅ |
| cheque | `cheque.cheque.create` | all | ✅ |
| cheque | `cheque.cheque.update` | all | ✅ |
| cheque | `cheque.cheque.delete` | all | ✅ |
| cheque | `cheque.cheque.manage` | all | ✅ |

### `einvoice` — SPEC §21 (Faz 4, e-Dönüşüm)

| Modül | Permission | Scope geçerli | Delegatable |
|-------|-----------|---------------|-------------|
| einvoice | `einvoice.document.read` | all | ✅ |
| einvoice | `einvoice.document.create` | all | ✅ |
| einvoice | `einvoice.document.send` | all | ✅ |
| einvoice | `einvoice.document.cancel` | all | ✅ |

> Faz 2+ modülleri (`cashbank`, `accounting`,
> `reports_plus`, `management`, `sms`, `integrations`) ilgili fazlarda `PERMISSIONS` dizisine
> eklenir; bu doküman aynı PR'da güncellenir.

### `management` — şantiye / saha kayıtları (ROADMAP Faz 7.6)

| Modül | Permission | Scope geçerli | Delegatable |
|-------|-----------|---------------|-------------|
| management | `management.site.read` | all | ✅ |
| management | `management.site.create` | all | ✅ |
| management | `management.site.update` | all | ✅ |
| management | `management.site.delete` | all | ✅ |

Not: Faz 7'nin diğer `management.*` izinleri (görev, takvim, randevu, onay, …) bu
katalog tablosuna henüz taşınmadı; tek kaynak `packages/shared/src/permissions.ts`'tir.

Not (ADR-0022): Kokpitin döviz + altın şeridi için eklenen `GET /management/rates` ucu
**yeni izin gerektirmez** — kokpitle aynı `management.dashboard.read` iznini kullanır.
Canlı fiyatlar (Gramhane) gösterim amaçlıdır; muhasebe kurları `cashbank` paketi içindeki
Döviz Kurları ekranından (`exchange_rates` / TCMB) yönetilmeye devam eder.

## Delegatable = FALSE (kritik — SPEC §6.4)

Bir yönetici yalnızca kendi sahip olduğu **ve** `delegatable = TRUE` olan izinleri başka role atayabilir.
Aşağıdaki kategoriler devredilemez:

- `*.approve` — kritik finansal onaylar (fatura, ödeme, fiş)
- `platform.*` — tüm platform izinleri
- `core.owner.transfer` — Owner devri
- `platform.support_access.grant` — destek erişim grantı
- `subscription.entitlement.manage` — manuel hak tanımlama

Kod tarafında: `NON_DELEGATABLE_PERMISSIONS` (`packages/shared/src/permissions.ts`).