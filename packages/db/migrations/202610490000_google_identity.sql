-- ADR-0023: Kendi kendine kayıt + Google ile giriş.
--
-- Neden bu migration?
--   1) Google ile gelen kullanıcının parolası OLMAZ. `users.password_hash NOT NULL`
--      olduğu sürece böyle bir hesap açılamıyordu → kolon nullable'a alınıyor.
--      Parola girişi yalnızca `password_hash IS NOT NULL` hesaplarda geçerlidir
--      (`identity/service.ts` → login()), sağlayıcı girişi buna bağımlı değildir.
--   2) Sağlayıcı kimliği kalıcı olarak saklanmalı: aynı Google hesabı ikinci
--      girişinde YENİ kullanıcı açılmaması gerekir. E-posta anahtar olamaz
--      (değişebilir / alan adı devredilebilir), kalıcı anahtar Google `sub`'udur.
--   3) `users` tablosunda isim yoktu; giriş yanıtı e-posta önekini isim olarak
--      uyduruyordu. Kayıt formunda ve Google profilinde gelen isim artık saklanır.
--
-- Tablo geneldir (tenant_id YOK): `users` gibi kimlik katmanıdır (SPEC §4.1);
-- şirket bağlanması `tenant_users` üzerinden çözülür.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;

CREATE TABLE IF NOT EXISTS user_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google')),
  /** Sağlayıcı tarafındaki kalıcı kimlik (Google `sub`) — e-posta değil. */
  provider_account_id text NOT NULL,
  /** Doğrulama anındaki e-posta (doğrulanmış kabul edilir — servis tarafında denetlenir). */
  email text NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_identities_provider_account_unique UNIQUE (provider, provider_account_id),
  /** Bir kullanıcının aynı sağlayıcıdan tek kimliği olur. */
  CONSTRAINT user_identities_user_provider_unique UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
