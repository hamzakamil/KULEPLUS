-- Down migration for 202610510000_journal_balance_deferred.sql (SPEC §30.7: down zorunlu)
DROP INDEX IF EXISTS journal_entries_reversal_once;
DROP TRIGGER IF EXISTS journal_lines_balance_deferred ON journal_lines;
DROP TRIGGER IF EXISTS journal_entries_balance_deferred ON journal_entries;
DROP FUNCTION IF EXISTS journal_lines_balance_check();
DROP FUNCTION IF EXISTS journal_entries_balance_check();
DROP FUNCTION IF EXISTS journal_entry_assert_balanced(uuid);

-- 202610220000_accounting.sql'deki önceki tanım (bilinen kusurlarıyla birlikte geri yüklenir).
CREATE OR REPLACE FUNCTION enforce_journal_balance() RETURNS trigger AS $$
DECLARE
    v_debit numeric(18,2);
    v_credit numeric(18,2);
BEGIN
    SELECT COALESCE(SUM(jl.debit), 0), COALESCE(SUM(jl.credit), 0)
      INTO v_debit, v_credit
      FROM journal_lines jl
     WHERE jl.entry_id = NEW.id;

    IF (NEW.status IN ('posted', 'ters') AND v_debit <> v_credit) THEN
        RAISE EXCEPTION 'Dengeli olmayan fiş: borç % alacak % (SPEC §10.5)', v_debit, v_credit;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entries_balance_trigger ON journal_entries;
CREATE TRIGGER journal_entries_balance_trigger
    BEFORE UPDATE OF status, total_debit, total_credit ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION enforce_journal_balance();
