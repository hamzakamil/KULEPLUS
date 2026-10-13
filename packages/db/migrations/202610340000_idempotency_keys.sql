-- Idempotency-Key kayıtları (SPEC §22.2) — finansal kesinleştirmede çift işlem engeli.
--
-- Tasarım: kayıt, İSTEK TRANSACTION'I içinde (tenant scope, RLS) yazılır.
--  * Başarılı istek → COMMIT → aynı key ile ikinci istek REDDEDİLİR (409).
--  * Başarısız istek → ROLLBACK → kayıt silinir, yeniden denemeye izin verilir.
-- Böylece yanıt gövdesini ayrıca kalıcılaştırmaya (ve commit yarışına) gerek kalmaz.

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_keys_tenant_isolation ON idempotency_keys
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_tenant ON idempotency_keys(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO app_user;
