-- Faz 1: Company applications table for manual onboarding
-- Down: 202610060002_company_applications.down.sql

-- ===== COMPANY APPLICATIONS =====
CREATE TABLE company_applications (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  trade_name text,
  tax_office text,
  tax_number text,
  currency char(3) NOT NULL DEFAULT 'TRY',
  fiscal_year_start smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
  timezone text NOT NULL DEFAULT 'Europe/Istanbul',
  owner_email text NOT NULL,
  starting_module text CHECK (starting_module IN ('contacts', 'stock')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  CONSTRAINT company_applications_owner_email_status_unique UNIQUE (owner_email, status) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_company_applications_status ON company_applications(status);
CREATE INDEX idx_company_applications_owner_email ON company_applications(owner_email);

GRANT SELECT, INSERT, UPDATE, DELETE ON company_applications TO app_user;