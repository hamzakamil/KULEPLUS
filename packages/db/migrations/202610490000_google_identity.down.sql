-- ADR-0023 rollback: sağlayıcı kimlikleri ve `users` üzerindeki değişiklikler geri alınır.
--
-- DİKKAT (bilinçli olarak başarısız olabilir): yalnızca Google ile giriş yapmış
-- kullanıcılar varsa `password_hash` boş kalır ve SET NOT NULL PostgreSQL tarafından
-- reddedilir. Bu kasıtlıdır — geri alma uğruna hesap silinmez. Önce bu hesapları
-- kapalı durum alın ya da parola tanımlayın, sonra tekrar deneyin.

DROP TABLE IF EXISTS user_identities;

ALTER TABLE users DROP COLUMN IF EXISTS display_name;

ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
