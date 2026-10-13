-- Faz 4 Hat B (devam) — İade + fatura/alacak eşleştirme (SPEC §8.6, §8.7).
-- GOVERNANCE §2'de ayrılıp şeması kurulmamış iki tablo:
--   billing_refunds    → kalıcı iade kaydı (kısmi/tam), sağlayıcı iade referansıyla
--   billing_allocations → ödeme ↔ fatura eşleştirmesi (SPEC §8.6 "fatura/alacak eşleştirme")
-- UUID v7 uygulama tarafında (newId()); DB default YOK. Tenant tabloları RLS'li.

CREATE TABLE IF NOT EXISTS billing_refunds (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payment_id uuid NOT NULL REFERENCES billing_payments(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES commercial_orders(id) ON DELETE RESTRICT,
    provider_ref text,
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    currency char(3) NOT NULL DEFAULT 'TRY',
    status text NOT NULL DEFAULT 'succeeded'
        CHECK (status IN ('pending','succeeded','failed','cancelled')),
    reason text,
    refunded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_allocations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payment_id uuid NOT NULL REFERENCES billing_payments(id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    allocated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Ödeme durumu SPEC §8.7 sözlüğüne genişletilir: iade akışı `partially_refunded`
-- ve `refunded` üretir (Faz 4 Hat B ilk kurulumda yalnızca 3 durum tanımlıydı).
ALTER TABLE billing_payments DROP CONSTRAINT IF EXISTS billing_payments_status_check;
ALTER TABLE billing_payments
  ADD CONSTRAINT billing_payments_status_check
  CHECK (status IN ('pending','succeeded','failed','partially_refunded','refunded','disputed'));

-- ===== RLS (tenant tabloları) =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_refunds','billing_allocations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON billing_refunds, billing_allocations TO app_user;
