-- Down migration for 202610270000_einvoice.sql
-- Sıralama: FK bağımlılıkları ters sırayla kaldırılır.

DROP TABLE IF EXISTS einvoice_status_events;
DROP TABLE IF EXISTS einvoice_inbox;
DROP TABLE IF EXISTS einvoice_outbox;
DROP TABLE IF EXISTS einvoice_documents;
