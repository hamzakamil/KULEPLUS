/**
 * Permission kataloğu — TEK KAYNAK (SPEC §6.5, ADR-0006).
 *
 * Format: `module.resource.action` (SPEC §6.1). `module` alanı GOVERNANCE §2'deki
 * `module_code` ile birebir aynı olmak zorundadır. `docs/api/permissions-catalog.md`
 * bu dosyadan üretilir; `scripts/governance-check.mjs` CI'da formatı ve modül kodunu zorlar.
 *
 * İlk sürümde teslim edilen izinler burada tanımlanır ve Faz'lar ilerledikçe büyütülür.
 * `delegatable = false` olan izinler kritik finansal onay/platform izinleridir (SPEC §6.4).
 */

/** GOVERNANCE §2 modül kodları — permission öneki, klasör adı ve entitlement kodu ile aynıdır. */
export const MODULE_CODES = [
  'core',
  'platform',
  'contacts',
  'stock',
  'trade',
  'cashbank',
  'einvoice',
  'subscription',
  'accounting',
  'cheque',
  'reports_plus',
  'management',
  'sms',
  'integrations',
] as const;

export type ModuleCode = (typeof MODULE_CODES)[number];

/** Yetki kapsamı — SPEC §6.2. İlk sürümde fiilen `all`, `created_by_me`, `assigned_only`. */
export const PERMISSION_SCOPES = [
  'all',
  'own_branch',
  'own_department',
  'assigned_only',
  'created_by_me',
  'self',
] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export interface PermissionDefinition {
  /** `module.resource.action` biçiminde tam kod. */
  readonly code: string;
  /** GOVERNANCE §2 modül kodu. */
  readonly module: ModuleCode;
  readonly resource: string;
  readonly action: string;
  readonly name: string;
  readonly description?: string;
  /** Bir yönetici bu izni başka role devredebilir mi? (SPEC §6.4) */
  readonly delegatable: boolean;
  /** Sistem izni ise Company Admin silemez (SPEC §6.5). */
  readonly isSystemPermission: boolean;
}

function perm(
  module: ModuleCode,
  resource: string,
  action: string,
  name: string,
  options: { delegatable?: boolean; description?: string } = {},
): PermissionDefinition {
  const code = `${module}.${resource}.${action}`;
  // `*.approve` ve platform izinleri varsayılan olarak devredilemez (SPEC §6.4).
  const delegatable = options.delegatable ?? !(action === 'approve' || module === 'platform');
  return {
    code,
    module,
    resource,
    action,
    name,
    description: options.description,
    delegatable,
    isSystemPermission: true,
  };
}

/** Faz 1'de teslim edilen çekirdek izinler. */
export const PERMISSIONS: readonly PermissionDefinition[] = [
  // --- core (SPEC §4, §5, §6) ---
  perm('core', 'user', 'read', 'Kullanıcıları görüntüle'),
  perm('core', 'user', 'create', 'Kullanıcı davet et'),
  perm('core', 'user', 'update', 'Kullanıcı güncelle'),
  perm('core', 'user', 'delete', 'Kullanıcı kaldır'),
  perm('core', 'role', 'read', 'Rolleri görüntüle'),
  perm('core', 'role', 'manage', 'Rol ve yetki yönet'),
  perm('core', 'department', 'read', 'Departmanları görüntüle'),
  perm('core', 'department', 'manage', 'Departman yönet'),
  perm('core', 'settings', 'read', 'Şirket ayarlarını görüntüle'),
  perm('core', 'settings', 'update', 'Şirket ayarlarını güncelle'),
  perm('core', 'audit', 'read', 'Denetim günlüğünü görüntüle'),
  perm('core', 'owner', 'transfer', 'Owner devri', { delegatable: false }),
  perm('core', 'legal', 'read', 'Yasal metinleri görüntüle'),

  // --- platform (SPEC §5.1) — tümü devredilemez ---
  perm('platform', 'tenant', 'manage', 'Tenant yönet', { delegatable: false }),
  perm('platform', 'application', 'manage', 'Şirket başvurusu incele', { delegatable: false }),
  perm('platform', 'plan', 'manage', 'Plan ve modül kataloğu yönet', { delegatable: false }),
  perm('platform', 'support_access', 'grant', 'Destek erişim grantı ver', { delegatable: false }),
  perm('platform', 'audit', 'read', 'Platform denetimini görüntüle', { delegatable: false }),

  // --- subscription (SPEC §8) ---
  perm('subscription', 'plan', 'read', 'Paketleri görüntüle'),
  perm('subscription', 'entitlement', 'read', 'Hakları görüntüle'),
  perm('subscription', 'entitlement', 'manage', 'Manuel hak tanımla', { delegatable: false }),
  perm('subscription', 'usage', 'read', 'Kota kullanımını görüntüle'),
];

/** Koda göre hızlı arama (O(1)). */
export const PERMISSION_BY_CODE: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSIONS.map((p) => [p.code, p]),
);

/** Kritik (devredilemez) izinler — SPEC §6.4. */
export const NON_DELEGATABLE_PERMISSIONS: readonly string[] = PERMISSIONS.filter(
  (p) => !p.delegatable,
).map((p) => p.code);

/**
 * `module.resource.action` biçimini ve modül kodunu doğrular (SPEC §6.1, GOVERNANCE §2).
 * Runtime ve testler tarafından kullanılır; CI'da `governance-check.mjs` aynı kuralı zorlar.
 */
export function isValidPermissionCode(code: string): boolean {
  const parts = code.split('.');
  if (parts.length !== 3) return false;
  const [module, resource, action] = parts as [string, string, string];
  const shape = /^[a-z][a-z0-9_]*$/;
  if (!shape.test(resource) || !shape.test(action)) return false;
  return (MODULE_CODES as readonly string[]).includes(module);
}
