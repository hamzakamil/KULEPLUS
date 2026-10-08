-- Faz 1: Add onboarding_mode to tenant_settings
-- Down: 202610060003_tenant_settings_onboarding_mode.down.sql

ALTER TABLE tenant_settings 
ADD COLUMN IF NOT EXISTS onboarding_mode text NOT NULL DEFAULT 'manual' CHECK (onboarding_mode IN ('auto', 'manual', 'hybrid'));

COMMENT ON COLUMN tenant_settings.onboarding_mode IS 'Onboarding mode: auto | manual | hybrid (default: manual)';