-- Muhasebe çekirdeği Faz 1 — SPEC §10.5 denge kuralının DB'de gerçekten zorlanması.
--
-- Eski `journal_entries_balance_trigger` yalnızca BEFORE UPDATE'te çalışıyordu; otomatik
-- fişlerin tamamı doğrudan status='posted' ile INSERT edildiği için hiç devreye girmiyordu.
-- Ayrıca başlık satırlardan önce yazıldığından satır anında kontrol mümkün değildi.
--
-- Yeni kural: DEFERRABLE INITIALLY DEFERRED constraint trigger'lar — kontrol COMMIT anında,
-- başlık + satırlar yazıldıktan sonra çalışır. Onaylı (posted) fişte:
--   * en az iki satır,
--   * satır borç toplamı = satır alacak toplamı,
--   * başlık total_debit/total_credit = satır toplamları.
-- Ek: bir fiş en fazla bir kez ters kaydedilebilir (reversal_of_id kısmi UNIQUE).

DROP TRIGGER IF EXISTS journal_entries_balance_trigger ON journal_entries;
DROP FUNCTION IF EXISTS enforce_journal_balance();

CREATE OR REPLACE FUNCTION journal_entry_assert_balanced(p_entry_id uuid) RETURNS void AS $$
DECLARE
    v_status text;
    v_head_debit numeric(18,2);
    v_head_credit numeric(18,2);
    v_debit numeric(18,2);
    v_credit numeric(18,2);
    v_count integer;
BEGIN
    SELECT status, total_debit, total_credit
      INTO v_status, v_head_debit, v_head_credit
      FROM journal_entries WHERE id = p_entry_id;
    IF NOT FOUND OR v_status <> 'posted' THEN
        RETURN;
    END IF;
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
      INTO v_debit, v_credit, v_count
      FROM journal_lines WHERE entry_id = p_entry_id;
    IF v_count < 2 THEN
        RAISE EXCEPTION 'Onaylı fişte en az iki satır olmalı (fiş %)', p_entry_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_debit <> v_credit THEN
        RAISE EXCEPTION 'Dengeli olmayan fiş %: borç % alacak % (SPEC §10.5)', p_entry_id, v_debit, v_credit
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_head_debit <> v_debit OR v_head_credit <> v_credit THEN
        RAISE EXCEPTION 'Fiş % başlık toplamı (%/%) satırlarla (%/%) uyuşmuyor',
            p_entry_id, v_head_debit, v_head_credit, v_debit, v_credit
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION journal_entries_balance_check() RETURNS trigger AS $$
BEGIN
    PERFORM journal_entry_assert_balanced(NEW.id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION journal_lines_balance_check() RETURNS trigger AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM journal_entry_assert_balanced(OLD.entry_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.entry_id <> OLD.entry_id) THEN
        PERFORM journal_entry_assert_balanced(NEW.entry_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entries_balance_deferred ON journal_entries;
CREATE CONSTRAINT TRIGGER journal_entries_balance_deferred
    AFTER INSERT OR UPDATE ON journal_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION journal_entries_balance_check();

DROP TRIGGER IF EXISTS journal_lines_balance_deferred ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_lines_balance_deferred
    AFTER INSERT OR UPDATE OR DELETE ON journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION journal_lines_balance_check();

-- Bir fiş yalnızca bir kez ters kaydedilir.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_reversal_once
    ON journal_entries (reversal_of_id)
    WHERE reversal_of_id IS NOT NULL;

-- Mevcut veride kuralı ihlal eden onaylı fiş varsa migration'ı DURDURMA, raporla
-- (yeni kural yalnızca yeni yazımlarda çalışır; eski kayıtlar ayrıca düzeltilmelidir).
DO $$
DECLARE
    v_bad integer;
BEGIN
    SELECT COUNT(*) INTO v_bad FROM (
        SELECT je.id
          FROM journal_entries je
          LEFT JOIN journal_lines jl ON jl.entry_id = je.id
         WHERE je.status = 'posted'
         GROUP BY je.id, je.total_debit, je.total_credit
        HAVING COALESCE(SUM(jl.debit), 0) <> COALESCE(SUM(jl.credit), 0)
            OR COALESCE(SUM(jl.debit), 0) <> je.total_debit
            OR COALESCE(SUM(jl.credit), 0) <> je.total_credit
            OR COUNT(jl.id) < 2
    ) bad;
    IF v_bad > 0 THEN
        RAISE WARNING 'Denge kuralını ihlal eden % adet mevcut onaylı fiş var; ayrıca incelenmeli.', v_bad;
    END IF;
END $$;
