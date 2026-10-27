-- Down migration for 202610600000_edefter_core.sql (SPEC §30.7: down zorunlu)
DROP TABLE IF EXISTS edefter_parts;
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_document_kind_check;
ALTER TABLE expenses DROP COLUMN IF EXISTS document_kind_description, DROP COLUMN IF EXISTS document_kind;
ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS journal_lines_document_type_check;
ALTER TABLE journal_lines
    DROP COLUMN IF EXISTS payment_method, DROP COLUMN IF EXISTS document_date,
    DROP COLUMN IF EXISTS document_number, DROP COLUMN IF EXISTS document_type_description,
    DROP COLUMN IF EXISTS document_type;
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_document_type_check;
ALTER TABLE journal_entries
    DROP COLUMN IF EXISTS payment_method, DROP COLUMN IF EXISTS document_date,
    DROP COLUMN IF EXISTS document_number, DROP COLUMN IF EXISTS document_type_description,
    DROP COLUMN IF EXISTS document_type;
