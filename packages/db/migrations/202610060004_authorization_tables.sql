-- Faz 1: Kullanıcı-Rol ve Kullanıcı-Departman ilişkileri (Yetki)
-- SPEC §6.6, §6.7
-- Down: 202610060004_authorization_tables.down.sql

-- ===== CORE: KULLANICI - ROL İLİŞKİSİ =====
CREATE TABLE tenant_user_roles (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (tenant_id, user_id, role_id)
);
CREATE INDEX idx_tenant_user_roles_user_id ON tenant_user_roles(user_id);

-- ===== CORE: KULLANICI - DEPARTMAN İLİŞKİSİ =====
CREATE TABLE tenant_user_departments (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (tenant_id, user_id, department_id)
);
CREATE INDEX idx_tenant_user_departments_user_id ON tenant_user_departments(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_user_roles, tenant_user_departments TO app_user;
