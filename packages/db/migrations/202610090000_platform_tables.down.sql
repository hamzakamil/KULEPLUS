-- Down: 202610090000_platform_tables.sql geri alma (SPEC §30.7)
-- Bağımlılık sırası: önce child tablolar, sonra parent.

DROP TABLE IF EXISTS support_access_grants;
DROP TABLE IF EXISTS platform_settings;
DROP TABLE IF EXISTS platform_user_roles;
DROP TABLE IF EXISTS platform_roles;
DROP TABLE IF EXISTS platform_users;
