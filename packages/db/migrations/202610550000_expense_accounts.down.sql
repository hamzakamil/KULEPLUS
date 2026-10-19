-- Down migration for 202610550000_expense_accounts.sql (SPEC §30.7: down zorunlu)
DELETE FROM accounting_accounts a
 USING expense_categories ec
 WHERE ec.account_id = a.id
   AND a.is_tdphp = false
   AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.account_id = a.id)
   AND a.id = (substr(md5('subledger:expense_category:' || ec.id::text),1,8)||'-'||substr(md5('subledger:expense_category:' || ec.id::text),9,4)||'-'||
               substr(md5('subledger:expense_category:' || ec.id::text),13,4)||'-'||substr(md5('subledger:expense_category:' || ec.id::text),17,4)||'-'||
               substr(md5('subledger:expense_category:' || ec.id::text),21,12))::uuid;
ALTER TABLE invoice_lines DROP COLUMN IF EXISTS expense_category_id;
ALTER TABLE products DROP COLUMN IF EXISTS default_expense_category_id;
ALTER TABLE expense_categories DROP COLUMN IF EXISTS account_id;
