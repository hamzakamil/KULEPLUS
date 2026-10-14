-- Faz 6.6 rollback: ödeme kuru / TRY karşılık kolonları kaldır
ALTER TABLE invoice_payments
  DROP COLUMN IF EXISTS base_amount,
  DROP COLUMN IF EXISTS exchange_rate;