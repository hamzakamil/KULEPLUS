-- Down migration for tenant_settings onboarding_mode
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS onboarding_mode;