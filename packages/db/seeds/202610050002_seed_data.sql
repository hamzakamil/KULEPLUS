-- Faz 1: Seed verileri -- SPEC §8, §8.2, ADR-0011
-- K-02 limitleri: Cari 500, Stok 200, Ayda 100 import satırı, 1 özel rol

-- ===== MODULES (GOVERNANCE §2) =====
INSERT INTO modules (code, name, description, is_core) VALUES
  ('core', 'Çekirdek', 'Kimlik, kiracı, yetki, denetim, yasal metinler', true),
  ('platform', 'Platform', 'Platform yönetimi, destek, faturalama', true),
  ('contacts', 'Cari Hesap', 'Müşteri/tedarikçi kartları, ekstre, yaşlandırma', false),
  ('stock', 'Stok', 'Ürün/hizmet kartları, birim, depo, hareket, maliyet', false),
  ('trade', 'Fatura & Belgeler', 'Teklif, sipariş, irsaliye, fatura, gider', false),
  ('cashbank', 'Kasa & Banka', 'Kasa/banka hesapları, tahsilat, ödeme, eşleştirme', false),
  ('einvoice', 'e-Dönüşüm', 'e-Fatura, e-Arşiv, e-İrsaliye, e-Defter', false),
  ('subscription', 'Abonelik Altyapısı', 'Plan, limit, hak, kullanım sayaçları', false),
  ('accounting', 'Muhasebe', 'Yevmiye, kebir, dönem işlemleri, SMMM', false),
  ('cheque', 'Çek / Senet', 'Çek, senet, vadesiz çek, protesto', false),
  ('reports_plus', 'Gelişmiş Raporlar', 'Yapılandırılabilir raporlar, dashboard', false),
  ('management', 'Yönetim Paketi', 'Patron paneli, onay akışları, görevler', false),
  ('sms', 'SMS Kredisi', 'SMS/WhatsApp gönderim kredisi', false),
  ('integrations', 'Entegrasyonlar', 'ERP/Market/API entegrasyonları', false)
ON CONFLICT (code) DO NOTHING;

-- ===== FEATURES (modül başına) =====
-- deterministik UUID (ADR-0002): id = md5('feature:' || module_code || ':' || code)
INSERT INTO features (id, module_code, code, name)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid, v.module_code, v.code, v.name
FROM (
  VALUES
  ('contacts', 'contact.read', 'Cari okuma'),
  ('contacts', 'contact.write', 'Cari yazma'),
  ('contacts', 'contact.import', 'Cari içe aktarma'),
  ('contacts', 'contact.export', 'Cari dışa aktarma'),
  ('stock', 'product.read', 'Ürün okuma'),
  ('stock', 'product.write', 'Ürün yazma'),
  ('stock', 'stock.movement', 'Stok hareketi'),
  ('stock', 'stock.import', 'Stok içe aktarma'),
  ('trade', 'invoice.read', 'Fatura okuma'),
  ('trade', 'invoice.write', 'Fatura yazma'),
  ('trade', 'invoice.approve', 'Fatura onay'),
  ('trade', 'expense.read', 'Gider okuma'),
  ('trade', 'expense.write', 'Gider yazma'),
  ('cashbank', 'account.read', 'Kasa/banka okuma'),
  ('cashbank', 'account.write', 'Kasa/banka yazma'),
  ('cashbank', 'payment.read', 'Tahsilat/ödeme okuma'),
  ('cashbank', 'payment.write', 'Tahsilat/ödeme yazma'),
  ('cashbank', 'reconcile', 'Banka eşleştirme'),
  ('einvoice', 'send', 'e-Fatura gönder'),
  ('einvoice', 'receive', 'e-Fatura al'),
  ('einvoice', 'status', 'Durum sorgulama'),
  ('subscription', 'plan.manage', 'Plan yönetimi'),
  ('subscription', 'limit.check', 'Limit kontrolü'),
  ('subscription', 'entitlement.grant', 'Hak verme')
) AS v(module_code, code, name)
CROSS JOIN LATERAL (SELECT md5('feature:' || v.module_code || ':' || v.code) AS h) m
ON CONFLICT (module_code, code) DO NOTHING;

-- ===== PLANS =====
-- deterministik UUID (ADR-0002): id = md5('plan:' || code)
INSERT INTO plans (id, code, name, description, is_active)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid, v.code, v.name, v.description, v.is_active
FROM (
  VALUES
  ('free', 'Başlangıç (Ücretsiz)', 'Cari VEYA Stok — sınırsız süre, 1 özel rol', true),
  ('core_plus', 'Çekirdek+', 'Cari + Stok + Fatura + Kasa/Banka', true),
  ('enterprise', 'Kurumsal', 'Tüm modüller + Yönetim + Entegrasyonlar', true)
) AS v(code, name, description, is_active)
CROSS JOIN LATERAL (SELECT md5('plan:' || v.code) AS h) m
ON CONFLICT (code) DO NOTHING;

-- deterministik UUID (ADR-0002): id = md5('plan_version:' || code || ':' || version)
INSERT INTO plan_versions (id, plan_id, version, effective_from)
SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid, p.id, v.version, v.effective_from
FROM (VALUES ('free', 1, '2026-10-05'::date), ('core_plus', 1, '2026-10-05'::date), ('enterprise', 1, '2026-10-05'::date)) AS v(code, version, effective_from)
JOIN plans p ON p.code = v.code
CROSS JOIN LATERAL (SELECT md5('plan_version:' || v.code || ':' || v.version) AS h) m
ON CONFLICT (plan_id, version) DO NOTHING;

