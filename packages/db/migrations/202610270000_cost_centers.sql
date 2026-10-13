-- Faz 6.9: Maliyet merkezi / proje etiketi (opsiyonel boyut) — ROADMAP §Faz 6
-- Kaynak belgelere bakım boyutu ekler: fatura, fiş, gider, çek satırları.
-- `cost_centers` ve `project_tags` tenant tanımlı; `*_tag` bağlantı tabloları
-- çoka-çok (bir belgenin birden fazla boyut satırı olabilir).

-- ===== Maliyet Merkezi =====
CREATE TABLE IF NOT EXISTS cost_centers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  parent_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_centers_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cost_centers_tenant ON cost_centers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_parent ON cost_centers(parent_id);

-- ===== Proje Etiketi =====
CREATE TABLE IF NOT EXISTS project_tags (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived','cancelled')),
  start_date date,
  end_date date,
  description text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_tags_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_project_tags_tenant ON project_tags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_tags_contact ON project_tags(contact_id);

-- ===== Fatura Satırı Boyutları =====
CREATE TABLE IF NOT EXISTS invoice_line_dimensions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_line_id uuid NOT NULL REFERENCES invoice_lines(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  project_tag_id uuid REFERENCES project_tags(id) ON DELETE SET NULL,
  /** Bu boyut satırının fatura satırı tutarındaki payı (1 = tamamı). */
  ratio numeric(9,6) NOT NULL DEFAULT 1,
  description text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_dimensions_line ON invoice_line_dimensions(invoice_line_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_dimensions_cc ON invoice_line_dimensions(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_dimensions_pt ON invoice_line_dimensions(project_tag_id);

-- ===== Fiş Satırı Boyutları =====
CREATE TABLE IF NOT EXISTS journal_line_dimensions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_line_id uuid NOT NULL REFERENCES journal_lines(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  project_tag_id uuid REFERENCES project_tags(id) ON DELETE SET NULL,
  ratio numeric(9,6) NOT NULL DEFAULT 1,
  description text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_line_dimensions_line ON journal_line_dimensions(journal_line_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_dimensions_cc ON journal_line_dimensions(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_dimensions_pt ON journal_line_dimensions(project_tag_id);

-- ===== Gider Boyutları =====
CREATE TABLE IF NOT EXISTS expense_dimensions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  project_tag_id uuid REFERENCES project_tags(id) ON DELETE SET NULL,
  ratio numeric(9,6) NOT NULL DEFAULT 1,
  description text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_dimensions_expense ON expense_dimensions(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_dimensions_cc ON expense_dimensions(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_expense_dimensions_pt ON expense_dimensions(project_tag_id);

-- ===== RLS =====
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_line_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_dimensions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cost_centers_tenant_isolation ON cost_centers;
CREATE POLICY cost_centers_tenant_isolation ON cost_centers
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS project_tags_tenant_isolation ON project_tags;
CREATE POLICY project_tags_tenant_isolation ON project_tags
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS invoice_line_dimensions_tenant_isolation ON invoice_line_dimensions;
CREATE POLICY invoice_line_dimensions_tenant_isolation ON invoice_line_dimensions
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS journal_line_dimensions_tenant_isolation ON journal_line_dimensions;
CREATE POLICY journal_line_dimensions_tenant_isolation ON journal_line_dimensions
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS expense_dimensions_tenant_isolation ON expense_dimensions;
CREATE POLICY expense_dimensions_tenant_isolation ON expense_dimensions
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

-- ===== İzinler =====
GRANT SELECT, INSERT, UPDATE, DELETE ON
  cost_centers,
  project_tags,
  invoice_line_dimensions,
  journal_line_dimensions,
  expense_dimensions
TO app_user;