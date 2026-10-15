-- Faz 7.6 rollback: şantiye kayıtları ve izin katalog satırları kaldırılır.

DELETE FROM permissions WHERE code LIKE 'management.site.%';

DROP TABLE IF EXISTS sites;
