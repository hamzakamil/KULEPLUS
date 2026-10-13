-- Faz 3: Ticari belge zinciri (SPEC §12)
-- sales_quotes, sales_orders, purchase_orders, deliveries, document_links, document_number_sequences

CREATE TABLE IF NOT EXISTS sales_quotes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  number TEXT NOT NULL,
  series_id UUID,
  contact_id UUID,
  issue_date DATE NOT NULL,
  valid_until DATE,
  currency CHAR(3) NOT NULL DEFAULT 'TRY',
  exchange_rate NUMERIC(20,8) NOT NULL DEFAULT 1,
  subtotal NUMERIC(20,4) NOT NULL DEFAULT 0,
  discount_total NUMERIC(20,4) NOT NULL DEFAULT 0,
  tax_total NUMERIC(20,4) NOT NULL DEFAULT 0,
  total NUMERIC(20,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','converted')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sales_quotes_tenant ON sales_quotes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_contact ON sales_quotes(contact_id);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_status ON sales_quotes(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_quotes_number ON sales_quotes(tenant_id, series_id, number);

CREATE TABLE IF NOT EXISTS sales_quote_lines (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  quote_id UUID NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
  product_id UUID,
  description TEXT NOT NULL,
  quantity NUMERIC(20,6) NOT NULL DEFAULT 1,
  unit_id UUID,
  unit_price NUMERIC(20,6) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(9,6) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(20,4) NOT NULL DEFAULT 0,
  tax_rate_id UUID,
  tax_rate NUMERIC(9,6) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(20,4) NOT NULL DEFAULT 0,
  line_total NUMERIC(20,4) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_quote_lines_quote ON sales_quote_lines(quote_id);
CREATE INDEX IF NOT EXISTS idx_sales_quote_lines_product ON sales_quote_lines(product_id);

CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  number TEXT NOT NULL,
  series_id UUID,
  quote_id UUID REFERENCES sales_quotes(id),
  contact_id UUID,
  issue_date DATE NOT NULL,
  delivery_date DATE,
  currency CHAR(3) NOT NULL DEFAULT 'TRY',
  exchange_rate NUMERIC(20,8) NOT NULL DEFAULT 1,
  subtotal NUMERIC(20,4) NOT NULL DEFAULT 0,
  discount_total NUMERIC(20,4) NOT NULL DEFAULT 0,
  tax_total NUMERIC(20,4) NOT NULL DEFAULT 0,
  total NUMERIC(20,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','partial_delivered','delivered','invoiced','cancelled')),
  notes TEXT,
  warehouse_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_tenant ON sales_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_contact ON sales_orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_quote ON sales_orders(quote_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_number ON sales_orders(tenant_id, series_id, number);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  quote_line_id UUID,
  product_id UUID,
  description TEXT NOT NULL,
  quantity NUMERIC(20,6) NOT NULL DEFAULT 1,
  unit_id UUID,
  unit_price NUMERIC(20,6) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(9,6) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(20,4) NOT NULL DEFAULT 0,
  tax_rate_id UUID,
  tax_rate NUMERIC(9,6) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(20,4) NOT NULL DEFAULT 0,
  line_total NUMERIC(20,4) NOT NULL DEFAULT 0,
  delivered_quantity NUMERIC(20,6) NOT NULL DEFAULT 0,
  invoiced_quantity NUMERIC(20,6) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_order_lines_order ON sales_order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_product ON sales_order_lines(product_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  number TEXT NOT NULL,
  series_id UUID,
  contact_id UUID,
  issue_date DATE NOT NULL,
  expected_date DATE,
  currency CHAR(3) NOT NULL DEFAULT 'TRY',
  exchange_rate NUMERIC(20,8) NOT NULL DEFAULT 1,
  subtotal NUMERIC(20,4) NOT NULL DEFAULT 0,
  discount_total NUMERIC(20,4) NOT NULL DEFAULT 0,
  tax_total NUMERIC(20,4) NOT NULL DEFAULT 0,
  total NUMERIC(20,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','confirmed','partial_received','received','invoiced','cancelled')),
  notes TEXT,
  warehouse_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant ON purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_contact ON purchase_orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_number ON purchase_orders(tenant_id, series_id, number);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID,
  description TEXT NOT NULL,
  quantity NUMERIC(20,6) NOT NULL DEFAULT 1,
  unit_id UUID,
  unit_price NUMERIC(20,6) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(9,6) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(20,4) NOT NULL DEFAULT 0,
  tax_rate_id UUID,
  tax_rate NUMERIC(9,6) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(20,4) NOT NULL DEFAULT 0,
  line_total NUMERIC(20,4) NOT NULL DEFAULT 0,
  received_quantity NUMERIC(20,6) NOT NULL DEFAULT 0,
  invoiced_quantity NUMERIC(20,6) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_order ON purchase_order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_product ON purchase_order_lines(product_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  number TEXT NOT NULL,
  series_id UUID,
  order_id UUID REFERENCES sales_orders(id),
  contact_id UUID,
  issue_date DATE NOT NULL,
  delivery_date DATE,
  currency CHAR(3) NOT NULL DEFAULT 'TRY',
  exchange_rate NUMERIC(20,8) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','prepared','shipped','delivered','returned','cancelled')),
  notes TEXT,
  warehouse_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deliveries_tenant ON deliveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_order ON deliveries(order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_contact ON deliveries(contact_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_number ON deliveries(tenant_id, series_id, number);

CREATE TABLE IF NOT EXISTS delivery_lines (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  order_line_id UUID REFERENCES sales_order_lines(id),
  product_id UUID,
  description TEXT NOT NULL,
  quantity NUMERIC(20,6) NOT NULL DEFAULT 1,
  unit_id UUID,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_lines_delivery ON delivery_lines(delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_lines_order_line ON delivery_lines(order_line_id);

CREATE TABLE IF NOT EXISTS document_links (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('quote','sales_order','purchase_order','delivery','invoice')),
  source_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('quote','sales_order','purchase_order','delivery','invoice')),
  target_id UUID NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'generated' CHECK (link_type IN ('generated','reference')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_links_source ON document_links(tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_document_links_target ON document_links(tenant_id, target_type, target_id);

CREATE TABLE IF NOT EXISTS document_number_sequences (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('sales_quote','sales_order','purchase_order','delivery','invoice')),
  series TEXT NOT NULL DEFAULT 'DEFAULT',
  fiscal_year INTEGER NOT NULL,
  prefix TEXT,
  current_number BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, doc_type, series, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_document_number_sequences_tenant ON document_number_sequences(tenant_id);

-- RLS Policies
ALTER TABLE sales_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_number_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON sales_quotes;
CREATE POLICY tenant_isolation ON sales_quotes
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON sales_quote_lines;
CREATE POLICY tenant_isolation ON sales_quote_lines
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON sales_orders;
CREATE POLICY tenant_isolation ON sales_orders
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON sales_order_lines;
CREATE POLICY tenant_isolation ON sales_order_lines
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON purchase_orders;
CREATE POLICY tenant_isolation ON purchase_orders
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON purchase_order_lines;
CREATE POLICY tenant_isolation ON purchase_order_lines
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON deliveries;
CREATE POLICY tenant_isolation ON deliveries
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON delivery_lines;
CREATE POLICY tenant_isolation ON delivery_lines
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON document_links;
CREATE POLICY tenant_isolation ON document_links
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON document_number_sequences;
CREATE POLICY tenant_isolation ON document_number_sequences
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON 
  sales_quotes, sales_quote_lines,
  sales_orders, sales_order_lines,
  purchase_orders, purchase_order_lines,
  deliveries, delivery_lines,
  document_links, document_number_sequences
TO app_user;