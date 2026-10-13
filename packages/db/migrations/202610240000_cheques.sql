-- Faz 6: Cek/Senet modulu — "Cek/Senet" cekirdegi
-- Kapsam: ROADMAP Faz 6 ilk madde: portfoy, ciro, tahsil, karsiliksiz,
--   vade takvimi, durum gecmisi + muhasebe kaydi.
-- Tablolar: cheques, cheque_transactions, cheque_portfolio (GOVERNANCE §2 cheque satiri).
-- Notlar:
--   * UUID v7 kurali (SPEC §0.1): uygulama tarafinda uretilir, DB'de default YOK.
--   * Parasal standart (SPEC §9.1): tutar numeric(18,2); kur kolonlari numeric(20,8).
--   * Durum makinesi: portfolio -> endorsed | collected | bounced | cancelled;
--     terminal durumlar (endorsed/collected/bounced/cancelled) son durumdur —
--     kesinlesmis kayit uzerinde degisiklik YOK (SPEC §10.1 ruhu).
--   * Ciro/tahsil/karsiliksiz her durum degisiminde cheque_transactions'a
--     durum gecmisi yazar; portfoy yeri cheque_portfolio'da aktiv kayitla tutulur.

-- ======================= Cek/Senet Karti =======================
CREATE TABLE IF NOT EXISTS cheques (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cheque_type text NOT NULL
        CHECK (cheque_type = ANY (ARRAY['cheque'::text, 'promissory'::text])),   -- cek / senet
    direction text NOT NULL
        CHECK (direction = ANY (ARRAY['incoming'::text, 'outgoing'::text])),      -- alinan / verilen
    serial_no text,                               -- cek defteri seri no
    cheque_no text NOT NULL,                      -- cek/senet no
    bank_name text,                               -- banka (cek icin; senette NULL olabilir)
    branch text,                                  -- sube
    account_no text,                              -- hesap no
    drawer_name text NOT NULL,                    -- kesideci (ceki duzenleyen)
    endorser_name text,                           -- ciro eden taraf
    issue_date date NOT NULL,                     -- duzenleme tarihi
    due_date date NOT NULL,                       -- vade tarihi
    amount numeric(18,2) NOT NULL CHECK (amount > 0),
    currency char(3) NOT NULL DEFAULT 'TRY',
    status text NOT NULL DEFAULT 'portfolio'
        CHECK (status = ANY (ARRAY['portfolio'::text, 'endorsed'::text, 'collected'::text, 'bounced'::text, 'cancelled'::text])),
    portfolio_holder text NOT NULL DEFAULT 'own'
        CHECK (portfolio_holder = ANY (ARRAY['own'::text, 'bank'::text, 'customer'::text, 'supplier'::text])),
    contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,     -- ilgili cari (musteri/tedarikci)
    cash_bank_account_id uuid REFERENCES cash_bank_accounts(id) ON DELETE SET NULL,  -- tahsilat hesabi
    description text,
    cancelled_reason text,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, serial_no, cheque_no)
);

-- ======================= Durum Gecmisi / Islemler =======================
CREATE TABLE IF NOT EXISTS cheque_transactions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cheque_id uuid NOT NULL REFERENCES cheques(id) ON DELETE CASCADE,
    transaction_type text NOT NULL
        CHECK (transaction_type = ANY (ARRAY['created'::text, 'endorsed'::text, 'collected'::text, 'bounced'::text, 'cancelled'::text, 'note'::text])),
    from_status text,
    to_status text NOT NULL,
    transaction_date date NOT NULL,
    amount numeric(18,2),                         -- islem tutari (varsayilan: cek tutari)
    party_name text,                              -- karsi taraf (ciro edilen / tahsile gonderilen)
    journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,   -- muhasebe kaydi baglantisi
    description text,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ======================= Portfoy (cekin nerde oldugu) =======================
CREATE TABLE IF NOT EXISTS cheque_portfolio (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cheque_id uuid NOT NULL REFERENCES cheques(id) ON DELETE CASCADE,
    holder text NOT NULL
        CHECK (holder = ANY (ARRAY['own'::text, 'bank'::text, 'customer'::text, 'supplier'::text])),
    party_name text,                              -- portfoyde tutan taraf adi
    since_date date NOT NULL,
    until_date date,                              -- NULL = aktif kayit (cek su an burada)
    notes text,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Bir cek icin tek aktif portfoy kaydi (kismi unique index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cheque_portfolio_active
    ON cheque_portfolio (tenant_id, cheque_id)
    WHERE until_date IS NULL;

-- ======================= RLS Policies =======================
ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE cheque_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cheque_portfolio ENABLE ROW LEVEL SECURITY;

CREATE POLICY cheques_tenant_isolation ON cheques
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY cheque_transactions_tenant_isolation ON cheque_transactions
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY cheque_portfolio_tenant_isolation ON cheque_portfolio
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

-- ======================= Indexler =======================
CREATE INDEX IF NOT EXISTS idx_cheques_tenant ON cheques(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cheques_status ON cheques(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cheques_direction ON cheques(tenant_id, direction);
CREATE INDEX IF NOT EXISTS idx_cheques_due_date ON cheques(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_cheques_holder ON cheques(tenant_id, portfolio_holder);
CREATE INDEX IF NOT EXISTS idx_cheques_contact ON cheques(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_cheque_transactions_tenant ON cheque_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cheque_transactions_cheque ON cheque_transactions(tenant_id, cheque_id);
CREATE INDEX IF NOT EXISTS idx_cheque_transactions_date ON cheque_transactions(tenant_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_cheque_portfolio_tenant ON cheque_portfolio(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cheque_portfolio_cheque ON cheque_portfolio(tenant_id, cheque_id);
CREATE INDEX IF NOT EXISTS idx_cheque_portfolio_holder ON cheque_portfolio(tenant_id, holder, until_date);

-- ======================= Izinler =======================
GRANT SELECT, INSERT, UPDATE, DELETE ON
    cheques,
    cheque_transactions,
    cheque_portfolio
TO app_user;

-- ======================= Permission katalog senkronu (Faz 6) =======================
-- Kaynak: packages/shared/src/permissions.ts (TEK KAYNAK — SPEC §6.5, ADR-0006).
INSERT INTO permissions (module, resource, action, code, name, delegatable, is_system_permission) VALUES
  ('cheque', 'cheque', 'read', 'cheque.cheque.read', 'Cek/senet goruntule', true, true),
  ('cheque', 'cheque', 'create', 'cheque.cheque.create', 'Cek/senet olustur', true, true),
  ('cheque', 'cheque', 'update', 'cheque.cheque.update', 'Cek/senet guncelle', true, true),
  ('cheque', 'cheque', 'delete', 'cheque.cheque.delete', 'Cek/senet sil', true, true),
  ('cheque', 'cheque', 'manage', 'cheque.cheque.manage', 'Cek/senet yasam dongusu (ciro/tahsil/karsiliksiz/iptal)', true, true)
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;
