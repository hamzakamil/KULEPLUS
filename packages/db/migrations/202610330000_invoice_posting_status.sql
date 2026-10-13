-- Faz 3/5: Fatura kesinleştirme (posting_status) — tahsilat durumundan AYRI izlenir
-- (SPEC §12.2; ROADMAP Faz 3: "Tahsilat (payment_status) ile fatura kesinleştirme
-- (posting_status) ayrı izleniyor"). Otomatik muhasebeleştirme bu bayrağa bağlıdır.
--
-- Değerler: draft (varsayılan) → posted (kesinleşti, yevmiye fişi üretildi) → cancelled.

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS posting_status text NOT NULL DEFAULT 'draft'
        CHECK (posting_status IN ('draft', 'posted', 'cancelled'));

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS posted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_invoices_posting_status ON invoices(tenant_id, posting_status);
