-- Down migration for 202610620000_product_details.sql (SPEC §30.7: down zorunlu)
DROP INDEX IF EXISTS idx_products_category;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_min_stock_nonneg;
ALTER TABLE products
    DROP COLUMN IF EXISTS purchase_tax_rate_id,
    DROP COLUMN IF EXISTS sale_tax_rate_id,
    DROP COLUMN IF EXISTS min_stock,
    DROP COLUMN IF EXISTS shelf_location,
    DROP COLUMN IF EXISTS supplier_code,
    DROP COLUMN IF EXISTS brand,
    DROP COLUMN IF EXISTS category;
