-- Down migration for 202610560000_withholding_returns_defaults.sql (SPEC §30.7: down zorunlu)
-- Not: tohumlanan KDV oranları ve gider kategorileri faturalarda kullanılmış olabileceği için
-- silinmez; yalnızca şema geri alınır.
ALTER TABLE invoices DROP COLUMN IF EXISTS returned_amount;
ALTER TABLE invoices DROP COLUMN IF EXISTS withholding_total;
ALTER TABLE invoice_lines DROP COLUMN IF EXISTS withholding_amount;
ALTER TABLE invoice_lines DROP COLUMN IF EXISTS withholding_kdv2_code;
ALTER TABLE invoice_lines DROP COLUMN IF EXISTS withholding_einvoice_code;
ALTER TABLE invoice_lines DROP COLUMN IF EXISTS withholding_type_id;
DROP TABLE IF EXISTS withholding_types;
