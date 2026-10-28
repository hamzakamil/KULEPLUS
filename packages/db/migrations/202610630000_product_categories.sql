-- Ürün kategorileri: serbest metin (products.category) yerine yönetilebilir liste.
--  * product_categories : tenant'a ait kategori listesi (ad, tenant içinde büyük/küçük
--    harf duyarsız tekil). Stok ekranında eklenir, yeniden adlandırılır, silinir, birleştirilir.
--  * products.category_id : ürünün kategorisi; kategori silinirse ürün "kategorisiz" kalır.
--  * Mevcut serbest metin kategoriler listeye taşınır, products.category kaldırılır.
--
-- Ek olarak: 202610180000 varsayılan birim/depoyu yalnızca o gün var olan şirketlere
-- tohumlamıştı; sonradan açılan şirketlerde birim listesi boştu ve ürün oluşturulamıyordu
-- (products.unit_id NOT NULL). Uygulama artık yeni şirkete ensureTenantDefaults ile ekler;
-- burada eksik kalmış mevcut şirketler tamamlanır. Yalnızca hiç birimi/deposu olmayanlara
-- dokunulur, kendi birimlerini tanımlamış şirketlerin listesi değişmez.

-- ===== 1) Kategori tablosu =====
CREATE TABLE IF NOT EXISTS product_categories (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_name
    ON product_categories(tenant_id, lower(name));

-- ===== 2) Ürün → kategori bağlantısı =====
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES product_categories(id) ON DELETE SET NULL;

-- Mevcut serbest metin kategorileri listeye taşı (büyük/küçük harf farkı tek kategoriye iner).
-- products.category yalnızca bu migration'dan önceki şemada vardır; yeniden çalıştırmada atlanır.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'category'
    ) THEN
        INSERT INTO product_categories (id, tenant_id, name)
        SELECT md5(c.tenant_id::text || ':product_categories:' || lower(c.name))::uuid, c.tenant_id, c.name
        FROM (
            SELECT DISTINCT ON (tenant_id, lower(btrim(category)))
                   tenant_id, btrim(category) AS name
            FROM products
            WHERE category IS NOT NULL AND btrim(category) <> ''
            ORDER BY tenant_id, lower(btrim(category)), btrim(category)
        ) c
        ON CONFLICT DO NOTHING;

        UPDATE products p
           SET category_id = pc.id
          FROM product_categories pc
         WHERE p.category IS NOT NULL
           AND pc.tenant_id = p.tenant_id
           AND lower(pc.name) = lower(btrim(p.category));
    END IF;
END $$;

DROP INDEX IF EXISTS idx_products_category;
ALTER TABLE products DROP COLUMN IF EXISTS category;
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(tenant_id, category_id);

-- ===== RLS =====
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_categories_tenant_isolation ON product_categories;
CREATE POLICY product_categories_tenant_isolation ON product_categories
    FOR ALL USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON product_categories TO app_user;

-- ===== 3) Eksik kalmış varsayılan birimler ve depo (yalnızca hiç kaydı olmayan şirketler) =====
INSERT INTO units (id, tenant_id, code, name, abbreviation, is_base, created_at, updated_at)
SELECT md5(t.id::text || ':units:' || d.code)::uuid, t.id, d.code, d.name, d.abbreviation, d.is_base, now(), now()
FROM tenants t
CROSS JOIN (VALUES
    ('ADET',  'Adet',     'adet',  true),
    ('KG',    'Kilogram', 'kg',    false),
    ('LT',    'Litre',    'lt',    false),
    ('MT',    'Metre',    'm',     false),
    ('PAKET', 'Paket',    'paket', false),
    ('KUTU',  'Kutu',     'kutu',  false)
) AS d(code, name, abbreviation, is_base)
WHERE NOT EXISTS (SELECT 1 FROM units u WHERE u.tenant_id = t.id)
ON CONFLICT DO NOTHING;

INSERT INTO warehouses (id, tenant_id, code, name, is_base, is_active, created_at, updated_at)
SELECT md5(t.id::text || ':warehouses:MERKEZ')::uuid, t.id, 'MERKEZ', 'Merkez Depo', true, true, now(), now()
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.tenant_id = t.id)
ON CONFLICT DO NOTHING;
