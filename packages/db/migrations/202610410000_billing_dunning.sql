-- Faz 4 Hat B: Billing dunning — başarısız ödeme yeniden deneme (SPEC §8.7/§8.8).
-- Yaşam döngüsü: active → past_due (ödeme başarısız) → 1/3/7. gün yeniden deneme →
-- üç deneme de başarısız + ek süre dolmuş → suspended (ücretsiz plana düşürme).
-- Bildirim outbox üzerinden (e-posta) gönderilir; yeniden deneme provider.charge ile
-- denenir (mock provider K-08'den bağımsız; iyzico hosted akış sandbox anahtar gerektirir).
-- UUID v7 uygulama tarafında (newId()); tenant tablosu RLS'li.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS
    grace_period_until timestamptz;

CREATE TABLE IF NOT EXISTS dunning_attempts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES commercial_orders(id) ON DELETE CASCADE,
    attempt_no int NOT NULL CHECK (attempt_no BETWEEN 1 AND 3),
    scheduled_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'skipped')),
    provider_ref text,
    detail text,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (subscription_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_dunning_attempts_due
    ON dunning_attempts (status, scheduled_at);

-- RLS (tenant tablosu — payment_attempts deseni)
ALTER TABLE dunning_attempts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema() AND tablename = 'dunning_attempts'
      AND policyname = 'dunning_attempts_tenant_isolation'
  ) THEN
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      'dunning_attempts_tenant_isolation', 'dunning_attempts'
    );
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON dunning_attempts TO app_user;
