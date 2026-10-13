-- Down: 202610140000_cash_bank_fix_and_reports
DROP TABLE IF EXISTS report_generations;

ALTER TABLE cash_bank_movements DROP COLUMN IF EXISTS target_account_id;

ALTER TABLE cash_bank_accounts DROP CONSTRAINT IF EXISTS cash_bank_accounts_status_check;
ALTER TABLE cash_bank_accounts
  ADD CONSTRAINT cash_bank_accounts_status_check
  CHECK (status IN ('active', 'inactive'));

ALTER TABLE cash_bank_accounts DROP COLUMN IF EXISTS opening_balance;
