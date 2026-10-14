-- Down: 202610430000_operator_tenant.down.sql
DROP INDEX IF EXISTS uq_tenants_single_operator;
ALTER TABLE tenants DROP COLUMN IF EXISTS is_operator;
