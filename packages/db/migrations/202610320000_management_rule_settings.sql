-- Faz 7 (T-7.5): Kural motoru parametre deposu.
-- Hazır kurallar kod icindedir; tenant bazli parametreler (esik degerleri) burada tutulur.
-- SPEC §26: dashboard verileri ana is tablolarindan sorgulanir; kural parametreleri ayri tablo.
CREATE TABLE IF NOT EXISTS management_rule_settings (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_key text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    params jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, rule_key)
);

ALTER TABLE management_rule_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY management_rule_settings_tenant_isolation ON management_rule_settings
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_management_rule_settings_tenant
    ON management_rule_settings(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON management_rule_settings TO app_user;

-- ======================= Permission katalog senkronu =======================
INSERT INTO permissions (module, resource, action, code, name, delegatable, is_system_permission) VALUES
  ('management', 'rule', 'read', 'management.rule.read', 'Kural ayarlarini goruntule', true, true),
  ('management', 'rule', 'manage', 'management.rule.manage', 'Kural ayarlarini yonet', true, true)
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;
