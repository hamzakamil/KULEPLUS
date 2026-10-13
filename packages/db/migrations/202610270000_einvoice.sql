-- Faz 4: e-Dönüşüm (einvoice) modülü — SPEC §21
-- Kapsam: einvoice_documents, einvoice_outbox, einvoice_status_events, einvoice_inbox.
-- Outbox pattern (SPEC §21.2): gönderim önce outbox'a yazılır, worker asenkron işler;
--   attempts/max_attempts ile yeniden deneme, idempotent gönderim.
-- GUID/UUID v7 kuralı (SPEC §0.1): uygulama tarafında newId() üretir, DB default'ı YOKTUR.

-- ======================= e-Dönüşüm Belgeleri =======================
CREATE TABLE IF NOT EXISTS einvoice_documents (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_type text NOT NULL,                            -- kaynak tipi: 'invoice','credit_note','debit_note','delivery_note','original_evrak','evrak_eni'
    source_id uuid,                                       -- kaynak belge id'si (fatura vs.)
    document_type text NOT NULL
        CHECK (document_type = ANY (ARRAY['invoice'::text, 'credit_note'::text, 'debit_note'::text, 'delivery_note'::text, 'original_evrak'::text, 'evrak_eni'::text])),
    status text NOT NULL DEFAULT 'draft'
        CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'sent'::text, 'delivered'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text, 'expired'::text])),
    xml_payload text,                                     -- UBL-TR / provider payload (XML)
    pdf_path text,                                        -- oluşturulan PDF dosya yolu (MinIO)
    provider_response text,                               -- son sağlayıcı ham yanıtı
    external_invoice_id text,                             -- sağlayıcının belge numarası (ör. GIBEN2026000000001)
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    last_attempt_at timestamptz,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);


-- ======================= Outbox =======================
CREATE TABLE IF NOT EXISTS einvoice_outbox (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_type text NOT NULL DEFAULT 'einvoice',         -- hangi agregat (şimdilik yalnızca 'einvoice')
    entity_id uuid NOT NULL,                              -- einvoice_documents.id
    event_type text NOT NULL
        CHECK (event_type = ANY (ARRAY['send'::text, 'status'::text, 'cancel'::text])),
    payload text NOT NULL DEFAULT '{}',                   -- JSON; kaynak tür vb.
    status text NOT NULL DEFAULT 'pending'
        CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])),
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    provider_response text,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Durum Olay Geçmişi =======================
CREATE TABLE IF NOT EXISTS einvoice_status_events (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES einvoice_documents(id) ON DELETE CASCADE,
    status text NOT NULL,
    provider_response text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Gelen Kutusu (Inbox) =======================
CREATE TABLE IF NOT EXISTS einvoice_inbox (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    external_invoice_id text NOT NULL,
    direction text NOT NULL DEFAULT 'incoming'
        CHECK (direction = ANY (ARRAY['incoming'::text, 'outgoing'::text])),
    document_type text NOT NULL,
    title text,
    received_at timestamptz NOT NULL DEFAULT now(),
    payload text,                                         -- ham XML / JSON
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (external_invoice_id, direction)
);

-- ======================= RLS Policies (SPEC §7) =======================
-- NOT: einvoice_outbox BİLEREK RLS'siz bırakılır — email_outbox emsali gibi (bkz.
-- 202610070000_email_outbox.sql) outbox altyapı tablosudur; worker tüm tenant'ların
-- bekleyen kayıtlarını görebilmeli (cross-tenant dispatch). Tenant filtresi açık
-- WHERE/tenant_id index'i ile sağlanır. Domain verisi olan documents/inbox/events RLS'lidir.
ALTER TABLE einvoice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE einvoice_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE einvoice_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY einvoice_documents_tenant_isolation ON einvoice_documents
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
-- status_events: tenant_id yok; document üzerinden izolasyon.
CREATE POLICY einvoice_status_events_tenant_isolation ON einvoice_status_events
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM einvoice_documents d
            WHERE d.id = einvoice_status_events.document_id
              AND d.tenant_id = app.current_tenant_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM einvoice_documents d
            WHERE d.id = einvoice_status_events.document_id
              AND d.tenant_id = app.current_tenant_id()
        )
    );
CREATE POLICY einvoice_inbox_tenant_isolation ON einvoice_inbox
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());


-- ======================= Indexler =======================
CREATE INDEX IF NOT EXISTS idx_einvoice_documents_tenant ON einvoice_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_einvoice_documents_status ON einvoice_documents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_einvoice_documents_source ON einvoice_documents(tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_einvoice_outbox_tenant ON einvoice_outbox(tenant_id);
CREATE INDEX IF NOT EXISTS idx_einvoice_outbox_pending ON einvoice_outbox(status, attempts, created_at);
CREATE INDEX IF NOT EXISTS idx_einvoice_outbox_entity ON einvoice_outbox(tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_einvoice_status_events_doc ON einvoice_status_events(document_id, created_at);
CREATE INDEX IF NOT EXISTS idx_einvoice_inbox_tenant ON einvoice_inbox(tenant_id, received_at);

-- ======================= İzinler =======================
GRANT SELECT, INSERT, UPDATE, DELETE ON
    einvoice_documents,
    einvoice_outbox,
    einvoice_status_events,
    einvoice_inbox
TO app_user;

