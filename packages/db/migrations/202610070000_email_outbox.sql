-- Faz 1: Email Outbox — Outbox pattern for reliable email delivery
-- SPEC §27.4 (centralized log), §29.1 (email provider adapter)
-- Up: email_outbox tablosu, DOWN: tablo ve veriler silinir

-- ===== EMAIL OUTBOX TABLE =====
CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY,
  "to" text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  text text,
  provider_ref text NOT NULL,
  response text,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- Indexler için optimize edilmiş sorgular
CREATE INDEX IF NOT EXISTS idx_email_outbox_status_next ON email_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_sent ON email_outbox(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_provider ON email_outbox(provider_ref);

-- Row-level security
GRANT SELECT, INSERT, UPDATE, DELETE ON email_outbox TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;