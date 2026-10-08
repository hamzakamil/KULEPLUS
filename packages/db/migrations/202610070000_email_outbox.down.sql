-- Down migration: 202610070000_email_outbox.down.sql
-- Email outbox tablosu ve ilişkili indexleri kaldırır

DROP TABLE IF EXISTS email_outbox CASCADE;

-- İlişkili index'ler otomatik olarak kaldırılır