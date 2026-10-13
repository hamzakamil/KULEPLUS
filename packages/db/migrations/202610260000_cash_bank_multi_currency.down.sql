-- Faz 6.3 rollback: cash_bank multi-currency kolonları kaldır

-- ===== cash_bank_movements: exchange_rate ve base_amount kaldır =====
ALTER TABLE cash_bank_movements
  DROP COLUMN IF EXISTS base_amount,
  DROP COLUMN IF EXISTS exchange_rate;

-- ===== cash_bank_accounts: base_currency kaldır =====
ALTER TABLE cash_bank_accounts
  DROP COLUMN IF EXISTS base_currency;

-- ===== İndeksler =====
DROP INDEX IF EXISTS idx_cash_bank_movements_currency;
DROP INDEX IF EXISTS idx_cash_bank_movements_base_amount;