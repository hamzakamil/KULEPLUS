-- Down migration for 202610540000_subledger_accounts.sql (SPEC §30.7: down zorunlu)
-- Bu migration'ın açtığı (deterministik id'li) alt hesaplar hareketsizse silinir.
DELETE FROM accounting_accounts a
 USING cash_bank_accounts c
 WHERE c.accounting_account_id = a.id
   AND a.is_tdphp = false
   AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.account_id = a.id)
   AND a.id = (substr(md5('subledger:cash_bank:' || c.id::text),1,8)||'-'||substr(md5('subledger:cash_bank:' || c.id::text),9,4)||'-'||
               substr(md5('subledger:cash_bank:' || c.id::text),13,4)||'-'||substr(md5('subledger:cash_bank:' || c.id::text),17,4)||'-'||
               substr(md5('subledger:cash_bank:' || c.id::text),21,12))::uuid;

DELETE FROM accounting_accounts a
 USING credit_cards k
 WHERE k.accounting_account_id = a.id
   AND a.is_tdphp = false
   AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.account_id = a.id)
   AND a.id = (substr(md5('subledger:credit_card:' || k.id::text),1,8)||'-'||substr(md5('subledger:credit_card:' || k.id::text),9,4)||'-'||
               substr(md5('subledger:credit_card:' || k.id::text),13,4)||'-'||substr(md5('subledger:credit_card:' || k.id::text),17,4)||'-'||
               substr(md5('subledger:credit_card:' || k.id::text),21,12))::uuid;

ALTER TABLE invoice_payments DROP COLUMN IF EXISTS credit_card_id;
ALTER TABLE invoice_payments DROP COLUMN IF EXISTS cash_bank_account_id;
ALTER TABLE credit_cards DROP COLUMN IF EXISTS accounting_account_id;
ALTER TABLE cash_bank_accounts DROP COLUMN IF EXISTS accounting_account_id;
