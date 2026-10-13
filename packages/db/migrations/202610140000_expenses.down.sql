-- Down: 202610140000_expenses (Faz 5 — Gider Modülü)
-- Bağımlılık sırasına dikkat: expense_payments → expenses (FK) → expense_categories.
DROP TABLE IF EXISTS expense_payments;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS expense_categories;
