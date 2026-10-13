-- Faz 5: Muhasebe Modülü — "Muhasebe Fişleri" çekirdeği
-- Kapsam: SPEC §15 (MUHASEBE VE DÖNEM KONTROLÜ) + §10.5 (Denge)
--   fiscal_periods, accounting_accounts, journal_entries, journal_lines,
--   posting_rules, account_mappings, period_locks.
-- Not: TDHP şablonu servis tarafında (apps/api/src/modules/accounting/
--   accounting.service.ts → TDHP_ACCOUNTS) tutulur ve ensureChartOfAccounts
--   ile tenant'a bootstrap edilir (ROADMAP T-5.1: "TDHP şablonu seed").
--   GUID/UUID v7 kuralı (SPEC §0.1): uygulama tarafında üretilir, DB'de default YOK.

-- ======================= Malî Dönemler =======================
CREATE TABLE IF NOT EXISTS fiscal_periods (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    label text NOT NULL,                                  -- örn. '2026'
    year integer NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text NOT NULL DEFAULT 'open'
        CHECK (status = ANY (ARRAY['open'::text, 'closed'::text])),
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, year)
);

-- ======================= Hesap Planı (TDHP) =======================
CREATE TABLE IF NOT EXISTS accounting_accounts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code text NOT NULL,                                   -- TDHP kodu, örn. '100'
    name text NOT NULL,
    type text NOT NULL DEFAULT 'detail'
        CHECK (type = ANY (ARRAY['group'::text, 'detail'::text])),
    parent_id uuid REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
    is_tdphp boolean NOT NULL DEFAULT true,               -- TDHP'den türetilmişse silinemez
    is_active boolean NOT NULL DEFAULT true,
    opening_debit numeric(18,2) NOT NULL DEFAULT 0,
    opening_credit numeric(18,2) NOT NULL DEFAULT 0,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

-- ======================= Yevmiye Fişleri =======================
CREATE TABLE IF NOT EXISTS journal_entries (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entry_no bigint,                                      -- yalnızca onay (post) sırasında atanır → gap-free
    entry_date date NOT NULL,
    period_id uuid REFERENCES fiscal_periods(id) ON DELETE RESTRICT,
    entry_type text NOT NULL DEFAULT 'mahsup'
        CHECK (entry_type = ANY (ARRAY['mahsup'::text, 'tahsil'::text, 'tediye'::text, 'acilis'::text, 'duzeltme'::text, 'ters'::text])),
    status text NOT NULL DEFAULT 'draft'
        CHECK (status = ANY (ARRAY['draft'::text, 'posted'::text, 'cancelled'::text])),
    description text NOT NULL,
    source_type text,                                     -- kaynak ilişkisi: 'invoice','expense','cash_movement','manual'
    source_id uuid,
    reversal_of_id uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
    total_debit numeric(18,2) NOT NULL DEFAULT 0,
    total_credit numeric(18,2) NOT NULL DEFAULT 0,
    posted_by uuid REFERENCES users(id),
    posted_at timestamptz,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status <> 'posted' OR (status = 'posted' AND entry_no IS NOT NULL))
);

-- Gap-free yevmiye numarası (SPEC §15): yalnızca onaylı fişler numara alır;
-- iptal edilemez/boşluk bırakılamaz. Sürekli boşluksuz dizi DB + advisory lock
-- ile serviste üretilir. Kısmi UNIQUE: draft/cancelled NULL tutar, çakışma yok.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_no_unique
    ON journal_entries (tenant_id, entry_no)
    WHERE entry_no IS NOT NULL;

-- ======================= Fiş Satırları =======================
CREATE TABLE IF NOT EXISTS journal_lines (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL,
    account_id uuid NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
    description text NOT NULL DEFAULT '',
    debit numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT (debit > 0 AND credit > 0)),               -- satır tek taraflı
    CHECK (debit > 0 OR credit > 0),                      -- boş satır yasak
    UNIQUE (entry_id, line_no)
);

-- ======================= Posting Kuralları / Hesap Eşleme =======================
CREATE TABLE IF NOT EXISTS posting_rules (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,             -- satır şablonları (hazır + düzenlenebilir, T-5.2)
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS account_mappings (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_type text NOT NULL,            -- 'sales','purchase','vat_output','vat_input','cash','bank','stock_cost'
    account_id uuid NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
    direction text NOT NULL DEFAULT 'debit'
        CHECK (direction = ANY (ARRAY['debit'::text, 'credit'::text])),
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, source_type, direction)
);

-- ======================= Dönem Kilitleri =======================
CREATE TABLE IF NOT EXISTS period_locks (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_id uuid NOT NULL REFERENCES fiscal_periods(id) ON DELETE CASCADE,
    lock_date date NOT NULL,               -- bu tarihten önceki kayıtlar engelli
    reason text,
    locked_by uuid REFERENCES users(id),
    locked_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, period_id)
);



-- ======================= DB Denge Kuralı (SPEC §10.5) =======================
-- Fiş kesinleşirken (status='posted') toplam borç = toplam alacak zorunludur.
-- "Form doğrulamasına bırakılmaz — servis + transaction + DB kuralı."
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

-- ======================= RLS Policies =======================
ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_tenant_isolation ON accounting_accounts
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY fiscal_periods_tenant_isolation ON fiscal_periods
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY journal_entries_tenant_isolation ON journal_entries
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY journal_lines_tenant_isolation ON journal_lines
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY posting_rules_tenant_isolation ON posting_rules
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY account_mappings_tenant_isolation ON account_mappings
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY period_locks_tenant_isolation ON period_locks
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

-- ======================= Indexler =======================
CREATE INDEX IF NOT EXISTS idx_accounting_accounts_tenant ON accounting_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_accounting_accounts_parent ON accounting_accounts(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_accounting_accounts_code ON accounting_accounts(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_tenant ON fiscal_periods(tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant ON journal_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(tenant_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_period ON journal_entries(tenant_id, period_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(tenant_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(tenant_id, account_id);
CREATE INDEX IF NOT EXISTS idx_posting_rules_tenant ON posting_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_account_mappings_tenant ON account_mappings(tenant_id, source_type);
CREATE INDEX IF NOT EXISTS idx_period_locks_tenant ON period_locks(tenant_id, period_id);

-- ======================= İzinler =======================
GRANT SELECT, INSERT, UPDATE, DELETE ON
    fiscal_periods,
    accounting_accounts,
    journal_entries,
    journal_lines,
    posting_rules,
    account_mappings,
    period_locks
TO app_user;
