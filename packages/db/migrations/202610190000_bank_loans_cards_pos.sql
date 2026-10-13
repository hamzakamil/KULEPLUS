-- Faz 3: Banka alt modülleri — krediler, kredi kartları ve POS hesapları.
-- Her kayıt bir banka hesabına (cash_bank_accounts, account_type='bank') bağlıdır.
--
-- 1) bank_loans          → Banka kredileri (taksitli, faizli)
-- 2) credit_cards        → Kredi kartları (ödemeler için)
-- 3) pos_accounts        → POS hesapları (kredi kartı ile tahsilat)
-- 4) credit_card_transactions / pos_transactions → hareket defterleri
--
-- RLS: tüm tablolar tenant izolasyonlu; app_user'a CRUD izni verilir.

-- ===== 1) Banka Kredileri =====
CREATE TABLE IF NOT EXISTS bank_loans (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bank_account_id uuid NOT NULL REFERENCES cash_bank_accounts(id) ON DELETE CASCADE,
    loan_number text,
    loan_type text NOT NULL DEFAULT 'term' CHECK (loan_type = ANY (ARRAY['term'::text, 'revolving'::text, 'overdraft'::text, 'mortgage'::text])),
    principal numeric(18,2) NOT NULL,
    interest_rate numeric(9,4) NOT NULL DEFAULT 0,
    total_installments integer NOT NULL DEFAULT 1,
    paid_installments integer NOT NULL DEFAULT 0,
    installment_amount numeric(18,2) NOT NULL DEFAULT 0,
    remaining_balance numeric(18,2) NOT NULL DEFAULT 0,
    start_date date NOT NULL,
    end_date date,
    currency char(3) NOT NULL DEFAULT 'TRY',
    status text NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'closed'::text, 'overdue'::text])),
    description text,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===== 2) Kredi Kartları =====
CREATE TABLE IF NOT EXISTS credit_cards (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bank_account_id uuid NOT NULL REFERENCES cash_bank_accounts(id) ON DELETE CASCADE,
    card_label text NOT NULL,
    card_number_last4 text,
    card_network text CHECK (card_network = ANY (ARRAY['visa'::text, 'mastercard'::text, 'troy'::text, 'amex'::text, 'other'::text])),
    credit_limit numeric(18,2) NOT NULL DEFAULT 0,
    current_debt numeric(18,2) NOT NULL DEFAULT 0,
    available_limit numeric(18,2) NOT NULL DEFAULT 0,
    statement_day integer,
    due_day integer,
    currency char(3) NOT NULL DEFAULT 'TRY',
    status text NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'blocked'::text, 'closed'::text])),
    description text,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===== 3) POS Hesapları =====
CREATE TABLE IF NOT EXISTS pos_accounts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bank_account_id uuid NOT NULL REFERENCES cash_bank_accounts(id) ON DELETE CASCADE,
    pos_label text NOT NULL,
    terminal_id text,
    merchant_number text,
    commission_rate numeric(9,4) NOT NULL DEFAULT 0,
    installment_supported boolean NOT NULL DEFAULT true,
    currency char(3) NOT NULL DEFAULT 'TRY',
    status text NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'closed'::text])),
    description text,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===== İndeksler =====
CREATE INDEX IF NOT EXISTS idx_bank_loans_tenant ON bank_loans(tenant_id, bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_loans_status ON bank_loans(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_cards_tenant ON credit_cards(tenant_id, bank_account_id);
CREATE INDEX IF NOT EXISTS idx_credit_cards_status ON credit_cards(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_accounts_tenant ON pos_accounts(tenant_id, bank_account_id);
CREATE INDEX IF NOT EXISTS idx_pos_accounts_status ON pos_accounts(tenant_id, status);

-- ===== RLS =====
ALTER TABLE bank_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_loans_tenant_isolation ON bank_loans;
CREATE POLICY bank_loans_tenant_isolation ON bank_loans
    FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS credit_cards_tenant_isolation ON credit_cards;
CREATE POLICY credit_cards_tenant_isolation ON credit_cards
    FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS pos_accounts_tenant_isolation ON pos_accounts;
CREATE POLICY pos_accounts_tenant_isolation ON pos_accounts
    FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

-- ===== İzinler =====
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_loans, credit_cards, pos_accounts TO app_user;