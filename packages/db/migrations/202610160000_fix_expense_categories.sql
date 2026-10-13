-- Fix: expense_categories missing created_by, updated_by columns
-- These are required by the service but missing from the table

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id);

-- Also add version column for consistency with expenses table
ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS version bigint DEFAULT 0;

-- Update existing rows to have version = 0
UPDATE expense_categories SET version = 0 WHERE version IS NULL;