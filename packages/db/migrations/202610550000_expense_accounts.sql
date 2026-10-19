-- Muhasebe Faz 7-2 — gider hesapları.
--  * expense_categories.account_id : kategorinin muhasebe hesabı (varsayılan 770.xx alt hesabı;
--    kullanıcı 760/740 altına taşıyabilir).
--  * products.default_expense_category_id : stok takipsiz (hizmet/sarf) ürün kartının
--    alışta yazılacağı gider kategorisi.
--  * invoice_lines.expense_category_id : alış faturası satırının gider kategorisi
--    (satır ya stok ürünü ya gider kategorisi taşır).
-- Mevcut kategoriler, hesap planı kurulmuş tenant'larda 770 altında alt hesaplarla bağlanır.

ALTER TABLE expense_categories
    ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounting_accounts(id) ON DELETE SET NULL;
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS default_expense_category_id uuid
        REFERENCES expense_categories(id) ON DELETE SET NULL;
ALTER TABLE invoice_lines
    ADD COLUMN IF NOT EXISTS expense_category_id uuid
        REFERENCES expense_categories(id) ON DELETE SET NULL;

-- Kategori → 770.xx (sıra: kategori koduna göre, mevcut en büyük 770 alt numarasının üzerine).
INSERT INTO accounting_accounts (id, tenant_id, code, name, type, parent_id, is_tdphp)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
       s.tenant_id,
       '770.' || lpad((s.offs + s.rn)::text, 2, '0'),
       s.name,
       'detail',
       s.parent_id,
       false
FROM (
    SELECT ec.id AS cat_id, ec.tenant_id, ec.name, p.id AS parent_id,
           row_number() OVER (PARTITION BY ec.tenant_id ORDER BY ec.code, ec.id) AS rn,
           COALESCE((
               SELECT MAX(split_part(a.code, '.', 2)::int)
                 FROM accounting_accounts a
                WHERE a.tenant_id = ec.tenant_id
                  AND a.code LIKE '770.%'
                  AND split_part(a.code, '.', 2) ~ '^[0-9]+$'
                  AND split_part(a.code, '.', 3) = ''
           ), 0) AS offs
      FROM expense_categories ec
      JOIN accounting_accounts p ON p.tenant_id = ec.tenant_id AND p.code = '770'
     WHERE ec.account_id IS NULL
) s
CROSS JOIN LATERAL (SELECT md5('subledger:expense_category:' || s.cat_id::text) AS h) m
ON CONFLICT DO NOTHING;

UPDATE expense_categories ec
   SET account_id = a.id
  FROM accounting_accounts a
 WHERE ec.account_id IS NULL
   AND a.tenant_id = ec.tenant_id
   AND a.id = (substr(md5('subledger:expense_category:' || ec.id::text),1,8)||'-'||substr(md5('subledger:expense_category:' || ec.id::text),9,4)||'-'||
               substr(md5('subledger:expense_category:' || ec.id::text),13,4)||'-'||substr(md5('subledger:expense_category:' || ec.id::text),17,4)||'-'||
               substr(md5('subledger:expense_category:' || ec.id::text),21,12))::uuid;
