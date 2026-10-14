-- Faz 4 Hat B — Abonelik yaşam döngüsü (SPEC §8.7/§8.8).
-- Tenent entitlement durum sözlüğüne 'suspended' ve 'cancelled' eklenir.
-- requireEntitlement yalnızca 'active'i geçirdiğinden, premium modüller bu
-- durumlarda backend'de otomatik kapanır (ücretsiz plana düşme + iptal).
-- 'core' modülü ücretsizdir ve kapatılmaz (kod tarafı module_code <> 'core').
-- Yalnızca CHECK genişletir; tablo/izin/katalog değişmez (ALTER ... ADD CONSTRAINT).

ALTER TABLE tenant_entitlements DROP CONSTRAINT IF EXISTS tenant_entitlements_status_check;
ALTER TABLE tenant_entitlements
    ADD CONSTRAINT tenant_entitlements_status_check
    CHECK (status IN ('active','expired','revoked','suspended','cancelled'));
