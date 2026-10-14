-- 202610390000_current_tenant_id_public.sql — down
DROP FUNCTION IF EXISTS public.current_tenant_id();
REVOKE USAGE ON SCHEMA app FROM app_user, app_platform;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM app_user, app_platform;

