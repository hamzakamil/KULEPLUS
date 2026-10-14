-- Faz 7: Patron Görünümü v3 trafik ışığı göstergeleri için izin senkronu.
-- Kaynak: packages/shared/src/permissions.ts (TEK KAYNAK — SPEC §6.5, ADR-0006).
-- Not: Owner tüm izinlere sahiptir (SPEC §6.6); diğer roller bu izni ayrıca alabilir.
-- Deterministik UUID: ADR-0002 (id deterministik üretilir; gen_random_uuid() yasak).
-- id = md5('permission:' || code) → tireli uuid cast (expense_categories deseni).
INSERT INTO permissions (id, module, resource, action, code, name, delegatable, is_system_permission)
SELECT
  (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
  v.module, v.resource, v.action, v.code, v.name, v.delegatable, v.is_system_permission
FROM (
  VALUES
  ('management', 'dashboard', 'read', 'management.dashboard.read', 'Patron paneli göstergelerini görüntüle', true, true)) AS v(module, resource, action, code, name, delegatable, is_system_permission)
CROSS JOIN LATERAL (SELECT md5('permission:' || v.code) AS h) m
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;
