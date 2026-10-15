-- 202610500000_tenant_settings_key_rows.sql geri alınması.
--
-- DİKKAT: UNIQUE(tenant_id) yalnızca her şirketin TEK ayar satırı varsa
-- geri eklenebilir (PK tenant_id+key çok satıra izin verir). Birden fazla
-- satır varsa ALTER aşağıda patlar ve geri alma durur — veri kaybına
-- yol açmamak için sessizce yok saymak yerine gürültülü davranması yeğlendi.

ALTER TABLE tenant_settings DROP COLUMN IF EXISTS settings;

ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_tenant_id_unique UNIQUE (tenant_id);