-- ===== PLAN FEATURES =====
INSERT INTO plan_features (plan_version_id, feature_id, included)
SELECT pv.id, f.id, true
FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id JOIN features f ON f.module_code IN ('contacts','stock')
WHERE p.code = 'free' AND pv.version = 1
ON CONFLICT DO NOTHING;

INSERT INTO plan_features (plan_version_id, feature_id, included)
SELECT pv.id, f.id, true
FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id JOIN features f ON f.module_code IN ('contacts','stock','trade','cashbank')
WHERE p.code = 'core_plus' AND pv.version = 1
ON CONFLICT DO NOTHING;

INSERT INTO plan_features (plan_version_id, feature_id, included)
SELECT pv.id, f.id, true
FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id JOIN features f ON true
WHERE p.code = 'enterprise' AND pv.version = 1
ON CONFLICT DO NOTHING;

-- ===== PLAN LIMITS (K-02) =====
INSERT INTO plan_limits (plan_version_id, limit_key, value) VALUES
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'free' AND pv.version = 1), 'max_contacts', '500'::jsonb),
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'free' AND pv.version = 1), 'max_products', '200'::jsonb),
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'free' AND pv.version = 1), 'max_import_rows_monthly', '100'::jsonb),
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'free' AND pv.version = 1), 'max_custom_roles', '1'::jsonb)
ON CONFLICT (plan_version_id, limit_key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO plan_limits (plan_version_id, limit_key, value) VALUES
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'core_plus' AND pv.version = 1), 'max_contacts', 'null'::jsonb),
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'core_plus' AND pv.version = 1), 'max_products', 'null'::jsonb),
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'core_plus' AND pv.version = 1), 'max_import_rows_monthly', 'null'::jsonb),
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'core_plus' AND pv.version = 1), 'max_custom_roles', 'null'::jsonb)
ON CONFLICT (plan_version_id, limit_key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO plan_limits (plan_version_id, limit_key, value) VALUES
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'enterprise' AND pv.version = 1), 'max_contacts', 'null'::jsonb),
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'enterprise' AND pv.version = 1), 'max_products', 'null'::jsonb),
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'enterprise' AND pv.version = 1), 'max_import_rows_monthly', 'null'::jsonb),
  ((SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id WHERE p.code = 'enterprise' AND pv.version = 1), 'max_custom_roles', 'null'::jsonb)
ON CONFLICT (plan_version_id, limit_key) DO UPDATE SET value = EXCLUDED.value;

-- ===== PRICES =====
-- deterministik UUID (ADR-0002): id = md5('price:' || plan || ':' || currency)
INSERT INTO prices (id, plan_version_id, currency, amount_monthly, amount_yearly, vat_included)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid, pv.id, v.currency, v.amount_monthly, v.amount_yearly, v.vat_included
FROM (VALUES
  ('free', 'TRY', 0::numeric, 0::numeric, true),
  ('core_plus', 'TRY', 299.00::numeric, 2990.00::numeric, false),
  ('enterprise', 'TRY', 799.00::numeric, 7990.00::numeric, false)
) AS v(plan_code, currency, amount_monthly, amount_yearly, vat_included)
JOIN plans p ON p.code = v.plan_code
JOIN plan_versions pv ON pv.plan_id = p.id AND pv.version = 1
CROSS JOIN LATERAL (SELECT md5('price:' || v.plan_code || ':1:' || v.currency) AS h) m
ON CONFLICT DO NOTHING;

-- ===== CORE PERMISSIONS =====
-- deterministik UUID (ADR-0002): id = md5('permission:' || code)
INSERT INTO permissions (id, module, resource, action, code, name, is_system_permission)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid, v.module, v.resource, v.action, v.code, v.name, v.is_system_permission
FROM (
  VALUES
  ('core', 'user', 'read', 'core.user.read', 'Kullanıcı okuma', true),
  ('core', 'user', 'write', 'core.user.write', 'Kullanıcı yazma', true),
  ('core', 'tenant', 'read', 'core.tenant.read', 'Tenant okuma', true),
  ('core', 'tenant', 'write', 'core.tenant.write', 'Tenant yazma', true),
  ('core', 'role', 'read', 'core.role.read', 'Rol okuma', true),
  ('core', 'role', 'write', 'core.role.write', 'Rol yazma', true),
  ('core', 'permission', 'read', 'core.permission.read', 'Permission okuma', true),
  ('core', 'owner', 'transfer', 'core.owner.transfer', 'Owner transfer', true),
  ('core', 'legal', 'accept', 'core.legal.accept', 'Yasal metin kabul', true)
) AS v(module, resource, action, code, name, is_system_permission)
CROSS JOIN LATERAL (SELECT md5('permission:' || v.code) AS h) m
ON CONFLICT (code) DO NOTHING;

-- ===== YASAL METİN SEED (ADR-0011) =====
-- Not: id NOT NULL'dır ve default YOK (UUID v7 kuralı — SPEC §0.1).
-- Seed'de deterministik UUID v7 benzeri sabit değerler kullanılır.
INSERT INTO legal_texts (id, code, version, title, content) VALUES
  ('01920000-0000-7000-8000-000000000001', 'kvkk', '1.0', 'KVKK Aydınlatma Metni', 'İçerik hukukçu tarafından doldurulacak.'),
  ('01920000-0000-7000-8000-000000000002', 'kullanim_kosullari', '1.0', 'Kullanım Koşulları', 'İçerik hukukçu tarafından doldurulacak.'),
  ('01920000-0000-7000-8000-000000000003', 'cerez', '1.0', 'Çerez Politikası', 'İçerik hukukçu tarafından doldurulacak.')
ON CONFLICT (code) DO NOTHING;
