-- Stok ürün kartı ayrıntıları (muhasebe/ticaret için en çok gereken alanlar).
--  * sale_tax_rate_id / purchase_tax_rate_id : ürünün varsayılan satış/alış KDV oranı;
--    fatura satırında ürün seçilince oran buradan gelir (tax_rates tablosuna bağlı).
--  * min_stock : kritik stok seviyesi; toplam miktar bu değerin altına inince uyarı.
--  * category / brand / supplier_code / shelf_location : sınıflandırma, tedarikçi
--    ürün kodu ve depodaki raf konumu (serbest metin).
-- Tüm sütunlar boş/varsayılan değerlidir: mevcut kayıtlar ve eski istemciler etkilenmez.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS category text,
    ADD COLUMN IF NOT EXISTS brand text,
    ADD COLUMN IF NOT EXISTS supplier_code text,
    ADD COLUMN IF NOT EXISTS shelf_location text,
    ADD COLUMN IF NOT EXISTS min_stock numeric(20,8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sale_tax_rate_id uuid REFERENCES tax_rates(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS purchase_tax_rate_id uuid REFERENCES tax_rates(id) ON DELETE SET NULL;

ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_min_stock_nonneg;
ALTER TABLE products
    ADD CONSTRAINT products_min_stock_nonneg CHECK (min_stock >= 0);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(tenant_id, category);
