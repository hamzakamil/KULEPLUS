-- 202610440000_subscription_lifecycle — down.
-- Önce suspended/cancelled premium entitlement'lar 'active'e geri alınır
-- (constraint daraltıldığında CHECK ihlali olmasın), sonra sözlük eski haline döner.

UPDATE tenant_entitlements
   SET status = 'active'
 WHERE status IN ('suspended','cancelled')
   AND module_code <> 'core';

ALTER TABLE tenant_entitlements DROP CONSTRAINT IF EXISTS tenant_entitlements_status_check;
ALTER TABLE tenant_entitlements
    ADD CONSTRAINT tenant_entitlements_status_check
    CHECK (status IN ('active','expired','revoked'));
