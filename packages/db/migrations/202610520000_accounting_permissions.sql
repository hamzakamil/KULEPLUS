-- Muhasebe çekirdeği Faz 2 — yetki kataloğu genişletme (A4).
-- Kaynak: packages/shared/src/permissions.ts (TEK KAYNAK). Muhasebe uçlarının büyük çoğunluğu
-- yetki kontrolsüzdü; hesap/dönem/eşleme/rapor için ayrı izinler tanımlanır.
-- Not: owner (is_owner) tüm izinleri taşır. Diğer roller bu izinleri rol yönetiminden almalıdır.

INSERT INTO permissions (id, module, resource, action, code, name, delegatable, is_system_permission)
SELECT
  (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
  v.module, v.resource, v.action, v.code, v.name, v.delegatable, v.is_system_permission
FROM (
  VALUES
  ('accounting', 'account', 'read', 'accounting.account.read', 'Hesap planını görüntüle', true, true),
  ('accounting', 'account', 'manage', 'accounting.account.manage', 'Hesap planını yönet (ekle/düzenle/pasife al/kur)', true, true),
  ('accounting', 'period', 'read', 'accounting.period.read', 'Mali dönem ve kilitleri görüntüle', true, true),
  ('accounting', 'period', 'manage', 'accounting.period.manage', 'Mali dönem tanımla/düzenle', true, true),
  ('accounting', 'period', 'close', 'accounting.period.close', 'Dönemi kapat/aç ve dönem kilidi koy/kaldır', false, true),
  ('accounting', 'mapping', 'read', 'accounting.mapping.read', 'Hesap eşleme ve posting kurallarını görüntüle', true, true),
  ('accounting', 'mapping', 'manage', 'accounting.mapping.manage', 'Hesap eşleme ve posting kurallarını yönet', true, true),
  ('accounting', 'report', 'read', 'accounting.report.read', 'Mizan, bilanço, gelir tablosu raporlarını görüntüle', true, true)
) AS v(module, resource, action, code, name, delegatable, is_system_permission)
CROSS JOIN LATERAL (SELECT md5('permission:' || v.code) AS h) m
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;
