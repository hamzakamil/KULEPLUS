-- Faz 7 (Onay Kutusu): birlesik onay talebi deposu.
-- Kapsam: ROADMAP Faz 7 "Onay kutusu: odeme limiti, fatura iptali, fis onayi".
-- Tablolar (GOVERNANCE §2 management satiri): approval_requests.
-- Farkli modullerden (trade/cashbank/accounting) gelen onay talepleri tek kutuda toplanir;
-- talebin kaynagi related_entity_type/related_entity_id + payload ile tasinir.
-- Notlar:
--   * UUID v7 kurali (SPEC §0.1): id uygulama tarafinda newId() ile uretilir; DB default YOK.
--   * Onaylayan (decided_by) ile talep sahibi (requested_by) ayri kolonlardadir; kendi
--     kendini onay engeli is kurali olarak uygulama katmanina birakilmistir (patron
--     hem talep eden hem onaylayan olabildigi icin varsayilan olarak engellenmez).
--   * Karar (approved/rejected) geri alinmaz; yeni talep acilir.

CREATE TABLE IF NOT EXISTS approval_requests (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    request_type text NOT NULL
        CHECK (request_type = ANY (ARRAY['payment_over_limit'::text, 'invoice_cancellation'::text, 'journal_entry'::text])),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])),
    title text NOT NULL,
    summary text,
    amount numeric(18,2),
    currency char(3),
    requested_by uuid REFERENCES users(id),
    assigned_to uuid REFERENCES users(id),
    related_entity_type text,                         -- invoice | expense | journal_entry | cash_bank_movement
    related_entity_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    decided_by uuid REFERENCES users(id),
    decided_at timestamptz,
    decision_note text,
    due_at timestamptz,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status = 'pending' OR decided_at IS NOT NULL)
);

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_requests_tenant_isolation ON approval_requests
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant ON approval_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_type ON approval_requests(tenant_id, request_type);
CREATE INDEX IF NOT EXISTS idx_approval_requests_assigned ON approval_requests(tenant_id, assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_entity ON approval_requests(tenant_id, related_entity_type, related_entity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON approval_requests TO app_user;

-- ======================= Permission katalog senkronu (Faz 7) =======================
-- Deterministik UUID: ADR-0002 (id deterministik üretilir; gen_random_uuid() yasak).
-- id = md5('permission:' || code) → tireli uuid cast (expense_categories deseni).
INSERT INTO permissions (id, module, resource, action, code, name, delegatable, is_system_permission)
SELECT
  (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
  v.module, v.resource, v.action, v.code, v.name, v.delegatable, v.is_system_permission
FROM (
  VALUES
  ('management', 'approval', 'read', 'management.approval.read', 'Onay taleplerini goruntule', true, true),
  ('management', 'approval', 'create', 'management.approval.create', 'Onay talebi olustur', true, true),
  ('management', 'approval', 'decide', 'management.approval.decide', 'Onay talebini karara bagla', true, true)) AS v(module, resource, action, code, name, delegatable, is_system_permission)
CROSS JOIN LATERAL (SELECT md5('permission:' || v.code) AS h) m
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;
