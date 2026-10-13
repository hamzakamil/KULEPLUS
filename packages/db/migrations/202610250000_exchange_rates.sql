-- Faz 6.2: Döviz Kurları — exchange_rates tablosu + TCMB içe aktarma altyapısı
-- Kapsam: ROADMAP Faz 6.2 — TCMB kur içe aktarma (SPEC §9.2), kur farkı, dönem sonu değerleme.
-- Notlar:
--   * SPEC §9.1: kur kolonu numeric(20,8)
--   * TCMB günlük kurlar: https://www.tcmb.gov.tr/kurlar/today.xml
--   * Bu migration yalnızca tablo; içe aktarma servisi worker tarafında (cron/queue).

CREATE TABLE IF NOT EXISTS exchange_rates (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rate_date date NOT NULL,                     -- kur tarihi
    base_currency char(3) NOT NULL DEFAULT 'TRY',-- baz para birimi (varsayılan TRY)
    target_currency char(3) NOT NULL,            -- hedef para birimi (USD, EUR, GBP, vb.)
    rate numeric(20,8) NOT NULL CHECK (rate > 0),-- 1 base = rate target (SPEC §9.1)
    source text NOT NULL DEFAULT 'TCMB'          -- TCMB | manual | provider
        CHECK (source = ANY (ARRAY['TCMB'::text, 'manual'::text, 'provider'::text])),
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, rate_date, base_currency, target_currency, source)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_tenant ON exchange_rates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(tenant_id, rate_date);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair ON exchange_rates(tenant_id, base_currency, target_currency, rate_date);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY exchange_rates_tenant_isolation ON exchange_rates
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON exchange_rates TO app_user;