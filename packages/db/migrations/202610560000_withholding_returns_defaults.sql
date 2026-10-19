-- Muhasebe Faz 7-3 — KDV tevkifatı, iade faturası bağı ve tenant varsayılan verileri.
--
-- 1) withholding_types: tevkifat türleri (düzenlenebilir). Her türün e-Fatura/e-Arşiv kodu
--    (601…), KDV-2 beyanname kodu (301…), oranı (pay/10) ve geçerlilik aralığı vardır.
--    Fatura satırı türe bağlanır; kesinleşmede kodlar ve oran satıra kopyalanır (snapshot),
--    tablo sonradan değişse de eski belge değişmez. Alıştaki tevkifat 360.01.<KDV-2 kodu>
--    hesabına yazılır; KDV-2 hazırlık raporu bu kodlarla matrah/oran/tutar verir.
-- 2) invoices.withholding_total: satırlardaki tevkif edilen KDV toplamı. `total` artık
--    ödenecek tutardır (matrah + KDV − tevkifat); `tax_total` tam KDV olarak kalır.
-- 3) invoices.returned_amount: bağlı iade faturalarıyla düşülen tutar
--    (bakiye = total − paid_amount − returned_amount).
-- 4) Varsayılan veriler: kayıt ekranından açılan tenant'lara KDV oranları ve gider
--    kategorileri hiç tohumlanmıyordu (yalnızca migration anında var olanlara eklenmişti).
--    Hiç KDV oranı / gider kategorisi olmayan tenant'lara eklenir; yeni tenant'lar artık
--    oluşturulurken tohumlanır (core/tenant-defaults.ts).

CREATE TABLE IF NOT EXISTS withholding_types (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name text NOT NULL,
    einvoice_code text NOT NULL,
    kdv2_code text NOT NULL,
    rate_numerator smallint NOT NULL CHECK (rate_numerator BETWEEN 1 AND 10),
    rate_denominator smallint NOT NULL DEFAULT 10 CHECK (rate_denominator = 10),
    valid_from date NOT NULL DEFAULT DATE '2000-01-01',
    valid_to date,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version bigint NOT NULL DEFAULT 1,
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    UNIQUE (tenant_id, einvoice_code, valid_from)
);
CREATE INDEX IF NOT EXISTS idx_withholding_types_tenant ON withholding_types(tenant_id, is_active);
ALTER TABLE withholding_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS withholding_types_tenant_isolation ON withholding_types;
CREATE POLICY withholding_types_tenant_isolation ON withholding_types
    FOR ALL USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON withholding_types TO app_user;

