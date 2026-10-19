-- Muhasebe Faz 7-4 — çek/senet yardımcı hesapları ve yaşam döngüsü adımları.
--
-- Alınan çek:  101.01 Portföydeki Çekler, 101.02 Tahsile Verilen Çekler, 101.03 Teminata Verilen Çekler
-- Alınan senet: 121.01 Portföydeki Senetler, 121.02 Tahsile Verilen Senetler, 121.03 Teminattaki Senetler
-- Verilen çek: 103, verilen senet: 321. Hesaplar ilk fişte servis tarafından açılır.
-- Yeni adımlar: tahsile verme (deposited, yer=bank), teminata verme (pledged, yer=pledged),
-- teminattan geri alma (released, yer=own). Durum 'portfolio' (aktif) kalır.

ALTER TABLE cheques DROP CONSTRAINT IF EXISTS cheques_portfolio_holder_check;
ALTER TABLE cheques ADD CONSTRAINT cheques_portfolio_holder_check
    CHECK (portfolio_holder = ANY (ARRAY['own'::text, 'bank'::text, 'pledged'::text, 'customer'::text, 'supplier'::text]));

ALTER TABLE cheque_portfolio DROP CONSTRAINT IF EXISTS cheque_portfolio_holder_check;
ALTER TABLE cheque_portfolio ADD CONSTRAINT cheque_portfolio_holder_check
    CHECK (holder = ANY (ARRAY['own'::text, 'bank'::text, 'pledged'::text, 'customer'::text, 'supplier'::text]));

ALTER TABLE cheque_transactions DROP CONSTRAINT IF EXISTS cheque_transactions_transaction_type_check;
ALTER TABLE cheque_transactions ADD CONSTRAINT cheque_transactions_transaction_type_check
    CHECK (transaction_type = ANY (ARRAY['created'::text, 'deposited'::text, 'pledged'::text, 'released'::text,
                                         'endorsed'::text, 'collected'::text, 'bounced'::text, 'cancelled'::text, 'note'::text]));
