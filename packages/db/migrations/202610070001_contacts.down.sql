-- Down migration: 202610070001_contacts.down.sql
-- Cari Hesap tablo ve politikalarını kaldırır

DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS contact_roles CASCADE;
DROP TABLE IF EXISTS contact_addresses CASCADE;
DROP TABLE IF EXISTS contact_phones CASCADE;
DROP TABLE IF EXISTS contact_emails CASCADE;
DROP TABLE IF EXISTS contact_relations CASCADE;
DROP TABLE IF EXISTS party_ledger_entries CASCADE;
DROP TABLE IF EXISTS party_accounts CASCADE;
DROP TABLE IF EXISTS settlement_templates CASCADE;

-- İlişkili index ve politikalar otomatik olarak CASCADE ile kaldırılır