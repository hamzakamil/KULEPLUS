-- Faz 0: Üç ayrı DB rolü (SPEC §7.1)
-- app_migrator: migration çalıştırır (şema sahibi)
-- app_user:     uygulama kullanıcısı — ASLA BYPASSRLS ALMAZ
-- app_platform: platform verisi (tenant dışı) erişimi
--
-- Not: parolalar CI/dev için CHANGE_ME'dir. Üretimde SOPS/Doppler'dan gelir.
-- docker-entrypoint DOĞRUDAN ÇALIŞTIRMA veya CI psql adımı ile uygulanır.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator LOGIN PASSWORD 'CHANGE_ME';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'CHANGE_ME' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform LOGIN PASSWORD 'CHANGE_ME' NOBYPASSRLS;
  END IF;
END $$;

ALTER DATABASE erp_db OWNER TO app_migrator;

GRANT CONNECT ON DATABASE erp_db TO app_user, app_platform;
GRANT USAGE ON SCHEMA public TO app_user, app_platform;
GRANT CREATE ON SCHEMA public TO app_migrator;

-- Varsayılan yetkiler: tablolar app_migrator'a aittir;
-- app_user'a RLS politikaları üzerinden kontrollü grant verilir (Faz 1/RLS iskeleti).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT
  ON SEQUENCES TO app_user;
