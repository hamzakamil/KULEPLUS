-- Faz 1: Yetki sürümlemesi (SPEC §6.4)
-- "Yetki değişiklikleri oturum ve cache sürümlemesiyle etkili olur."
-- Kullanıcının auth_version'ı JWT'ye gömülür; rol/izin değişikliğinde artırılır.
-- Eski token'ın auth_version'ı güncel değeriyle uyuşmazsa 401 → kullanıcı yeniden giriş yapar.
-- Down: 202610100000_auth_version.down.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1;

-- Tenant bazlı yetki sürümü: rol/izin değişikliğinde tenant'ın tüm oturumları etkilenir.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_tenants_auth_version ON tenants(auth_version);
