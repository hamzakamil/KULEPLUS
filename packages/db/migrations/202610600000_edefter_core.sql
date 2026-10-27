-- e-Defter (E1) — GİB e-Defter Paketi (XBRL GL) için belge bilgisi ve üretilen defter parçaları.
--
-- * journal_entries / journal_lines: elle girilen fişlerde yevmiye maddesinin dayandığı belge
--   (belge tipi, açıklaması, numarası, tarihi) ve ödeme yöntemi. Satırdaki değer başlıktakini
--   ezer (ör. tek maddede birden çok fatura). Otomatik fişlerde (fatura, çek, gider, ödeme) belge
--   bilgisi e-Defter üretilirken kaynak belgeden okunur; bu kolonlar boş kalabilir.
--   GİB belge tipleri: invoice, check, voucher (senet), receipt (makbuz), shipment (navlun),
--   order-customer, order-vendor, other (+ açıklama). Belgesiz kayıtta (açılış/kapanış,
--   amortisman, yansıtma) belge tipi boş bırakılır.
-- * expenses.document_kind: gider belgesinin türü (fatura yerine geçen belgeler GİB'de "other").
-- * edefter_parts: üretilen yevmiye (Y) / kebir (K) parçaları — kontrol numarası (uniqueID)
--   sırası hesap dönemi boyunca müteselsil olduğundan kalıcı tutulur.

ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS document_type text,
    ADD COLUMN IF NOT EXISTS document_type_description text,
    ADD COLUMN IF NOT EXISTS document_number text,
    ADD COLUMN IF NOT EXISTS document_date date,
    ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_document_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_document_type_check
    CHECK (document_type IS NULL OR document_type = ANY (ARRAY['invoice','check','voucher','receipt',
        'shipment','order-customer','order-vendor','other']));

ALTER TABLE journal_lines
    ADD COLUMN IF NOT EXISTS document_type text,
    ADD COLUMN IF NOT EXISTS document_type_description text,
    ADD COLUMN IF NOT EXISTS document_number text,
    ADD COLUMN IF NOT EXISTS document_date date,
    ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS journal_lines_document_type_check;
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_document_type_check
    CHECK (document_type IS NULL OR document_type = ANY (ARRAY['invoice','check','voucher','receipt',
        'shipment','order-customer','order-vendor','other']));

ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS document_kind text NOT NULL DEFAULT 'invoice',
    ADD COLUMN IF NOT EXISTS document_kind_description text;
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_document_kind_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_document_kind_check
    CHECK (document_kind = ANY (ARRAY['invoice','e_invoice','e_archive','smm','e_smm','expense_voucher',
        'producer_receipt','retail_receipt','ticket','bank_receipt','other']));

CREATE TABLE IF NOT EXISTS edefter_parts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    fiscal_year integer NOT NULL,
    period text NOT NULL CHECK (period ~ '^[0-9]{6}$'),          -- YYYYAA
    book_type text NOT NULL CHECK (book_type = ANY (ARRAY['Y','K'])),
    part_no integer NOT NULL CHECK (part_no >= 0),               -- 0 = tek parça (000000)
    unique_seq integer NOT NULL CHECK (unique_seq > 0),          -- uniqueID son 6 hane
    unique_id text NOT NULL,                                     -- YEV202601000001
    period_start date NOT NULL,
    period_end date NOT NULL,
    first_entry_no integer,
    last_entry_no integer,
    first_line_no integer,
    last_line_no integer,
    entry_count integer NOT NULL DEFAULT 0,
    line_count integer NOT NULL DEFAULT 0,
    total_debit numeric(18,2) NOT NULL DEFAULT 0,
    total_credit numeric(18,2) NOT NULL DEFAULT 0,
    file_name text NOT NULL,
    sha256 text NOT NULL,
    size_bytes bigint NOT NULL,
    content bytea NOT NULL,
    status text NOT NULL DEFAULT 'generated'
        CHECK (status = ANY (ARRAY['generated','delivered','superseded'])),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS edefter_parts_current_unique
    ON edefter_parts (tenant_id, period, book_type, part_no) WHERE status <> 'superseded';
CREATE INDEX IF NOT EXISTS idx_edefter_parts_year ON edefter_parts (tenant_id, fiscal_year, period);
ALTER TABLE edefter_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS edefter_parts_tenant_isolation ON edefter_parts;
CREATE POLICY edefter_parts_tenant_isolation ON edefter_parts
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON edefter_parts TO app_user;
