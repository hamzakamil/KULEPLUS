-- Faz 2: Stok altyapısı — varsayılan birimler + ürün listesine stok bakiyesi.
--
-- 1) `units` tablosu boştu; `products.unit_id` NOT NULL olduğu için ürün
--    oluşturmak imkânsızdı. Her tenant'a standart birim seti eklenir.
-- 2) `listProducts` sorgusu `stock_balances` ile birleşerek `quantity` döndürür —
--    stok sayfası ürün bazlı mevcut miktarı gösterebilsin.

-- ===== 1) Varsayılan birimler (her tenant, deterministik UUID) =====
INSERT INTO units (id, tenant_id, code, name, abbreviation, is_base, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'ADET', 'Adet', 'adet', true, now(), now()
FROM (SELECT id, md5(id::text || ':units:ADET') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM units u WHERE u.tenant_id = t.id AND u.code = 'ADET');

INSERT INTO units (id, tenant_id, code, name, abbreviation, is_base, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'KG', 'Kilogram', 'kg', false, now(), now()
FROM (SELECT id, md5(id::text || ':units:KG') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM units u WHERE u.tenant_id = t.id AND u.code = 'KG');

INSERT INTO units (id, tenant_id, code, name, abbreviation, is_base, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'LT', 'Litre', 'lt', false, now(), now()
FROM (SELECT id, md5(id::text || ':units:LT') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM units u WHERE u.tenant_id = t.id AND u.code = 'LT');

INSERT INTO units (id, tenant_id, code, name, abbreviation, is_base, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'MT', 'Metre', 'm', false, now(), now()
FROM (SELECT id, md5(id::text || ':units:MT') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM units u WHERE u.tenant_id = t.id AND u.code = 'MT');

INSERT INTO units (id, tenant_id, code, name, abbreviation, is_base, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'PAKET', 'Paket', 'paket', false, now(), now()
FROM (SELECT id, md5(id::text || ':units:PAKET') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM units u WHERE u.tenant_id = t.id AND u.code = 'PAKET');

INSERT INTO units (id, tenant_id, code, name, abbreviation, is_base, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'KUTU', 'Kutu', 'kutu', false, now(), now()
FROM (SELECT id, md5(id::text || ':units:KUTU') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM units u WHERE u.tenant_id = t.id AND u.code = 'KUTU');

-- ===== 2) Varsayılan depo (her tenant) =====
INSERT INTO warehouses (id, tenant_id, code, name, is_base, is_active, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'MERKEZ', 'Merkez Depo', true, true, now(), now()
FROM (SELECT id, md5(id::text || ':warehouses:MERKEZ') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.tenant_id = t.id AND w.code = 'MERKEZ');

-- ===== İzinler =====
GRANT SELECT, INSERT, UPDATE, DELETE ON units, warehouses TO app_user;