ALTER TABLE invoice_lines
    ADD COLUMN IF NOT EXISTS withholding_type_id uuid REFERENCES withholding_types(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS withholding_einvoice_code text,
    ADD COLUMN IF NOT EXISTS withholding_kdv2_code text,
    ADD COLUMN IF NOT EXISTS withholding_amount numeric(20,8) NOT NULL DEFAULT 0;

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS withholding_total numeric(20,8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS returned_amount numeric(20,8) NOT NULL DEFAULT 0;

-- ---- Tevkifat türleri (her tenant; id deterministik — ADR-0002) ----
INSERT INTO withholding_types (id, tenant_id, name, einvoice_code, kdv2_code, rate_numerator)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid, t.id, v.name, v.einvoice_code, v.kdv2_code, v.num
FROM tenants t
CROSS JOIN (VALUES
  ('Yapım İşleri ve Mimarlık/Mühendislik', '601', 4, '301'),
  ('Danışmanlık, Denetim, Etüt, Plan-Proje', '602', 9, '302'),
  ('Makine, Demirbaş, Taşıt Bakım-Onarım', '603', 7, '303'),
  ('Yemek Servis Hizmeti (Catering)', '604', 5, '304'),
  ('Organizasyon Hizmetleri', '605', 5, '305'),
  ('İşgücü Temin Hizmetleri', '606', 9, '306'),
  ('Özel Güvenlik Hizmetleri', '607', 9, '307'),
  ('Yapı Denetim Hizmetleri', '608', 9, '308'),
  ('Fason Tekstil, Konfeksiyon, Ayakkabı', '609', 7, '309'),
  ('Turistik Mağazalara Müşteri Bulma', '610', 9, '310'),
  ('Spor Kulüplerinin Reklam/İsim Hakkı', '611', 9, '311'),
  ('Temizlik Hizmetleri', '612', 9, '312'),
  ('Çevre ve Bahçe Bakım Hizmetleri', '613', 9, '313'),
  ('Servis Taşımacılığı (Personel/Öğrenci)', '614', 5, '314'),
  ('Baskı ve Basım Hizmetleri', '615', 7, '315'),
  ('Hurda Metalden Külçe Teslimi', '617', 7, '316'),
  ('Hurda Dışı Külçe Teslimleri', '618', 7, '317'),
  ('Bakır, Çinko, Alüminyum Ürünleri', '619', 7, '318'),
  ('İstisnadan Vazgeçenlerin Hurda Teslimi', '620', 7, '319'),
  ('Atıklardan Elde Edilen Hammadde', '621', 9, '320'),
  ('Pamuk, Yün, Ham Post ve Deri', '622', 9, '321'),
  ('Ağaç ve Orman Ürünleri', '623', 5, '322'),
  ('Yük Taşımacılığı Hizmeti', '624', 2, '323'),
  ('Ticari Reklam Hizmetleri', '625', 3, '324'),
  ('Demir-Çelik Ürünlerinin Teslimi', '627', 5, '325')
) AS v(name, einvoice_code, num, kdv2_code)
CROSS JOIN LATERAL (SELECT md5(t.id::text || ':withholding_types:' || v.einvoice_code) AS h) m
ON CONFLICT DO NOTHING;

-- ---- KDV oranları: hiç oranı olmayan tenant'lara ----
INSERT INTO tax_rates (id, tenant_id, code, name, rate, is_active)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid, t.id, v.code, v.name, v.rate, true
FROM tenants t
CROSS JOIN (VALUES
  ('KDV0', 'KDV %0 (Muaf)', 0),
  ('KDV1', 'KDV %1', 1),
  ('KDV10', 'KDV %10', 10),
  ('KDV20', 'KDV %20', 20)
) AS v(code, name, rate)
CROSS JOIN LATERAL (SELECT md5(t.id::text || ':tax_rates:' || v.code) AS h) m
WHERE NOT EXISTS (SELECT 1 FROM tax_rates x WHERE x.tenant_id = t.id)
ON CONFLICT DO NOTHING;

-- ---- Gider kategorileri: hiç kategorisi olmayan tenant'lara ----
INSERT INTO expense_categories (id, tenant_id, code, name, description, grup, is_favorite, status)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid, t.id, v.code, v.name, v.description, v.grup, true, 'active'
FROM tenants t
CROSS JOIN (VALUES
  ('KIRA', 'Kira', 'İşyeri ve depo kiraları', 'kira'),
  ('ELEKTRIK', 'Elektrik', 'Elektrik faturaları', 'kamu-hizmetleri'),
  ('SU', 'Su', 'Su faturaları', 'kamu-hizmetleri'),
  ('ISINMA', 'Isınma', 'Doğalgaz, yakıt, ısınma giderleri', 'kamu-hizmetleri'),
  ('BAKIM', 'Bakım ve Onarım', 'Makine, tesis, araç bakım/onarım', 'isletme'),
  ('KUCUK_DEMIRBAS', 'Küçük Demirbaş', 'Küçük demirbaş alımları (yazıcı vb.)', 'isletme'),
  ('YIYECEK', 'Yiyecek ve İçecek', 'İşletme yeme-içme giderleri', 'isletme'),
  ('ISCILIK', 'İşçilik ve Çalışan', 'Personel ücret, sigorta, yan haklar', 'personel'),
  ('TELECOM', 'Telekom', 'Telefon ve internet giderleri', 'isletme'),
  ('NOTER', 'Noter', 'Noter harç ve tasdik giderleri', 'mevzuat'),
  ('MAHKEME', 'Mahkeme', 'Dava ve yargılama giderleri', 'mevzuat'),
  ('VERGI', 'Vergi, Harç ve Resmi Giderler', 'Vergiler, harçlar, resmi giderler', 'finansal')
) AS v(code, name, description, grup)
CROSS JOIN LATERAL (SELECT md5(t.id::text || ':expense_categories:' || v.code) AS h) m
WHERE NOT EXISTS (SELECT 1 FROM expense_categories x WHERE x.tenant_id = t.id)
ON CONFLICT DO NOTHING;
