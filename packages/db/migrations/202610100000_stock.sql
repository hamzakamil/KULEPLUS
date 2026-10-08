-- Faz 3: Stok ve Malimeti — SPEC §14
-- products, product_barcodes, units, unit_conversions, warehouses,
-- stock_documents, stock_document_lines, stock_movements, stock_balances,
-- stock_reservations, inventory_counts, inventory_count_lines, stock_cost_entries

-- ===== Birimler =====
CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  abbreviation text,
  is_base boolean NOT NULL DEFAULT false,
  conversion_factor numeric(20,8) NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CONSTRAINT units_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_units_tenant_id ON units(tenant_id);

-- ===== Ürünler =====
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  barcode text,
  model text,
  cost_price numeric(20,8) NOT NULL DEFAULT 0,
  sale_price numeric(20,8) NOT NULL DEFAULT 0,
  list_price numeric(20,8) NOT NULL DEFAULT 0,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  track_inventory boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CONSTRAINT products_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_unit_id ON products(unit_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

-- ===== Barkodlar =====
CREATE TABLE IF NOT EXISTS product_barcodes (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  type text NOT NULL DEFAULT 'ean13' CHECK (type IN ('ean13', 'qrcode', 'code128', 'upc')),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_barcodes_product_id ON product_barcodes(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON product_barcodes(barcode);

CREATE INDEX IF NOT EXISTS idx_units_tenant_id ON units(tenant_id);

-- ===== Ürünler =====
CREATE TABLE IF NOT EXISTS unit_conversions (
  id uuid PRIMARY KEY,
  from_unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  to_unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  conversion_factor numeric(20,8) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_conversions_unique ON unit_conversions (from_unit_id, to_unit_id);

-- ===== Depolar (Warehouses) =====
CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  address text,
  is_base boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CONSTRAINT warehouses_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_id ON warehouses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_active ON warehouses(is_active);

-- ===== Stok Hareketleri =====
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('in', 'out', 'adjustment', 'transfer', 'count', 'adjustment_in', 'adjustment_out')),
  quantity numeric(20,8) NOT NULL,
  previous_balance numeric(20,8) NOT NULL DEFAULT 0,
  new_balance numeric(20,8) NOT NULL DEFAULT 0,
  cost_price numeric(20,8) NOT NULL DEFAULT 0,
  total_value numeric(20,8) NOT NULL DEFAULT 0,
  reference_type text,
  reference_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_id ON stock_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse_id ON stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);

-- ===== Stok Bakiyeleri (Periyodik snapshot) =====
CREATE TABLE IF NOT EXISTS stock_balances (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  quantity numeric(20,8) NOT NULL DEFAULT 0,
  cost_price numeric(20,8) NOT NULL DEFAULT 0,
  total_value numeric(20,8) NOT NULL DEFAULT 0,
  last_movement_at timestamptz,
  version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, product_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_balances_tenant_id ON stock_balances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_balances_product_id ON stock_balances(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_balances_warehouse_id ON stock_balances(warehouse_id);

-- ===== Sayımlar =====
CREATE TABLE IF NOT EXISTS inventory_counts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  notes text,
  counted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_counts_tenant_id ON inventory_counts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_warehouse_id ON inventory_counts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_status ON inventory_counts(status);

-- ===== Sayım Satırları =====
CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id uuid PRIMARY KEY,
  count_id uuid NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  expected_quantity numeric(20,8) NOT NULL DEFAULT 0,
  actual_quantity numeric(20,8) NOT NULL DEFAULT 0,
  difference numeric(20,8) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','match','mismatch')),
  notes text
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_lines_count_id ON inventory_count_lines(count_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_lines_product_id ON inventory_count_lines(product_id);

-- ===== Maliyet Kayıtları =====
CREATE TABLE IF NOT EXISTS stock_cost_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  cost_price numeric(20,8) NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase','adjustment','import')),
  reference_type text,
  reference_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_cost_entries_tenant_id ON stock_cost_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_cost_entries_product_id ON stock_cost_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_cost_entries_effective ON stock_cost_entries(effective_at DESC);

-- ===== Stok Dökümanları =====
CREATE TABLE IF NOT EXISTS stock_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('purchase','sale','transfer','adjustment','count')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  reference_type text,
  reference_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_documents_tenant_id ON stock_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_documents_warehouse_id ON stock_documents(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_documents_type ON stock_documents(type);

-- ===== Stok Döküman Satırları =====
CREATE TABLE IF NOT EXISTS stock_document_lines (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  quantity numeric(20,8) NOT NULL,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  unit_price numeric(20,8) NOT NULL DEFAULT 0,
  total_price numeric(20,8) NOT NULL DEFAULT 0,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_stock_document_lines_document_id ON stock_document_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_stock_document_lines_product_id ON stock_document_lines(product_id);

-- ===== İzin Verilen İşlemler =====
GRANT SELECT, INSERT, UPDATE, DELETE ON products, product_barcodes, units, unit_conversions, warehouses, stock_movements, stock_balances, inventory_counts, inventory_count_lines, stock_cost_entries, stock_documents, stock_document_lines TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ===== RLS: STOCK TABLOLARI TENANT İZOLASYONUNDA =====
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_document_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_tenant_isolation ON products;
CREATE POLICY products_tenant_isolation ON products
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS product_barcodes_tenant_isolation ON product_barcodes;
CREATE POLICY product_barcodes_tenant_isolation ON product_barcodes
  USING (EXISTS (SELECT 1 FROM products WHERE id = product_id AND tenant_id = app.current_tenant_id()));

DROP POLICY IF EXISTS units_tenant_isolation ON units;
CREATE POLICY units_tenant_isolation ON units
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS unit_conversions_tenant_isolation ON unit_conversions;
CREATE POLICY unit_conversions_tenant_isolation ON unit_conversions
  USING (EXISTS (SELECT 1 FROM units WHERE id = from_unit_id AND tenant_id = app.current_tenant_id())
    AND
    EXISTS (SELECT 1 FROM units WHERE id = to_unit_id AND tenant_id = app.current_tenant_id()));

DROP POLICY IF EXISTS warehouses_tenant_isolation ON warehouses;
CREATE POLICY warehouses_tenant_isolation ON warehouses
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS stock_movements_tenant_isolation ON stock_movements;
CREATE POLICY stock_movements_tenant_isolation ON stock_movements
  USING (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS stock_balances_tenant_isolation ON stock_balances;
CREATE POLICY stock_balances_tenant_isolation ON stock_balances
  USING (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS inventory_counts_tenant_isolation ON inventory_counts;
CREATE POLICY inventory_counts_tenant_isolation ON inventory_counts
  USING (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS inventory_count_lines_tenant_isolation ON inventory_count_lines;
CREATE POLICY inventory_count_lines_tenant_isolation ON inventory_count_lines
  USING (EXISTS (SELECT 1 FROM inventory_counts WHERE id = count_id AND tenant_id = app.current_tenant_id()));

DROP POLICY IF EXISTS stock_cost_entries_tenant_isolation ON stock_cost_entries;
CREATE POLICY stock_cost_entries_tenant_isolation ON stock_cost_entries
  USING (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS stock_documents_tenant_isolation ON stock_documents;
CREATE POLICY stock_documents_tenant_isolation ON stock_documents
  USING (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS stock_document_lines_tenant_isolation ON stock_document_lines;
CREATE POLICY stock_document_lines_tenant_isolation ON stock_document_lines
  USING (EXISTS (SELECT 1 FROM stock_documents WHERE id = document_id AND tenant_id = app.current_tenant_id()));

-- ===== Up: Stok bazlı entitlement grant =====
GRANT INSERT ON products, product_barcodes, units, unit_conversions, warehouses TO app_migrator;