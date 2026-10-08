-- Faz 0: RLS iskeleti (SPEC §7)
-- - app.current_tenant_id(): transaction-local bağlam (set_config 'app.tenant_id')
-- - demo_items: iskelet politika örneği; Faz 1'de gerçek modül tablolarına taşınacak.
--
-- Down SQL zorunludur (SPEC §30.7): 20261005000000_rls_skeleton.down.sql

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- İskele örnek tablosu (Faz 1'de gerçek modül tablolarıyla değiştirilecek)
CREATE TABLE IF NOT EXISTS demo_items (
  id uuid PRIMARY KEY,          -- uygulama tarafı UUID v7 doldurur; gen_random_uuid() kullanılmaz
  tenant_id uuid NOT NULL,
  name text NOT NULL
);

ALTER TABLE demo_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON demo_items;

CREATE POLICY tenant_isolation ON demo_items
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

-- app_user bu tabloya RLS politikası üzerinden erişir (BYPASSRLS yok — SPEC §7.1)
GRANT SELECT, INSERT, UPDATE, DELETE ON demo_items TO app_user;
