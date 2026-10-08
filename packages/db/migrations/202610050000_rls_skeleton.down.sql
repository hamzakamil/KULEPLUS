-- Down: 20261005000000_rls_skeleton.sql (SPEC §30.7: down SQL zorunlu)

DROP POLICY IF EXISTS tenant_isolation ON demo_items;
DROP TABLE IF EXISTS demo_items;
DROP FUNCTION IF EXISTS app.current_tenant_id();
