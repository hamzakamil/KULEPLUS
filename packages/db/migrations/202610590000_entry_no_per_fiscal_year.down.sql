-- Down migration for 202610590000_entry_no_per_fiscal_year.sql (SPEC §30.7: down zorunlu)
-- Numaralar şirket genelinde tek diziye geri döndürülür (tarih sırasıyla).
-- Ertelenmiş denge trigger'ları (202610510000) UPDATE sonrasında bekleyen olay bırakır;
-- aynı transaction'daki ALTER TABLE bunu kabul etmez → kontroller anında çalıştırılır.
SET CONSTRAINTS ALL IMMEDIATE;

DROP INDEX IF EXISTS idx_journal_entries_fiscal_year;
DROP INDEX IF EXISTS journal_entries_no_unique;
UPDATE journal_entries SET entry_no = -entry_no WHERE entry_no IS NOT NULL;
WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY entry_date, abs(entry_no), created_at, id) AS rn
      FROM journal_entries WHERE entry_no IS NOT NULL
)
UPDATE journal_entries je SET entry_no = r.rn FROM ranked r WHERE r.id = je.id;
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_no_unique
    ON journal_entries (tenant_id, entry_no) WHERE entry_no IS NOT NULL;
DROP TRIGGER IF EXISTS journal_entries_fiscal_year ON journal_entries;
DROP FUNCTION IF EXISTS journal_entries_set_fiscal_year();
ALTER TABLE journal_entries DROP COLUMN IF EXISTS fiscal_year;
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_entry_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_entry_type_check
    CHECK (entry_type = ANY (ARRAY['mahsup'::text, 'tahsil'::text, 'tediye'::text, 'acilis'::text, 'duzeltme'::text, 'ters'::text]));
