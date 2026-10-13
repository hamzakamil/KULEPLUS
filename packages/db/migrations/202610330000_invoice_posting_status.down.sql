-- Down: 202610330000_invoice_posting_status.down.sql
DROP INDEX IF EXISTS idx_invoices_posting_status;
ALTER TABLE invoices DROP COLUMN IF EXISTS posted_at;
ALTER TABLE invoices DROP COLUMN IF EXISTS posting_status;
