-- Down migration for 202610580000_expense_ledger.sql (SPEC §30.7: down zorunlu)
DROP INDEX IF EXISTS idx_invoices_supplier_document;
DROP INDEX IF EXISTS idx_expenses_document;
ALTER TABLE invoices DROP COLUMN IF EXISTS supplier_document_no;
ALTER TABLE expenses
    DROP COLUMN IF EXISTS posted_at,
    DROP COLUMN IF EXISTS payment_source_id,
    DROP COLUMN IF EXISTS payment_source_type,
    DROP COLUMN IF EXISTS counterparty_tax_number,
    DROP COLUMN IF EXISTS counterparty_name,
    DROP COLUMN IF EXISTS tax_amount,
    DROP COLUMN IF EXISTS tax_rate,
    DROP COLUMN IF EXISTS net_amount;
