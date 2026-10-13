-- Faz 8 — Webhook altyapısı (SPEC §20, ROADMAP §Faz 8).
-- Genel webhook olayları, entegrasyon kimlik bilgileri ve harici eşleştirmeler.
-- provider_webhook_events (subscription) ile karıştırılmamalı: bu tablolar
-- entegrasyon modülüne aittir ve tenant izolasyonu uygulanır.

CREATE TABLE IF NOT EXISTS integrations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider text NOT NULL,
    display_name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS webhook_events (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    external_event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    signature text,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (integration_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS integration_credentials (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    credential_type text NOT NULL CHECK (credential_type IN ('api_key', 'oauth2', 'hmac_secret', 'basic')),
    encrypted_value text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_mappings (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    external_id text NOT NULL,
    internal_type text NOT NULL,
    internal_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (integration_id, external_id, internal_type)
);

-- RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['webhook_events', 'integration_credentials', 'external_mappings', 'integrations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant ON webhook_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_integration ON webhook_events(integration_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(tenant_id, processed_at);
CREATE INDEX IF NOT EXISTS idx_integration_credentials_tenant ON integration_credentials(tenant_id);
CREATE INDEX IF NOT EXISTS idx_external_mappings_tenant ON external_mappings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_external_mappings_lookup ON external_mappings(integration_id, external_id, internal_type);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_events, integration_credentials, external_mappings, integrations TO app_user;
