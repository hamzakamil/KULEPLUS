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

> Faz 2+ modülleri (`contacts`, `stock`, `trade`, `cashbank`, `einvoice`, `accounting`, `cheque`,
> `reports_plus`, `management`, `sms`, `integrations`) ilgili fazlarda `PERMISSIONS` dizisine
> eklenir; bu doküman aynı PR'da güncellenir.

## Delegatable = FALSE (kritik — SPEC §6.4)

Bir yönetici yalnızca kendi sahip olduğu **ve** `delegatable = TRUE` olan izinleri başka role atayabilir.
Aşağıdaki kategoriler devredilemez:

- `*.approve` — kritik finansal onaylar (fatura, ödeme, fiş)
- `platform.*` — tüm platform izinleri
- `core.owner.transfer` — Owner devri
- `platform.support_access.grant` — destek erişim grantı
- `subscription.entitlement.manage` — manuel hak tanımlama

Kod tarafında: `NON_DELEGATABLE_PERMISSIONS` (`packages/shared/src/permissions.ts`).