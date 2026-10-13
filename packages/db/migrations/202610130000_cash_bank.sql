CREATE TABLE cash_bank_accounts (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('cash', 'bank')),
    account_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100),
    currency CHAR(3) NOT NULL DEFAULT 'TRY',
    description TEXT,
    balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE cash_bank_movements (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES cash_bank_accounts(id) ON DELETE RESTRICT,
    movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('deposit', 'withdrawal', 'transfer')),
    transaction_date DATE NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'TRY',
    reference VARCHAR(100),
    description TEXT,
    balance_before DECIMAL(18,2) NOT NULL,
    balance_after DECIMAL(18,2) NOT NULL,
    related_document_type VARCHAR(50),
    related_document_id UUID,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_cash_bank_accounts_tenant ON cash_bank_accounts(tenant_id);
CREATE INDEX idx_cash_bank_accounts_type_status ON cash_bank_accounts(tenant_id, account_type, status);
CREATE INDEX idx_cash_bank_movements_tenant ON cash_bank_movements(tenant_id);
CREATE INDEX idx_cash_bank_movements_account ON cash_bank_movements(tenant_id, account_id);
CREATE INDEX idx_cash_bank_movements_date ON cash_bank_movements(tenant_id, transaction_date);
CREATE INDEX idx_cash_bank_movements_ref ON cash_bank_movements(tenant_id, reference);
CREATE INDEX idx_cash_bank_movements_related ON cash_bank_movements(tenant_id, related_document_type, related_document_id);

ALTER TABLE cash_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_bank_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cash_bank_accounts
    ON cash_bank_accounts
    FOR ALL
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_cash_bank_movements
    ON cash_bank_movements
    FOR ALL
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON cash_bank_accounts TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON cash_bank_movements TO app_user;