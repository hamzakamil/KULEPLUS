-- Faz 4 Hat A (einvoice): geliştirme demo tenant'ı ("Demo Sirket") için entitlement.
--
-- Bağlam: einvoice ücretli eklentidir; otomatik hak Faz 4 Hat B (subscription)
-- aktivasyon zinciriyle gelecek. Bu seed, Hat B'den ÖNCE manuel/demo doğrulamaların
-- (uçtan uca gönderim, worker akışı) requireEntitlement('einvoice') engeline
-- takılmaması için gereklidir. Demo tenant yoksa (temiz DB) bu INSERT no-op'tur.
-- Idempotent: PK (tenant_id, module_code) üzerinden ON CONFLICT DO NOTHING.
INSERT INTO tenant_entitlements (tenant_id, module_code, plan_version_id, status, granted_at)
SELECT id, 'einvoice', NULL, 'active', now()
FROM tenants
WHERE name = 'Demo Sirket'
ON CONFLICT (tenant_id, module_code) DO NOTHING;
