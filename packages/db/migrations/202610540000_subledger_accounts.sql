-- Muhasebe Faz 7-1 — yardımcı (alt) hesaplar: kasa/banka/kredi kartı eşlemesi.
--
-- Her kasa 100.xx, her banka hesabı 102.xx, her şirket kredi kartı 309.xx alt hesabıyla
-- eşlenir (kod biçimi noktalı: <ana hesap>.<sıra>). Bağlantı kartın kendi kolonunda tutulur.
-- Mevcut kayıtlar burada toplu bağlanır (yalnızca hesap planı kurulmuş tenant'larda);
-- sonradan açılan kartlar ilk fişte servis tarafından otomatik bağlanır (subledger.ts).
-- Geçmiş fişler ana hesaplarda (100/102) kalır; yeniden muhasebeleştirme yapılmaz.

ALTER TABLE cash_bank_accounts
    ADD COLUMN IF NOT EXISTS accounting_account_id uuid
        REFERENCES accounting_accounts(id) ON DELETE SET NULL;
ALTER TABLE credit_cards
    ADD COLUMN IF NOT EXISTS accounting_account_id uuid
        REFERENCES accounting_accounts(id) ON DELETE SET NULL;

-- Fatura ödemesinin geçtiği kasa/banka kartı veya şirket kredi kartı (izlenebilirlik + fiş hesabı).
ALTER TABLE invoice_payments
    ADD COLUMN IF NOT EXISTS cash_bank_account_id uuid
        REFERENCES cash_bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE invoice_payments
    ADD COLUMN IF NOT EXISTS credit_card_id uuid
        REFERENCES credit_cards(id) ON DELETE SET NULL;

-- ---- Kasa/banka → 100.xx / 102.xx ----
-- Sıra: tenant + tür bazında oluşturulma sırasına göre, mevcut en büyük alt hesap
-- numarasının üzerine eklenir (kullanıcının elle açtığı 102.01 vb. ile çakışmaz).
-- id deterministik (ADR-0002): md5('subledger:cash_bank:' || kart id).
INSERT INTO accounting_accounts (id, tenant_id, code, name, type, parent_id, is_tdphp)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
       s.tenant_id,
       s.parent_code || '.' || lpad((s.offs + s.rn)::text, 2, '0'),
       s.account_name,
       'detail',
       s.parent_id,
       false
FROM (
    SELECT c.id AS card_id, c.tenant_id, c.account_name, p.id AS parent_id, p.code AS parent_code,
           row_number() OVER (PARTITION BY c.tenant_id, c.account_type ORDER BY c.created_at, c.id) AS rn,
           COALESCE((
               SELECT MAX(split_part(a.code, '.', 2)::int)
                 FROM accounting_accounts a
                WHERE a.tenant_id = c.tenant_id
                  AND a.code LIKE p.code || '.%'
                  AND split_part(a.code, '.', 2) ~ '^[0-9]+$'
                  AND split_part(a.code, '.', 3) = ''
           ), 0) AS offs
      FROM cash_bank_accounts c
      JOIN accounting_accounts p
        ON p.tenant_id = c.tenant_id
       AND p.code = CASE WHEN c.account_type = 'bank' THEN '102' ELSE '100' END
     WHERE c.accounting_account_id IS NULL
) s
CROSS JOIN LATERAL (SELECT md5('subledger:cash_bank:' || s.card_id::text) AS h) m
ON CONFLICT DO NOTHING;

UPDATE cash_bank_accounts c
   SET accounting_account_id = a.id
  FROM accounting_accounts a
 WHERE c.accounting_account_id IS NULL
   AND a.tenant_id = c.tenant_id
   AND a.id = (substr(md5('subledger:cash_bank:' || c.id::text),1,8)||'-'||substr(md5('subledger:cash_bank:' || c.id::text),9,4)||'-'||
               substr(md5('subledger:cash_bank:' || c.id::text),13,4)||'-'||substr(md5('subledger:cash_bank:' || c.id::text),17,4)||'-'||
               substr(md5('subledger:cash_bank:' || c.id::text),21,12))::uuid;

-- ---- Şirket kredi kartları → 309.xx (Diğer Mali Borçlar) ----
INSERT INTO accounting_accounts (id, tenant_id, code, name, type, parent_id, is_tdphp)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
       s.tenant_id,
       '309.' || lpad((s.offs + s.rn)::text, 2, '0'),
       'Kredi Kartı ' || s.card_label || COALESCE(' (*' || s.card_number_last4 || ')', ''),
       'detail',
       s.parent_id,
       false
FROM (
    SELECT k.id AS card_id, k.tenant_id, k.card_label, k.card_number_last4, p.id AS parent_id,
           row_number() OVER (PARTITION BY k.tenant_id ORDER BY k.created_at, k.id) AS rn,
           COALESCE((
               SELECT MAX(split_part(a.code, '.', 2)::int)
                 FROM accounting_accounts a
                WHERE a.tenant_id = k.tenant_id
                  AND a.code LIKE '309.%'
                  AND split_part(a.code, '.', 2) ~ '^[0-9]+$'
                  AND split_part(a.code, '.', 3) = ''
           ), 0) AS offs
      FROM credit_cards k
      JOIN accounting_accounts p ON p.tenant_id = k.tenant_id AND p.code = '309'
     WHERE k.accounting_account_id IS NULL
) s
CROSS JOIN LATERAL (SELECT md5('subledger:credit_card:' || s.card_id::text) AS h) m
ON CONFLICT DO NOTHING;

UPDATE credit_cards k
   SET accounting_account_id = a.id
  FROM accounting_accounts a
 WHERE k.accounting_account_id IS NULL
   AND a.tenant_id = k.tenant_id
   AND a.id = (substr(md5('subledger:credit_card:' || k.id::text),1,8)||'-'||substr(md5('subledger:credit_card:' || k.id::text),9,4)||'-'||
               substr(md5('subledger:credit_card:' || k.id::text),13,4)||'-'||substr(md5('subledger:credit_card:' || k.id::text),17,4)||'-'||
               substr(md5('subledger:credit_card:' || k.id::text),21,12))::uuid;
