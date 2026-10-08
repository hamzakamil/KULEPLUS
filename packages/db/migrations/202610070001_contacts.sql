-- Faz 2: Cari Hesap (contacts module)
-- SPEK §11: Contact/Party management
-- - Müşteri/tedarikçi kartları
-- - Ekstre, yaşlandırma raporu
-- - Excel içe/dışa aktarma

-- Down: 202610070001_contacts.down.sql

-- ===== ANA CARİ TABLOSU =====
CREATE TABLE contacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  trade_name text,
  type text NOT NULL DEFAULT 'customer' CHECK (type IN ('customer', 'supplier')),
  tax_number text,
  tax_office text,
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CONSTRAINT contacts_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX idx_contacts_tenant_id ON contacts(tenant_id);
CREATE INDEX idx_contacts_tax_number ON contacts(tax_number);
CREATE INDEX idx_contacts_type ON contacts(type);

-- ===== CARİ RLLERİ =====
CREATE TABLE contact_roles (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('customer', 'supplier')),
  company_name text,
  tax_number text,
  tax_office text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_roles_contact_type_unique UNIQUE (contact_id, type)
);

-- ===== CARİ ADRESleri =====
CREATE TABLE contact_addresses (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  type text NOT NULL DEFAULT 'default' CHECK (type IN ('default', 'billing', 'shipping', 'other')),
  province text,
  district text,
  neighborhood text,
  street text,
  building text,
  apartment text,
  zip_code text,
  parsed jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_addresses_contact_id ON contact_addresses(contact_id);

-- ===== CARİ TELEFONLARI =====
CREATE TABLE contact_phones (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  type text NOT NULL DEFAULT 'mobile' CHECK (type IN ('mobile', 'fax', 'work', 'home')),
  number text NOT NULL,
  formatted text,
  parsed jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_phones_contact_id ON contact_phones(contact_id);

-- ===== CARİ E-POSTALAR =====
CREATE TABLE contact_emails (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  type text NOT NULL DEFAULT 'default' CHECK (type IN ('default', 'notifications', 'marketing')),
  email text NOT NULL,
  validated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_emails_contact_id ON contact_emails(contact_id);

-- ===== CARİ İLİŞKİLERİ =====
CREATE TABLE contact_relations (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  related_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type IN ('parent', 'child', 'partner', 'reference', 'other')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_relations_self_exclude CHECK (contact_id <> related_contact_id),
  UNIQUE (contact_id, related_contact_id, relation_type)
);

CREATE INDEX idx_contact_relations_contact_id ON contact_relations(contact_id);
CREATE INDEX idx_contact_relations_related_id ON contact_relations(related_contact_id);

-- ===== PARTİ HAREKET TABLOSU =====
CREATE TABLE party_ledger_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('receivable', 'payable')),
  document_type text,
  document_number text,
  posted_at timestamptz NOT NULL,
  amount numeric(20,8) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'TRY',
  exchange_rate numeric(20,8) NOT NULL DEFAULT 1,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  CONSTRAINT party_ledger_entries_tenant_contact_unique UNIQUE (tenant_id, contact_id, document_type, document_number)
);

CREATE INDEX idx_party_ledger_entries_tenant_id ON party_ledger_entries(tenant_id);
CREATE INDEX idx_party_ledger_entries_contact_id ON party_ledger_entries(contact_id);
CREATE INDEX idx_party_ledger_entries_type ON party_ledger_entries(type);

-- ===== AÇIK BAKİYE (BORÇ/ALACAK) =====
CREATE TABLE party_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('receivable', 'payable')),
  current_balance numeric(20,8) NOT NULL DEFAULT 0,
  last_posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, contact_id, type)
);

CREATE INDEX idx_party_accounts_tenant_id ON party_accounts(tenant_id);
CREATE INDEX idx_party_accounts_contact_id ON party_accounts(contact_id);

-- ===== AÇIK KARMA ZASIŞTIRMA =====
CREATE TABLE settlement_templates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('auto', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== İŞLEM KURULARI YETKİLERİ =====
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts, contact_roles, contact_addresses, contact_phones, contact_emails, contact_relations, party_ledger_entries, party_accounts, settlement_templates TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ===== RLS: CONTACT TABLOLARI TENANT İZOLASYONUNDA =====
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_tenant_isolation ON contacts;
CREATE POLICY contacts_tenant_isolation ON contacts
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS contact_roles_tenant_isolation ON contact_roles;
CREATE POLICY contact_roles_tenant_isolation ON contact_roles
  USING (EXISTS (SELECT 1 FROM contacts WHERE id = contact_id AND tenant_id = app.current_tenant_id()));

DROP POLICY IF EXISTS contact_addresses_tenant_isolation ON contact_addresses;
CREATE POLICY contact_addresses_tenant_isolation ON contact_addresses
  USING (EXISTS (SELECT 1 FROM contacts WHERE id = contact_id AND tenant_id = app.current_tenant_id()));

DROP POLICY IF EXISTS contact_phones_tenant_isolation ON contact_phones;
CREATE POLICY contact_phones_tenant_isolation ON contact_phones
  USING (EXISTS (SELECT 1 FROM contacts WHERE id = contact_id AND tenant_id = app.current_tenant_id()));

DROP POLICY IF EXISTS contact_emails_tenant_isolation ON contact_emails;
CREATE POLICY contact_emails_tenant_isolation ON contact_emails
  USING (EXISTS (SELECT 1 FROM contacts WHERE id = contact_id AND tenant_id = app.current_tenant_id()));

DROP POLICY IF EXISTS contact_relations_tenant_isolation ON contact_relations;
CREATE POLICY contact_relations_tenant_isolation ON contact_relations
  USING (
    EXISTS (SELECT 1 FROM contacts WHERE id = contact_id AND tenant_id = app.current_tenant_id())
    AND
    EXISTS (SELECT 1 FROM contacts WHERE id = related_contact_id AND tenant_id = app.current_tenant_id())
  );

DROP POLICY IF EXISTS party_ledger_entries_tenant_isolation ON party_ledger_entries;
CREATE POLICY party_ledger_entries_tenant_isolation ON party_ledger_entries
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS party_accounts_tenant_isolation ON party_accounts;
CREATE POLICY party_accounts_tenant_isolation ON party_accounts
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DROP POLICY IF EXISTS settlement_templates_tenant_isolation ON settlement_templates;
CREATE POLICY settlement_templates_tenant_isolation ON settlement_templates
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());