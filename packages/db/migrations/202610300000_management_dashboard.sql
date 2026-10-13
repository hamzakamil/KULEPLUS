-- Faz 7: Patron Görünümü v3 trafik ışığı göstergeleri için izin senkronu.
-- Kaynak: packages/shared/src/permissions.ts (TEK KAYNAK — SPEC §6.5, ADR-0006).
-- Not: Owner tüm izinlere sahiptir (SPEC §6.6); diğer roller bu izni ayrıca alabilir.
INSERT INTO permissions (module, resource, action, code, name, delegatable, is_system_permission) VALUES
  ('management', 'dashboard', 'read', 'management.dashboard.read', 'Patron paneli göstergelerini görüntüle', true, true)
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;
