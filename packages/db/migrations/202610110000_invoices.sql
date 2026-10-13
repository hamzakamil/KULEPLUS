-- Faz 4: Fatura ve Raporlama — SPEC §15, §16
-- invoices, invoice_lines, tax_rates, invoice_sequences

-- ===== KDV Oranları =====
CREATE TABLE IF NOT EXISTS tax_rates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  rate numeric(5,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rates_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_tenant_id ON tax_rates(tenant_id);

-- ===== Fatura Numara Sıraları =====
CREATE TABLE IF NOT EXISTS invoice_sequences (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prefix text NOT NULL DEFAULT 'FAT',
  current_number int NOT NULL DEFAULT 0,
  fiscal_year int NOT NULL,
  reset_on_new_year boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_sequences_tenant_year_unique UNIQUE (tenant_id, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_invoice_sequences_tenant ON invoice_sequences(tenant_id);

-- ===== Faturalar =====
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id uuid REFERENCES invoice_sequences(id) ON DELETE SET NULL,
  number text NOT NULL,
  type text NOT NULL CHECK (type IN ('sales', 'purchase', 'proforma', 'credit_note', 'debit_note')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'partial', 'cancelled', 'overdue')),
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  currency char(3) NOT NULL DEFAULT 'TRY',
  exchange_rate numeric(20,8) NOT NULL DEFAULT 1,
  subtotal numeric(20,8) NOT NULL DEFAULT 0,
  discount_total numeric(20,8) NOT NULL DEFAULT 0,
  tax_total numeric(20,8) NOT NULL DEFAULT 0,
  total numeric(20,8) NOT NULL DEFAULT 0,
  paid_amount numeric(20,8) NOT NULL DEFAULT 0,
  balance numeric(20,8) NOT NULL DEFAULT 0,
  notes text,
  reference_type text,
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CONSTRAINT invoices_tenant_number_unique UNIQUE (tenant_id, number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contact_id ON invoices(contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

-- ===== Fatura Satırları =====
CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(20,8) NOT NULL DEFAULT 1,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  unit_price numeric(20,8) NOT NULL DEFAULT 0,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  discount_amount numeric(20,8) NOT NULL DEFAULT 0,
  tax_rate_id uuid REFERENCES tax_rates(id) ON DELETE SET NULL,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(20,8) NOT NULL DEFAULT 0,
  line_total numeric(20,8) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_product_id ON invoice_lines(product_id);

-- ===== Fatura Ödemeleri =====
CREATE TABLE IF NOT EXISTS invoice_payments (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount numeric(20,8) NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'check', 'credit_card', 'other')),
  reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);

-- ===== RLS: INVOICE TABLOLARI TENANT İZOLASYONUNDA =====
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_rates_tenant_isolation ON tax_rates;
CREATE POLICY tax_rates_tenant_isolation ON tax_rates
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS invoice_sequences_tenant_isolation ON invoice_sequences;
CREATE POLICY invoice_sequences_tenant_isolation ON invoice_sequences
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS invoices_tenant_isolation ON invoices;
CREATE POLICY invoices_tenant_isolation ON invoices
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS invoice_lines_tenant_isolation ON invoice_lines;
CREATE POLICY invoice_lines_tenant_isolation ON invoice_lines
  USING (EXISTS (SELECT 1 FROM invoices WHERE id = invoice_id AND tenant_id = app.current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM invoices WHERE id = invoice_id AND tenant_id = app.current_tenant_id()));

DROP POLICY IF EXISTS invoice_payments_tenant_isolation ON invoice_payments;
CREATE POLICY invoice_payments_tenant_isolation ON invoice_payments
  USING (EXISTS (SELECT 1 FROM invoices WHERE id = invoice_id AND tenant_id = app.current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM invoices WHERE id = invoice_id AND tenant_id = app.current_tenant_id()));

-- ===== Varsayılan KDV Oranları =====
-- Not: UUID üretimi deterministik name-based'dir (md5 → tireli format); DB'nin
-- rastgele UUID üreteçleri yasaktır (SPEC §0.1 / ADR-0002). Değer tenant + kod ile sabittir.
INSERT INTO tax_rates (id, tenant_id, code, name, rate, is_active)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid, t.id, 'KDV1', 'KDV %1', 1, true
FROM (SELECT id, md5(id::text || ':tax_rates:KDV1') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE tenant_id = t.id AND code = 'KDV1');

INSERT INTO tax_rates (id, tenant_id, code, name, rate, is_active)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid, t.id, 'KDV8', 'KDV %8', 8, true
FROM (SELECT id, md5(id::text || ':tax_rates:KDV8') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE tenant_id = t.id AND code = 'KDV8');

INSERT INTO tax_rates (id, tenant_id, code, name, rate, is_active)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid, t.id, 'KDV18', 'KDV %18', 18, true
FROM (SELECT id, md5(id::text || ':tax_rates:KDV18') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE tenant_id = t.id AND code = 'KDV18');

INSERT INTO tax_rates (id, tenant_id, code, name, rate, is_active)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid, t.id, 'KDV0', 'KDV %0 (Muaf)', 0, true
FROM (SELECT id, md5(id::text || ':tax_rates:KDV0') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE tenant_id = t.id AND code = 'KDV0');

-- ===== Varsayılan Fatura Sırası =====
INSERT INTO invoice_sequences (id, tenant_id, prefix, current_number, fiscal_year, reset_on_new_year)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid, t.id, 'FAT', 0, EXTRACT(YEAR FROM CURRENT_DATE)::int, true
FROM (SELECT id, md5(id::text || ':invoice_sequences:default') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM invoice_sequences WHERE tenant_id = t.id);

-- ===== İzinler =====
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_rates, invoice_sequences, invoices, invoice_lines, invoice_payments TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;