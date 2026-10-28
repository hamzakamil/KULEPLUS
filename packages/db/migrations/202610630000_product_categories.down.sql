-- Down migration for 202610630000_product_categories.sql (SPEC §30.7: down zorunlu)
-- Kategori adları ürünlerdeki serbest metne geri yazılır. Eksik varsayılan birim/depo
-- tohumları geri alınmaz: ürünlerin bağlı olduğu birimler silinemez ve zararsızdır.
ALTER TABLE products ADD COLUMN IF NOT EXISTS category text;

UPDATE products p
   SET category = pc.name
  FROM product_categories pc
 WHERE p.category_id = pc.id;

DROP INDEX IF EXISTS idx_products_category_id;
ALTER TABLE products DROP COLUMN IF EXISTS category_id;
DROP TABLE IF EXISTS product_categories;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(tenant_id, category);
