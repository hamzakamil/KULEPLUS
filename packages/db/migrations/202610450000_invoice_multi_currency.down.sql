-- Faz 6.5 rollback: dövizli fatura kolonları kaldır
ALTER TABLE invoices
  DROP COLUMN IF EXISTS base_total,
  DROP COLUMN IF EXISTS rate_date;

DROP INDEX IF EXISTS idx_invoices_base_total;
DROP INDEX IF EXISTS idx_invoices_rate_date;
