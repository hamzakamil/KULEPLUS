-- Down: 202610610000_bank_card_loan_ledgers
DROP POLICY IF EXISTS bank_loan_installments_tenant_isolation ON bank_loan_installments;
DROP POLICY IF EXISTS credit_card_transactions_tenant_isolation ON credit_card_transactions;
DROP TABLE IF EXISTS bank_loan_installments;
DROP TABLE IF EXISTS credit_card_transactions;
