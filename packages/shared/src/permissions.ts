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
  perm('subscription', 'subscription', 'read', 'Abonelikleri görüntüle'),
  perm('subscription', 'subscription', 'create', 'Abonelik/sipariş oluştur'),
  perm('subscription', 'subscription', 'update', 'Abonelik güncelle'),
  perm('subscription', 'subscription', 'delete', 'Abonelik/iptal'),
  perm('subscription', 'subscription', 'manage', 'Abonelik yaşam döngüsü ve faturalama yönetimi'),

  // --- contacts (SPEC §11 — Faz 2) ---
  perm('contacts', 'contact', 'read', 'Cari kartları görüntüle'),
  perm('contacts', 'contact', 'create', 'Cari kart oluştur'),
  perm('contacts', 'contact', 'update', 'Cari kart güncelle'),
  perm('contacts', 'contact', 'delete', 'Cari kart sil'),
  perm('contacts', 'ledger', 'read', 'Cari ekstre görüntüle'),
  perm('contacts', 'ledger', 'create', 'Cari hareket işle'),

  // --- stock (SPEC §14 — Faz 2) ---
  perm('stock', 'product', 'read', 'Ürünleri görüntüle'),
  perm('stock', 'product', 'create', 'Ürün oluştur'),
  perm('stock', 'product', 'update', 'Ürün güncelle'),
  perm('stock', 'product', 'delete', 'Ürün sil'),
  perm('stock', 'movement', 'post', 'Stok hareketi işle'),
  perm('stock', 'movement', 'adjust', 'Stok düzeltme işle'),

  // --- trade (SPEC §12, ADR-0007 — fatura `trade.invoice.*` altındadır) ---
  perm('trade', 'invoice', 'read', 'Faturaları görüntüle'),
  perm('trade', 'invoice', 'create', 'Fatura oluştur'),
  perm('trade', 'invoice', 'update', 'Fatura güncelle'),
  perm('trade', 'invoice', 'delete', 'Fatura sil'),
  perm('trade', 'invoice', 'approve', 'Fatura onayla / kesinleştir'),

  // --- trade (gider — ADR-0008: `trade.expense.*`, Faz 3) ---
  perm('trade', 'expense', 'read', 'Giderleri görüntüle'),
  perm('trade', 'expense', 'create', 'Gider oluştur'),
  perm('trade', 'expense', 'update', 'Gider güncelle'),
  perm('trade', 'expense', 'delete', 'Gider sil'),

  // --- einvoice (SPEC §21 — Faz 4) — e-Dönüşüm entegrasyonu ---
  perm('einvoice', 'document', 'read', 'e-Dönüşüm belgelerini görüntüle'),
  perm('einvoice', 'document', 'create', 'e-Dönüşüm belgesi oluştur'),
  perm('einvoice', 'document', 'send', 'e-Dönüşüm belgesi gönder'),
  perm('einvoice', 'document', 'cancel', 'e-Dönüşüm belgesi iptal'),

  // --- accounting (SPEC §15 — yevmiye fişleri) ---
  perm('accounting', 'entry', 'read', 'Yevmiye fişlerini görüntüle'),
  perm('accounting', 'entry', 'create', 'Yevmiye fişi oluştur'),
  perm('accounting', 'entry', 'update', 'Yevmiye fişi güncelle'),
  perm('accounting', 'entry', 'delete', 'Yevmiye fişi sil'),
  perm('accounting', 'entry', 'approve', 'Yevmiye fişi onayla (post)'),

  // --- cheque (ROADMAP Faz 6 — çek/senet) ---
  perm('cheque', 'cheque', 'read', 'Çek/senet görüntüle'),
  perm('cheque', 'cheque', 'create', 'Çek/senet oluştur'),
  perm('cheque', 'cheque', 'update', 'Çek/senet güncelle'),
  perm('cheque', 'cheque', 'delete', 'Çek/senet sil'),
  perm('cheque', 'cheque', 'manage', 'Çek/senet yaşam döngüsü (ciro/tahsil/karşılıksız/iptal)'),

  // --- management (ROADMAP Faz 7 — görev/takvim/randevu/not/bildirim) ---
  perm('management', 'task', 'read', 'Görevleri görüntüle'),
  perm('management', 'task', 'create', 'Görev oluştur'),
  perm('management', 'task', 'update', 'Görev güncelle'),
  perm('management', 'task', 'delete', 'Görev sil'),
  perm('management', 'task', 'assign', 'Görev ata'),
  perm('management', 'task', 'complete', 'Görev tamamla'),
  perm('management', 'calendar', 'read', 'Takvimi görüntüle'),
  perm('management', 'calendar', 'manage', 'Takvim yönet'),
  perm('management', 'appointment', 'read', 'Randevuları görüntüle'),
  perm('management', 'appointment', 'create', 'Randevu oluştur'),
  perm('management', 'appointment', 'update', 'Randevu güncelle'),
  perm('management', 'appointment', 'manage', 'Randevu durumu yönet (onay/iptal/no-show)'),
  perm('management', 'note', 'read', 'Notları görüntüle'),
  perm('management', 'note', 'create', 'Not oluştur'),
  perm('management', 'note', 'update', 'Not güncelle'),
  perm('management', 'note', 'delete', 'Not sil'),
  perm('management', 'activity', 'read', 'Aktivite akışını görüntüle'),
  perm('management', 'notification', 'read', 'Bildirimleri görüntüle'),
  perm('management', 'notification', 'send', 'Bildirim gönder'),
  perm('management', 'preference', 'manage', 'Bildirim tercihlerini yönet'),
  perm('management', 'device', 'manage', 'Bildirim cihazlarını yönet'),
  perm('management', 'dashboard', 'read', 'Patron paneli göstergelerini görüntüle'),
  perm('management', 'rule', 'read', 'Kural ayarlarını görüntüle'),
  perm('management', 'rule', 'manage', 'Kural ayarlarını yönet'),
  perm('management', 'approval', 'read', 'Onay taleplerini görüntüle'),
  perm('management', 'approval', 'create', 'Onay talebi oluştur'),
  perm('management', 'approval', 'decide', 'Onay talebini karara bağla'),
  // --- management: şantiye (saha) kayıtları — kokpit hava durumu şehir kaynağı ---
  perm('management', 'site', 'read', 'Şantiyeleri görüntüle'),
  perm('management', 'site', 'create', 'Şantiye oluştur'),
  perm('management', 'site', 'update', 'Şantiye güncelle'),
  perm('management', 'site', 'delete', 'Şantiye sil'),

  // --- integrations (Faz 8 — webhook altyapısı) ---
  perm('integrations', 'integration', 'read', 'Entegrasyonları görüntüle'),
  perm('integrations', 'integration', 'manage', 'Entegrasyon yönet'),
  perm('integrations', 'webhook', 'read', 'Webhook olaylarını görüntüle'),
  perm('integrations', 'webhook', 'receive', 'Webhook olayı al'),
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
