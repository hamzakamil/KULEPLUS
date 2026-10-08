-- Down migration: 202610100000_stock.down.sql
-- Stok tabloları ve ilişkili index'ler kaldır

-- Tablo sıralaması foreign key ilişkilerine göre terslenir
DROP TABLE IF EXISTS stock_document_lines CASCADE;
DROP TABLE IF EXISTS stock_documents CASCADE;
DROP TABLE IF EXISTS stock_cost_entries CASCADE;
DROP TABLE IF EXISTS inventory_count_lines CASCADE;
DROP TABLE IF EXISTS inventory_counts CASCADE;
DROP TABLE IF EXISTS stock_balances CASCADE;
DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS warehouses CASCADE;
DROP TABLE IF EXISTS unit_conversions CASCADE;
DROP TABLE IF EXISTS units CASCADE;
DROP TABLE IF EXISTS product_barcodes CASCADE;
DROP TABLE IF EXISTS products CASCADE;

-- İlişkili index'ler otomatik olarak DROP CASCADE ile kaldırılır