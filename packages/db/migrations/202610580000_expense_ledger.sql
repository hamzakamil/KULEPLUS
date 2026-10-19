-- Muhasebe Faz 7-5 — Giderler ekranı muhasebesi + mükerrer belge kontrolü.
--  * expenses: matrah/KDV ayrımı (net_amount, tax_rate, tax_amount; amount = KDV dahil toplam),
--    carisiz peşin gider için satıcı unvanı/VKN ve ödeme kaynağı (kasa/banka veya kredi kartı).
--  * invoices.supplier_document_no: alış faturasında tedarikçinin belge numarası
--    (aynı cari + aynı belge no ile ikinci alış faturası/gider kesinleştirilemez).

ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS net_amount numeric(18,2),
    ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_amount numeric(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS counterparty_name text,
    ADD COLUMN IF NOT EXISTS counterparty_tax_number text,
    ADD COLUMN IF NOT EXISTS payment_source_type text
        CHECK (payment_source_type IS NULL OR payment_source_type = ANY (ARRAY['cash_bank'::text, 'credit_card'::text])),
    ADD COLUMN IF NOT EXISTS payment_source_id uuid,
    ADD COLUMN IF NOT EXISTS posted_at timestamptz;

UPDATE expenses SET net_amount = amount WHERE net_amount IS NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supplier_document_no text;

CREATE INDEX IF NOT EXISTS idx_expenses_document
    ON expenses (tenant_id, contact_id, lower(btrim(invoice_number)))
    WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_document
    ON invoices (tenant_id, contact_id, lower(btrim(supplier_document_no)))
    WHERE supplier_document_no IS NOT NULL;
