-- Faz 5: Gider Modülü
-- Kasa/banka ile entegre gider yönetimi

CREATE TABLE IF NOT EXISTS expense_categories (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text])),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS expenses (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_number text,
    invoice_date date,
    expense_date date NOT NULL,
    category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
    contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
    description text NOT NULL,
    amount numeric(18,2) NOT NULL,
    currency text NOT NULL DEFAULT 'TRY' CHECK (char_length(currency) = 3),
    exchange_rate numeric(18,6) NOT NULL DEFAULT 1,
    base_amount numeric(18,2) GENERATED ALWAYS AS (amount * exchange_rate) STORED,
    payment_status text DEFAULT 'unpaid' CHECK (payment_status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text])),
    status text DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft'::text, 'posted'::text, 'cancelled'::text])),
    notes text,
    receipt_file_url text,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Not: `expense_payments` tablosu `expenses`e FK verir, bu yüzden expenses'tan
-- SONRA oluşturulmalıdır (aksi halde "relation expenses does not exist").
CREATE TABLE IF NOT EXISTS expense_payments (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES cash_bank_accounts(id) ON DELETE RESTRICT,
    movement_type text NOT NULL DEFAULT 'withdrawal' CHECK (movement_type = ANY (ARRAY['deposit'::text, 'withdrawal'::text])),
    amount numeric(18,2) NOT NULL,
    currency text NOT NULL DEFAULT 'TRY' CHECK (char_length(currency) = 3),
    transaction_date date NOT NULL,
    payment_date date,
    reference text,
    description text,
    reconciliation_status text DEFAULT 'pending' CHECK (reconciliation_status = ANY (ARRAY['pending'::text, 'matched'::text, 'reconciled'::text])),
    reconciliation_date timestamptz,
    balance_before numeric(18,2),
    balance_after numeric(18,2),
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- ===== RLS policies =====
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY expense_tenant_isolation ON expenses
    FOR ALL
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY expense_payments_tenant_isolation ON expense_payments
    FOR ALL
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY expense_categories_tenant_isolation ON expense_categories
    FOR ALL
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_contact ON expenses(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(tenant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_status ON expenses(tenant_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_expenses_dates ON expenses(tenant_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expense_payments_expense ON expense_payments(tenant_id, expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_account ON expense_payments(tenant_id, account_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_status ON expense_payments(tenant_id, reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant ON expense_categories(tenant_id);

-- ===== İzinler =====
-- Not: 8 Ekim 2026'ya kadar bu blok eksikti → app_user "permission denied for table
-- expenses" alıyordu (her migration kendi GRANT bloğunu içerir; bkz. cash_bank.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  expense_categories,
  expenses,
  expense_payments
TO app_user;
