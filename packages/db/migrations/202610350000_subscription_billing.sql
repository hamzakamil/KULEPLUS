-- Faz 4 Hat B (SaaS Ticari Altyapı) — çekirdek ticari tablolar (SPEC §8.2).
-- Gerçek ödeme sağlayıcı (K-08) ve fiyatlandırma (K-03) kararları bekliyor; bu
-- şema mock-önce deseniyle kurulur (MockPaymentProvider).
-- UUID v7 uygulama tarafında (newId()); DB default YOK. Tenant tabloları RLS'li.

CREATE TABLE IF NOT EXISTS module_dependencies (
    module_code text NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
    depends_on_module_code text NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
    PRIMARY KEY (module_code, depends_on_module_code)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_version_id uuid NOT NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending_activation','active','past_due','suspended','cancelled','expired')),
    started_at timestamptz NOT NULL DEFAULT now(),
    current_period_start timestamptz NOT NULL DEFAULT now(),
    current_period_end timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_items (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    module_code text NOT NULL REFERENCES modules(code) ON DELETE RESTRICT,
    quantity int NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (subscription_id, module_code)
);

CREATE TABLE IF NOT EXISTS subscription_changes (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    change_type text NOT NULL CHECK (change_type IN ('create','upgrade','downgrade','cancel','reactivate')),
    from_plan_version_id uuid REFERENCES plan_versions(id) ON DELETE SET NULL,
    to_plan_version_id uuid REFERENCES plan_versions(id) ON DELETE SET NULL,
    effective_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'applied' CHECK (status IN ('scheduled','applied','cancelled')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commercial_orders (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_no text NOT NULL,
    plan_version_id uuid NOT NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,
    amount numeric(12,2) NOT NULL,
    currency char(3) NOT NULL DEFAULT 'TRY',
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, order_no)
);

CREATE TABLE IF NOT EXISTS commercial_order_items (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES commercial_orders(id) ON DELETE CASCADE,
    module_code text NOT NULL REFERENCES modules(code) ON DELETE RESTRICT,
    amount numeric(12,2) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_attempts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES commercial_orders(id) ON DELETE CASCADE,
    provider text NOT NULL,
    provider_ref text,
    idempotency_key text NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency char(3) NOT NULL DEFAULT 'TRY',
    status text NOT NULL CHECK (status IN ('pending','succeeded','failed','partially_refunded','refunded','disputed')),
    detail text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS billing_payments (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES commercial_orders(id) ON DELETE RESTRICT,
    amount numeric(12,2) NOT NULL,
    currency char(3) NOT NULL DEFAULT 'TRY',
    status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending','succeeded','failed')),
    provider_ref text,
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_invoices (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES commercial_orders(id) ON DELETE RESTRICT,
    number text NOT NULL,
    subtotal numeric(12,2) NOT NULL DEFAULT 0,
    vat_total numeric(12,2) NOT NULL DEFAULT 0,
    total numeric(12,2) NOT NULL DEFAULT 0,
    currency char(3) NOT NULL DEFAULT 'TRY',
    status text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','cancelled')),
    issued_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, number)
);

CREATE TABLE IF NOT EXISTS billing_invoice_lines (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
    description text NOT NULL,
    amount numeric(12,2) NOT NULL DEFAULT 0,
    vat_rate numeric(5,2) NOT NULL DEFAULT 20,
    vat_amount numeric(12,2) NOT NULL DEFAULT 0,
    total numeric(12,2) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_webhook_events (
    id uuid PRIMARY KEY,
    provider text NOT NULL,
    external_event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, external_event_id)
);

CREATE TABLE IF NOT EXISTS coupons (
    id uuid PRIMARY KEY,
    code text NOT NULL UNIQUE,
    discount_type text NOT NULL CHECK (discount_type IN ('percent','amount')),
    discount_value numeric(12,2) NOT NULL,
    valid_from timestamptz,
    valid_until timestamptz,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES commercial_orders(id) ON DELETE CASCADE,
    redeemed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partners (
    id uuid PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    commission_rate numeric(5,2) NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_referrals (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    referred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_commissions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES commercial_orders(id) ON DELETE RESTRICT,
    amount numeric(12,2) NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','cancelled')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== RLS (tenant tabloları) =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions','subscription_items','subscription_changes',
      'commercial_orders','commercial_order_items','payment_attempts','billing_payments',
      'billing_invoices','billing_invoice_lines','coupon_redemptions','partner_referrals',
      'partner_commissions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  module_dependencies, subscriptions, subscription_items, subscription_changes,
  commercial_orders, commercial_order_items, payment_attempts, billing_payments,
  billing_invoices, billing_invoice_lines, provider_webhook_events, coupons,
  coupon_redemptions, partners, partner_referrals, partner_commissions
TO app_user;



-- ======================= Permission katalog senkronu (Faz 4 Hat B) =======================
-- Kaynak: packages/shared/src/permissions.ts (TEK KAYNAK — SPEC §6.5, ADR-0006).
-- Deterministik UUID: ADR-0002 (id deterministik üretilir; gen_random_uuid() yasak).
-- id = md5('permission:' || code) → tireli uuid cast (expense_categories deseni).
INSERT INTO permissions (id, module, resource, action, code, name, delegatable, is_system_permission)
SELECT
  (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
  v.module, v.resource, v.action, v.code, v.name, v.delegatable, v.is_system_permission
FROM (
  VALUES
  ('subscription', 'subscription', 'read', 'subscription.subscription.read', 'Abonelikleri goruntule', true, true),
  ('subscription', 'subscription', 'create', 'subscription.subscription.create', 'Abonelik/siparis olustur', true, true),
  ('subscription', 'subscription', 'update', 'subscription.subscription.update', 'Abonelik guncelle', true, true),
  ('subscription', 'subscription', 'delete', 'subscription.subscription.delete', 'Abonelik/iptal', true, true),
  ('subscription', 'subscription', 'manage', 'subscription.subscription.manage', 'Abonelik yasam dongusu ve faturalama yonetimi', true, true)) AS v(module, resource, action, code, name, delegatable, is_system_permission)
CROSS JOIN LATERAL (SELECT md5('permission:' || v.code) AS h) m
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;

