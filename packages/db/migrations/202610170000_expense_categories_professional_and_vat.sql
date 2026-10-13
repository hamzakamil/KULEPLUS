-- Faz 5: Gider kategorileri — profesyonel gruplama (kira, elektrik, su, ısınma,
-- bakım/onarım, küçük demirbaş, yiyecek-içecek, işçilik, telekom, noter, mahkeme,
-- vergi/harç/resmi) + KDV oranı güncellemesi (%8→%10, %18→%20).
--
-- 1) KDV oranları Türkiye mevzuatına göre güncellenir: KDV8 → %10, KDV18 → %20.
--    Kod ve id DEĞİŞMEZ (mevcut fatura satırlarının FK referansları korunur);
--    yalnızca rate/name güncellenir → kullanıcı %10/%20 görür.
-- 2) expense_categories: `grup` (görsel gruplama) + `is_favorite` (öne çıkarma).
-- 3) Her tenant için 12 profesyonel gider kategorisi (deterministik name-based UUID,
--    SPEC §0.1 / ADR-0002). Tekrar çalıştırılabilir (WHERE NOT EXISTS).

-- ===== 1) KDV oranları: %8 → %10, %18 → %20 =====
UPDATE tax_rates SET rate = 10, name = 'KDV %10', updated_at = now()
WHERE (code = 'KDV8' OR rate = 8) AND is_active = true;

UPDATE tax_rates SET rate = 20, name = 'KDV %20', updated_at = now()
WHERE (code = 'KDV18' OR rate = 18) AND is_active = true;

-- ===== 2) Gider kategorisi: grup + favori alanları =====
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS grup text;
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

-- ===== 3) Profesyonel gider kategorileri (her tenant, deterministik UUID) =====
-- Kira
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'KIRA', 'Kira', 'İşyeri ve depo kiraları', 'kira', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:KIRA') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'KIRA');

-- Elektrik
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'ELEKTRIK', 'Elektrik', 'Elektrik faturaları', 'kamu-hizmetleri', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:ELEKTRIK') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'ELEKTRIK');

-- Su
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'SU', 'Su', 'Su faturaları', 'kamu-hizmetleri', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:SU') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'SU');

-- Isınma
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'ISINMA', 'Isınma', 'Doğalgaz, yakıt, ısınma giderleri', 'kamu-hizmetleri', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:ISINMA') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'ISINMA');

-- Bakım ve Onarım
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'BAKIM', 'Bakım ve Onarım', 'Makine, tesis, araç bakım/onarım', 'isletme', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:BAKIM') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'BAKIM');

-- Küçük Demirbaş
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'KUCUK_DEMIRBAS', 'Küçük Demirbaş', 'Küçük demirbaş alımları (yazıcı vb.)', 'isletme', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:KUCUK_DEMIRBAS') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'KUCUK_DEMIRBAS');

-- Yiyecek ve İçecek
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'YIYECEK', 'Yiyecek ve İçecek', 'İşletme yeme-içme giderleri', 'isletme', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:YIYECEK') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'YIYECEK');

-- İşçilik ve Çalışan
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'ISCILIK', 'İşçilik ve Çalışan', 'Personel ücret, sigorta, yan haklar', 'personel', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:ISCILIK') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'ISCILIK');

-- Telekom
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'TELECOM', 'Telekom', 'Telefon ve internet giderleri', 'isletme', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:TELECOM') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'TELECOM');

-- Noter
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'NOTER', 'Noter', 'Noter harç ve tasdik giderleri', 'mevzuat', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:NOTER') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'NOTER');

-- Mahkeme
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'MAHKEME', 'Mahkeme', 'Dava ve yargılama giderleri', 'mevzuat', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:MAHKEME') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'MAHKEME');

-- Vergi, Harç ve Resmi Giderler
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status, created_at, updated_at)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid,
       t.id, 'VERGI', 'Vergi, Harç ve Resmi Giderler', 'Vergiler, harçlar, resmi giderler', 'finansal', true, 'active', now(), now()
FROM (SELECT id, md5(id::text || ':expense_categories:VERGI') AS h FROM tenants) t
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id AND ec.code = 'VERGI');

-- ===== İzinler =====
GRANT SELECT, INSERT, UPDATE, DELETE ON expense_categories, tax_rates TO app_user;