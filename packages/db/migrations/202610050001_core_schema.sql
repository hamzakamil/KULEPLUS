-- Faz 1: Kimlik, Şirket, Yetki, Entitlement, Audit, Yasal metinler
-- SPEC §4, §5, §6, §8, §27, ADR-0011
-- Down: 202610050001_core_schema.down.sql

-- ===== EXTENSIONS =====
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== CORE: KİMLİK =====
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_verified_at timestamptz,
  password_hash text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_login_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  totp_secret text,
  recovery_codes text[],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,
  user_agent text,
  ip_address text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_refresh_token_hash ON user_sessions(refresh_token_hash);

-- ===== CORE: ŞİRKET (TENANT) =====
CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  trade_name text,
  tax_office text,
  tax_number text,
  currency char(3) NOT NULL DEFAULT 'TRY',
  fiscal_year_start smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
  timezone text NOT NULL DEFAULT 'Europe/Istanbul',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','closed','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE tenant_users (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE tenant_invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role_ids uuid[] NOT NULL DEFAULT '{}',
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_tenant_invitations_token_hash ON tenant_invitations(token_hash);

-- ===== CORE: ORGANİZASYON =====
CREATE TABLE branches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_branches_tenant_id ON branches(tenant_id);

CREATE TABLE departments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text,
  manager_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_departments_tenant_id ON departments(tenant_id);

-- ===== CORE: YETKİ =====
CREATE TABLE roles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  is_system boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_tenant_name_unique UNIQUE (tenant_id, name)
);
CREATE INDEX idx_roles_tenant_id ON roles(tenant_id);

CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  module text NOT NULL,
  resource text NOT NULL,
  action text NOT NULL,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_system_permission boolean NOT NULL DEFAULT false,
  delegatable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_permissions_module ON permissions(module);

CREATE TABLE role_permissions (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'all',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_id, permission_id)
);

-- ===== CORE: TENANT AYARLARI =====
CREATE TABLE tenant_settings (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- ===== CORE: DENETİM (AUDIT) =====
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- ===== CORE: YASAL METİNLER (ADR-0011) =====
CREATE TABLE legal_texts (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  version text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legal_acceptances (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_text_id uuid NOT NULL REFERENCES legal_texts(id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  CONSTRAINT legal_acceptances_user_text_unique UNIQUE (user_id, legal_text_id)
);

-- ===== ABONELİK / ENTITLEMENT (Faz 1 — SPEC §8.2) =====
CREATE TABLE modules (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  is_core boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE features (
  id uuid PRIMARY KEY,
  module_code text NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  UNIQUE (module_code, code)
);

CREATE TABLE plans (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_versions (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  version int NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version)
);

CREATE TABLE plan_features (
  plan_version_id uuid NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  included boolean NOT NULL DEFAULT true,
  PRIMARY KEY (plan_version_id, feature_id)
);

CREATE TABLE plan_limits (
  plan_version_id uuid NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  limit_key text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (plan_version_id, limit_key)
);

CREATE TABLE prices (
  id uuid PRIMARY KEY,
  plan_version_id uuid NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  currency char(3) NOT NULL DEFAULT 'TRY',
  amount_monthly numeric(12,2),
  amount_yearly numeric(12,2),
  vat_included boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz
);

CREATE TABLE tenant_entitlements (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_code text NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  plan_version_id uuid REFERENCES plan_versions(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module_code)
);
CREATE INDEX idx_tenant_entitlements_status ON tenant_entitlements(status);

CREATE TABLE tenant_module_settings (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_code text NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module_code, key)
);

CREATE TABLE usage_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  limit_key text NOT NULL,
  period_start timestamptz NOT NULL,
  count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, limit_key, period_start)
);
CREATE INDEX idx_usage_counters_period ON usage_counters(period_start);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
