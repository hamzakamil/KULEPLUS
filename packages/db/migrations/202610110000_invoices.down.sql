-- Down migration for 202610110000_invoices.sql

DROP POLICY IF EXISTS invoice_payments_tenant_isolation ON invoice_payments;
DROP POLICY IF EXISTS invoice_lines_tenant_isolation ON invoice_lines;
DROP POLICY IF EXISTS invoices_tenant_isolation ON invoices;
DROP POLICY IF EXISTS invoice_sequences_tenant_isolation ON invoice_sequences;
DROP POLICY IF EXISTS tax_rates_tenant_isolation ON tax_rates;

ALTER TABLE IF EXISTS invoice_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invoice_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invoice_sequences DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tax_rates DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS invoice_payments;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS invoice_sequences;
DROP TABLE IF EXISTS tax_rates;