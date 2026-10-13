-- Düzeltme: kasa/banka şema eksikleri (SPEC §17, GOVERNANCE §2 cashbank)
-- Bağlam: 202610130000_cash_bank.sql ile gelen servis kodu, şemada OLMAYAN
-- kolonları kullanıyordu (opening_balance, target_account_id) ve silme akışında
-- geçersiz status ('deleted') yazıyordu. Bu migration üçünü de hizalar.

-- ===== 1) cash_bank_accounts.opening_balance =====
ALTER TABLE cash_bank_accounts
  ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(18,2) NOT NULL DEFAULT 0;

-- ===== 2) cash_bank_movements.target_account_id (transfer hedefi) =====
ALTER TABLE cash_bank_movements
  ADD COLUMN IF NOT EXISTS target_account_id UUID REFERENCES cash_bank_accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_cash_bank_movements_target
  ON cash_bank_movements(tenant_id, target_account_id);

-- ===== 3) status CHECK: soft-delete için 'deleted' eklenir (ADR-0010) =====
-- ADR-0010: soft delete yalnızca kart tablolarında. cash_bank_accounts bir kart
-- tablosudur → 'deleted' durumu geçerlidir.
ALTER TABLE cash_bank_accounts DROP CONSTRAINT IF EXISTS cash_bank_accounts_status_check;
ALTER TABLE cash_bank_accounts
  ADD CONSTRAINT cash_bank_accounts_status_check
  CHECK (status IN ('active', 'inactive', 'deleted'));

-- ===== 4) Rapor üretim kayıtları (reports_plus — SPEC §16) =====
-- Servis (reports_plus/report.service.ts) bu tabloyu kullanıyordu ancak migration yoktu.
CREATE TABLE IF NOT EXISTS report_generations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN (
    'profit_loss', 'balance_sheet', 'tax_summary', 'cash_flow', 'aged_payable', 'aged_receivable'
  )),
  date_from date NOT NULL,
  date_to date NOT NULL,
  format text CHECK (format IN ('pdf', 'excel', 'csv')),
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'completed', 'failed')),
  file_url text,
  error_message text,
  generated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_generations_tenant
  ON report_generations(tenant_id, created_at DESC);

ALTER TABLE report_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_report_generations ON report_generations;
CREATE POLICY tenant_isolation_report_generations
  ON report_generations
  FOR ALL
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON report_generations TO app_user;
