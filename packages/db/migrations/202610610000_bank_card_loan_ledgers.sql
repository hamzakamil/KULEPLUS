-- Faz 3 (genişletme): Kredi kartı hareketleri ve banka kredisi ödeme planı.
--
-- 1) credit_card_transactions → Kart hareket defteri (harcama, ödeme, iade, ücret, faiz)
-- 2) bank_loan_installments   → Kredi taksit planı (vade, tutar, anapara/faiz, ödendi durumu)
--
-- Her iki tablo da tenant izolasyonludur (RLS) ve ana kayda ON DELETE CASCADE bağlıdır.
-- Kart bakiyesi (current_debt) ve kredi özeti (paid_installments / remaining_balance)
-- servis katmanında bu defterlerden türetilir.

-- ===== 1) Kredi Kartı Hareketleri =====
CREATE TABLE IF NOT EXISTS credit_card_transactions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    credit_card_id uuid NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
    transaction_date date NOT NULL,
    transaction_type text NOT NULL
        CHECK (transaction_type = ANY (ARRAY['purchase'::text, 'payment'::text, 'refund'::text, 'fee'::text, 'interest'::text])),
    description text NOT NULL,
    amount numeric(18,2) NOT NULL CHECK (amount > 0),
    installment_count integer NOT NULL DEFAULT 1 CHECK (installment_count >= 1),
    reference text,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_card_transactions_card
    ON credit_card_transactions(tenant_id, credit_card_id, transaction_date DESC, created_at DESC);

-- ===== 2) Banka Kredisi Taksit Planı =====
CREATE TABLE IF NOT EXISTS bank_loan_installments (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bank_loan_id uuid NOT NULL REFERENCES bank_loans(id) ON DELETE CASCADE,
    installment_no integer NOT NULL CHECK (installment_no >= 1),
    due_date date NOT NULL,
    amount numeric(18,2) NOT NULL CHECK (amount >= 0),
    principal_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (principal_amount >= 0),
    interest_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
    paid_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    paid_at date,
    status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text])),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_bank_loan_installments_no UNIQUE (bank_loan_id, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_bank_loan_installments_due
    ON bank_loan_installments(tenant_id, bank_loan_id, due_date);

-- ===== RLS =====
ALTER TABLE credit_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_loan_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_card_transactions_tenant_isolation ON credit_card_transactions;
CREATE POLICY credit_card_transactions_tenant_isolation ON credit_card_transactions
    FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS bank_loan_installments_tenant_isolation ON bank_loan_installments;
CREATE POLICY bank_loan_installments_tenant_isolation ON bank_loan_installments
    FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

-- ===== İzinler =====
GRANT SELECT, INSERT, UPDATE, DELETE ON credit_card_transactions, bank_loan_installments TO app_user;
