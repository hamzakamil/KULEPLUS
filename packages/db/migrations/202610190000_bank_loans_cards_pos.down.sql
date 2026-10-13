-- Down: 202610190000_bank_loans_cards_pos
DROP POLICY IF EXISTS pos_accounts_tenant_isolation ON pos_accounts;
DROP POLICY IF EXISTS credit_cards_tenant_isolation ON credit_cards;
DROP POLICY IF EXISTS bank_loans_tenant_isolation ON bank_loans;
DROP TABLE IF EXISTS pos_accounts;
DROP TABLE IF EXISTS credit_cards;
DROP TABLE IF EXISTS bank_loans;