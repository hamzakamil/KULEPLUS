-- Faz 6 guvenlik sertlestirmesi: permission katalogunu DB'ye senkronla
-- Kaynak: packages/shared/src/permissions.ts (TEK KAYNAK — SPEC §6.5, ADR-0006).
-- Neden: katalog kodlari yalnizca uygulamada tanimliydi; permissions tablosunda
--   seed'deki 9 eski kod (core.user.write vb.) vardi. Rol → izin atamasi bu satirlara
--   baktigi icin RBAC fiilen zorlanamiyordu (requirePermission her zaman 403 uretirdi).
-- Kural: ON CONFLICT ile upsert → katalog ile DB artik ayrisamaz.

-- Deterministik UUID: ADR-0002 (id uygulama/DB'de deterministik üretilir; gen_random_uuid() yasak).
-- id = md5('permission:' || code) → tireli uuid cast (expense_categories deseni).
INSERT INTO permissions (id, module, resource, action, code, name, delegatable, is_system_permission)
SELECT
  (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
  v.module, v.resource, v.action, v.code, v.name, v.delegatable, v.is_system_permission
FROM (
  VALUES
  ('core', 'user', 'read', 'core.user.read', 'Kullanıcıları görüntüle', true, true),
  ('core', 'user', 'create', 'core.user.create', 'Kullanıcı davet et', true, true),
  ('core', 'user', 'update', 'core.user.update', 'Kullanıcı güncelle', true, true),
  ('core', 'user', 'delete', 'core.user.delete', 'Kullanıcı kaldır', true, true),
  ('core', 'role', 'read', 'core.role.read', 'Rolleri görüntüle', true, true),
  ('core', 'role', 'manage', 'core.role.manage', 'Rol ve yetki yönet', true, true),
  ('core', 'department', 'read', 'core.department.read', 'Departmanları görüntüle', true, true),
  ('core', 'department', 'manage', 'core.department.manage', 'Departman yönet', true, true),
  ('core', 'settings', 'read', 'core.settings.read', 'Şirket ayarlarını görüntüle', true, true),
  ('core', 'settings', 'update', 'core.settings.update', 'Şirket ayarlarını güncelle', true, true),
  ('core', 'audit', 'read', 'core.audit.read', 'Denetim günlüğünü görüntüle', true, true),
  ('core', 'owner', 'transfer', 'core.owner.transfer', 'Owner devri', false, true),
  ('core', 'legal', 'read', 'core.legal.read', 'Yasal metinleri görüntüle', true, true),
  ('platform', 'tenant', 'manage', 'platform.tenant.manage', 'Tenant yönet', false, true),
  ('platform', 'application', 'manage', 'platform.application.manage', 'Şirket başvurusu incele', false, true),
  ('platform', 'plan', 'manage', 'platform.plan.manage', 'Plan ve modül kataloğu yönet', false, true),
  ('platform', 'support_access', 'grant', 'platform.support_access.grant', 'Destek erişim grantı ver', false, true),
  ('platform', 'audit', 'read', 'platform.audit.read', 'Platform denetimini görüntüle', false, true),
  ('subscription', 'plan', 'read', 'subscription.plan.read', 'Paketleri görüntüle', true, true),
  ('subscription', 'entitlement', 'read', 'subscription.entitlement.read', 'Hakları görüntüle', true, true),
  ('subscription', 'entitlement', 'manage', 'subscription.entitlement.manage', 'Manuel hak tanımla', false, true),
  ('subscription', 'usage', 'read', 'subscription.usage.read', 'Kota kullanımını görüntüle', true, true),
  ('contacts', 'contact', 'read', 'contacts.contact.read', 'Cari kartları görüntüle', true, true),
  ('contacts', 'contact', 'create', 'contacts.contact.create', 'Cari kart oluştur', true, true),
  ('contacts', 'contact', 'update', 'contacts.contact.update', 'Cari kart güncelle', true, true),
  ('contacts', 'contact', 'delete', 'contacts.contact.delete', 'Cari kart sil', true, true),
  ('contacts', 'ledger', 'read', 'contacts.ledger.read', 'Cari ekstre görüntüle', true, true),
  ('contacts', 'ledger', 'create', 'contacts.ledger.create', 'Cari hareket işle', true, true),
  ('stock', 'product', 'read', 'stock.product.read', 'Ürünleri görüntüle', true, true),
  ('stock', 'product', 'create', 'stock.product.create', 'Ürün oluştur', true, true),
  ('stock', 'product', 'update', 'stock.product.update', 'Ürün güncelle', true, true),
  ('stock', 'product', 'delete', 'stock.product.delete', 'Ürün sil', true, true),
  ('stock', 'movement', 'post', 'stock.movement.post', 'Stok hareketi işle', true, true),
  ('stock', 'movement', 'adjust', 'stock.movement.adjust', 'Stok düzeltme işle', true, true),
  ('trade', 'invoice', 'read', 'trade.invoice.read', 'Faturaları görüntüle', true, true),
  ('trade', 'invoice', 'create', 'trade.invoice.create', 'Fatura oluştur', true, true),
  ('trade', 'invoice', 'update', 'trade.invoice.update', 'Fatura güncelle', true, true),
  ('trade', 'invoice', 'delete', 'trade.invoice.delete', 'Fatura sil', true, true),
  ('trade', 'invoice', 'approve', 'trade.invoice.approve', 'Fatura onayla / kesinleştir', false, true),
  ('trade', 'expense', 'read', 'trade.expense.read', 'Giderleri görüntüle', true, true),
  ('trade', 'expense', 'create', 'trade.expense.create', 'Gider oluştur', true, true),
  ('trade', 'expense', 'update', 'trade.expense.update', 'Gider güncelle', true, true),
  ('trade', 'expense', 'delete', 'trade.expense.delete', 'Gider sil', true, true),
  ('einvoice', 'document', 'read', 'einvoice.document.read', 'e-Dönüşüm belgelerini görüntüle', true, true),
  ('einvoice', 'document', 'create', 'einvoice.document.create', 'e-Dönüşüm belgesi oluştur', true, true),
  ('einvoice', 'document', 'send', 'einvoice.document.send', 'e-Dönüşüm belgesi gönder', true, true),
  ('einvoice', 'document', 'cancel', 'einvoice.document.cancel', 'e-Dönüşüm belgesi iptal', true, true),
  ('accounting', 'entry', 'read', 'accounting.entry.read', 'Yevmiye fişlerini görüntüle', true, true),
  ('accounting', 'entry', 'create', 'accounting.entry.create', 'Yevmiye fişi oluştur', true, true),
  ('accounting', 'entry', 'update', 'accounting.entry.update', 'Yevmiye fişi güncelle', true, true),
  ('accounting', 'entry', 'delete', 'accounting.entry.delete', 'Yevmiye fişi sil', true, true),
  ('accounting', 'entry', 'approve', 'accounting.entry.approve', 'Yevmiye fişi onayla (post)', false, true)
) AS v(module, resource, action, code, name, delegatable, is_system_permission)
CROSS JOIN LATERAL (SELECT md5('permission:' || v.code) AS h) m
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      name = EXCLUDED.name,
      delegatable = EXCLUDED.delegatable,
      is_system_permission = true;
