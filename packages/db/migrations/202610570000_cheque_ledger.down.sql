-- Down migration for 202610570000_cheque_ledger.sql (SPEC §30.7: down zorunlu)
-- Not: 'pledged' / yeni hareket türlerini kullanan kayıt varsa kısıt geri yüklenemez;
-- önce bu kayıtlar düzeltilmelidir.
ALTER TABLE cheque_transactions DROP CONSTRAINT IF EXISTS cheque_transactions_transaction_type_check;
ALTER TABLE cheque_transactions ADD CONSTRAINT cheque_transactions_transaction_type_check
    CHECK (transaction_type = ANY (ARRAY['created'::text, 'endorsed'::text, 'collected'::text, 'bounced'::text, 'cancelled'::text, 'note'::text]));
ALTER TABLE cheque_portfolio DROP CONSTRAINT IF EXISTS cheque_portfolio_holder_check;
ALTER TABLE cheque_portfolio ADD CONSTRAINT cheque_portfolio_holder_check
    CHECK (holder = ANY (ARRAY['own'::text, 'bank'::text, 'customer'::text, 'supplier'::text]));
ALTER TABLE cheques DROP CONSTRAINT IF EXISTS cheques_portfolio_holder_check;
ALTER TABLE cheques ADD CONSTRAINT cheques_portfolio_holder_check
    CHECK (portfolio_holder = ANY (ARRAY['own'::text, 'bank'::text, 'customer'::text, 'supplier'::text]));
