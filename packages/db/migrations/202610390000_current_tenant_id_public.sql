-- current_tenant_id() şemasız çağrılar için public wrapper + app şeması erişimi
-- (SPEC §7 RLS iskeleti tamamlayıcısı)
--
-- Sorun 1 (42883): app.current_tenant_id() yalnızca app şemasında tanımlı; uygulama
-- sorguları (ör. contacts service) current_tenant_id() ŞEMASIZ çağırır. app_user'ın
-- search_path'i ($user, public) app şemasını içermediğinden fonksiyon bulunamıyordu.
-- Çözüm: public şemasına app.current_tenant_id() delege eden ince wrapper. Tek gerçek
-- implementasyon app.current_tenant_id() olarak kalır; RLS politikaları zaten
-- şema-qualified çağrı yapar ve değişmez.
--
-- Sorun 2 (42506): 01-roles.sql yalnızca public şemasına USAGE vermişti. RLS
-- politikaları app.current_tenant_id() çağırdığı için tabloya erişen rollerin
-- (app_user, app_platform) app şemasında USAGE hakkı OLMADAN politikalar da
-- "permission denied for schema app" ile patlar.

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT app.current_tenant_id()
$$;

-- RLS politikalarının değerlendirmesi için şema erişimi + execute hakları (idempotent).
GRANT USAGE ON SCHEMA app TO app_user, app_platform;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO app_user, app_platform;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO app_user, app_platform;

