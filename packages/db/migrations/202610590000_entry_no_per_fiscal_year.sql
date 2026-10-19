-- Muhasebe Faz 9-1 — yevmiye madde numarası her mali yılda 1'den başlar.
--
-- Yevmiye defteri ve e-Defter uygulamasında madde numaraları hesap dönemi içinde boşluksuz
-- ve tarih sırasıyla artar; yeni yılda 1'den başlar (açılış fişi 1. madde, kapanış fişi son madde).
--  * journal_entries.fiscal_year: fişin mali yılı (dönemin yılı; dönem yoksa fiş tarihinin yılı),
--    trigger ile her yazımda otomatik doldurulur.
--  * Tekil numara (tenant, mali yıl, madde no).
--  * Mevcut onaylı fişler yıllarına göre tarih sırasıyla yeniden numaralanır
--    (aynı gün içinde: açılış → normal → dönem sonu → kapanış).
--  * Yeni fiş türleri: 'donem_sonu' (yansıtma, 690/692 devri, vergi karşılığı), 'kapanis'.

-- Ertelenmiş denge trigger'ları (202610510000) UPDATE sonrasında bekleyen olay bırakır;
-- aynı transaction'daki ALTER TABLE bunu kabul etmez → kontroller anında çalıştırılır.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_entry_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_entry_type_check
    CHECK (entry_type = ANY (ARRAY['mahsup'::text, 'tahsil'::text, 'tediye'::text, 'acilis'::text,
                                   'duzeltme'::text, 'ters'::text, 'donem_sonu'::text, 'kapanis'::text]));

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS fiscal_year integer;

CREATE OR REPLACE FUNCTION journal_entries_set_fiscal_year() RETURNS trigger AS $$
BEGIN
    NEW.fiscal_year := COALESCE(
        (SELECT fp.year FROM fiscal_periods fp WHERE fp.id = NEW.period_id),
        EXTRACT(YEAR FROM NEW.entry_date)::int
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entries_fiscal_year ON journal_entries;
CREATE TRIGGER journal_entries_fiscal_year
    BEFORE INSERT OR UPDATE OF period_id, entry_date ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION journal_entries_set_fiscal_year();

UPDATE journal_entries je
   SET fiscal_year = COALESCE(
       (SELECT fp.year FROM fiscal_periods fp WHERE fp.id = je.period_id),
       EXTRACT(YEAR FROM je.entry_date)::int
   )
 WHERE fiscal_year IS NULL;

ALTER TABLE journal_entries ALTER COLUMN fiscal_year SET NOT NULL;

-- Yıllara göre tarih sıralı yeniden numaralama (iki aşama: tekil indeks çakışmasın).
DROP INDEX IF EXISTS journal_entries_no_unique;
UPDATE journal_entries SET entry_no = -entry_no WHERE entry_no IS NOT NULL;
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY tenant_id, fiscal_year
               ORDER BY entry_date,
                        CASE entry_type WHEN 'acilis' THEN 0 WHEN 'donem_sonu' THEN 2 WHEN 'kapanis' THEN 3 ELSE 1 END,
                        abs(entry_no), created_at, id
           ) AS rn
      FROM journal_entries
     WHERE entry_no IS NOT NULL
)
UPDATE journal_entries je SET entry_no = r.rn FROM ranked r WHERE r.id = je.id;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_no_unique
    ON journal_entries (tenant_id, fiscal_year, entry_no)
    WHERE entry_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entries_fiscal_year ON journal_entries (tenant_id, fiscal_year, entry_date);
