-- Down: 202610160000_fix_expense_categories
-- Eklenen sütunlar geri alınır (kolon ekleyen fix — veri kaybı yok).
ALTER TABLE expense_categories DROP COLUMN IF EXISTS created_by;
ALTER TABLE expense_categories DROP COLUMN IF EXISTS updated_by;
ALTER TABLE expense_categories DROP COLUMN IF EXISTS version;
