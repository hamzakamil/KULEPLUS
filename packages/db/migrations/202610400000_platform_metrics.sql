-- Faz 4 (SPEC §8.9): günlük platform gelir metrikleri snapshot'ı
--
-- Tenant verisi DEĞİL: işletmeci tarafı ticari metriklerdir; RLS YOKTUR
-- (platform tabloları deseni: tenants/plans/prices gibi).
-- Snapshot hesabı app_migrator (tablo sahibi) ile yapılır: RLS politikaları
-- tablo sahibini bağlamadığı için tüm tenant abonelikleri okunabilir.
--
-- Metrik tanımları ayrıdır (SPEC §8.9): Tahsilat ≠ Net nakit girişi ≠
-- Faturalanan tutar ≠ MRR ≠ ARR. Bu tablo yalnızca TAahhüt bazlı MRR/ARR ve
-- abonelik hareketlerini (yeni/ayrılan) tutar; tahsilat verisi içermez.
--
-- Down: 202610400000_platform_metrics.down.sql

CREATE TABLE IF NOT EXISTS platform_metrics_daily (
  metric_date date PRIMARY KEY,
  currency char(3) NOT NULL DEFAULT 'TRY',
  mrr numeric(14,2) NOT NULL DEFAULT 0,
  arr numeric(14,2) NOT NULL DEFAULT 0,
  active_subscriptions int NOT NULL DEFAULT 0,
  new_subscriptions int NOT NULL DEFAULT 0,
  churned_subscriptions int NOT NULL DEFAULT 0,
  plan_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_metrics_daily_date
  ON platform_metrics_daily (metric_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_metrics_daily TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_metrics_daily TO app_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_metrics_daily TO app_migrator;
