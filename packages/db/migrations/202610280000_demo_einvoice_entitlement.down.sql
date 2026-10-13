-- 202610280000_demo_einvoice_entitlement geri al
DELETE FROM tenant_entitlements
WHERE module_code = 'einvoice'
  AND tenant_id IN (SELECT id FROM tenants WHERE name = 'Demo Sirket');
