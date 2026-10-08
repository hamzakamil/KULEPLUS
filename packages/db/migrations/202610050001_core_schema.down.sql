-- Down: 202610050001_core_schema.sql (SPEC §30.7: down SQL zorunlu)

DROP TABLE IF EXISTS usage_counters;
DROP TABLE IF EXISTS tenant_module_settings;
DROP TABLE IF EXISTS tenant_entitlements;
DROP TABLE IF EXISTS prices;
DROP TABLE IF EXISTS plan_limits;
DROP TABLE IF EXISTS plan_features;
DROP TABLE IF EXISTS plan_versions;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS features;
DROP TABLE IF EXISTS modules;

DROP TABLE IF EXISTS legal_acceptances;
DROP TABLE IF EXISTS legal_texts;

DROP TABLE IF EXISTS audit_logs;

DROP TABLE IF EXISTS tenant_settings;

DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;

DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS branches;

DROP TABLE IF EXISTS tenant_invitations;
DROP TABLE IF EXISTS tenant_users;
DROP TABLE IF EXISTS tenants;

DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;
