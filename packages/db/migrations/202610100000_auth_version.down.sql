-- Down: 202610100000_auth_version.sql geri alma (SPEC §30.7)

DROP INDEX IF EXISTS idx_tenants_auth_version;
ALTER TABLE tenants DROP COLUMN IF EXISTS auth_version;
ALTER TABLE users DROP COLUMN IF EXISTS auth_version;
