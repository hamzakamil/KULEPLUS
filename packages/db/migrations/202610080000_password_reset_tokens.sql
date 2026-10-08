-- Faz 1: Password Reset Tokens — Kimlik güvenliği
-- Down: 202610080000_password_reset_tokens.down.sql

-- ===== ŞİFİRE SıFIRLAMA TOKENLARI =====
CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_tokens_token_hash_unique UNIQUE (token_hash)
);
CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- Row-level security
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO app_user;
