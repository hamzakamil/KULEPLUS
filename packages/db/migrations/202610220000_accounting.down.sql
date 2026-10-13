-- Down migration for 202610220000_accounting.sql (SPEC §30.7: down zorunlu)
-- Faz 5 Muhasebe tablolarını ters FK sırasıyla kaldırır:
--   journal_lines → journal_entries (+ tetikleyici/fonksiyon) → account_mappings
--   → period_locks → posting_rules → accounting_accounts → fiscal_periods
-- Not: indexler ve GRANT'lar tablolarla birlikte düşer, ayrıca temizlenmez.

DROP POLICY IF EXISTS journal_lines_tenant_isolation ON journal_lines;
DROP POLICY IF EXISTS journal_entries_tenant_isolation ON journal_entries;
DROP POLICY IF EXISTS account_mappings_tenant_isolation ON account_mappings;
DROP POLICY IF EXISTS period_locks_tenant_isolation ON period_locks;
DROP POLICY IF EXISTS posting_rules_tenant_isolation ON posting_rules;
DROP POLICY IF EXISTS accounting_accounts_tenant_isolation ON accounting_accounts;
DROP POLICY IF EXISTS fiscal_periods_tenant_isolation ON fiscal_periods;

ALTER TABLE IF EXISTS journal_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS journal_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS account_mappings DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS period_locks DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS posting_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS accounting_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fiscal_periods DISABLE ROW LEVEL SECURITY;

-- Fişler tablo ile birlikte düşer; trigger/fonksiyon da temizlenir.
DROP TRIGGER IF EXISTS journal_entries_balance_trigger ON journal_entries;
DROP FUNCTION IF EXISTS enforce_journal_balance();

-- Tablolar ters sırada (ALT tablolar önce).
DROP TABLE IF EXISTS journal_lines;
DROP TABLE IF EXISTS journal_entries;
DROP TABLE IF EXISTS account_mappings;
DROP TABLE IF EXISTS period_locks;
DROP TABLE IF EXISTS posting_rules;
DROP TABLE IF EXISTS accounting_accounts;
DROP TABLE IF EXISTS fiscal_periods;
