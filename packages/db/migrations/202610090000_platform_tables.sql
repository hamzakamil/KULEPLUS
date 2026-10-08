-- Faz 1: Platform yönetimi (SPEC §5.1, ADR-0003)
-- - Tek platform_owner (kısmi unique index)
-- - platform_roles + platform_user_roles
-- - platform_settings: singleton DEĞİL (key-value)
-- - support_access_grants: çapraz tenant erişimi (süreli + gerekçeli + audit'li)
-- Down: 202610090000_platform_tables.down.sql

-- ===== PLATFORM KULLANICILARI =====
CREATE TABLE platform_users (
  id uuid PRIMARY KEY,                              -- UUID v7 (uygulama üretir)
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_platform_owner boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_users_user_id_unique UNIQUE (user_id)
);

-- Tek aktif platform_owner (ADR-0003, SPEC §5.1)
CREATE UNIQUE INDEX uq_platform_owner
  ON platform_users (is_platform_owner)
  WHERE is_platform_owner = TRUE;

-- ===== PLATFORM ROLLERİ =====
CREATE TABLE platform_roles (
  code text PRIMARY KEY,                            -- platform_support | platform_sales | platform_finance | platform_readonly
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_user_roles (
  platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES platform_roles(code) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  PRIMARY KEY (platform_user_id, role_code)
);

-- ===== PLATFORM AYARLARI (singleton değil — key/value) =====
CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES platform_users(id) ON DELETE SET NULL
);

-- ===== DESTEK ERİŞİM GRANTLARI (çapraz tenant — SPEC §5.1) =====
CREATE TABLE support_access_grants (
  id uuid PRIMARY KEY,                              -- UUID v7
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  reason text NOT NULL,                             -- gerekçe zorunlu
  scope text NOT NULL DEFAULT 'read_only' CHECK (scope IN ('read_only', 'read_write')),
  granted_by uuid NOT NULL REFERENCES platform_users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,                  -- süre zorunlu
  revoked_at timestamptz,
  revoked_by uuid REFERENCES platform_users(id) ON DELETE SET NULL
);
CREATE INDEX idx_support_access_grants_tenant ON support_access_grants(tenant_id);
CREATE INDEX idx_support_access_grants_platform_user ON support_access_grants(platform_user_id);
CREATE INDEX idx_support_access_grants_expires ON support_access_grants(expires_at);

-- ===== SEED: platform rolleri =====
INSERT INTO platform_roles (code, name, description) VALUES
  ('platform_support', 'Platform Destek', 'Destek erişimi (grant ile)'),
  ('platform_sales', 'Platform Satış', 'Satış ve teklif yönetimi'),
  ('platform_finance', 'Platform Finans', 'Tahsilat ve faturalama'),
  ('platform_readonly', 'Platform Salt Okuma', 'Yalnızca görüntüleme')
ON CONFLICT (code) DO NOTHING;

-- ===== GRANTS =====
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_users, platform_roles, platform_user_roles, platform_settings, support_access_grants TO app_user;

-- ===== RLS: platform tabloları tenant izolasyonu DIŞINDA =====
-- platform_users/platform_roles/platform_user_roles/platform_settings: gerçek global (SPEC §7.0)
-- support_access_grants tenant_id taşır ve app.tenant_id bağlamına bağlıdır.
ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_grant_tenant_isolation ON support_access_grants;
CREATE POLICY support_grant_tenant_isolation ON support_access_grants
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
