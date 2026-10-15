-- ADR-0023: `tenant_settings` şema sürükmesinin (drift) kapatılması.
--
-- Neden gerekli?
--   1) Tablo `202610050001_core_schema.sql`'de PRIMARY KEY (tenant_id, key) ile
--      tanımlandı: anahtar/değer satırları (one row per key). Canlı şemada ayrıca
--      `tenant_settings_tenant_id_unique` UNIQUE(tenant_id) bulunuyor → bir şirket
--      için İKİNCİ anahtar satırı yazılamıyor. Bu, şirket açan her akışı kırıyor:
--      platform onayı (`company/service.ts` → `processApplication`) ve kendi kendine
--      kayıt (`identity/service.ts` → `bootstrapTenant`) önce `onboarding_mode`,
--      sonra `company_profile` satırını yazar → duplicate key hatası.
--   2) `settings` (jsonb) kolonu hiçbir migration'da tanımlı değil ama
--      `company/service.ts` → `updateSettings` onu yazıyor. Yani migration'lardan
--      sıfırdan kurulan bir veritabanında Ayarlar kaydı çöker. Kolon buraya taşındı.
--
-- Bu migration YALNIZCA kısıtı kaldırır ve eksik kolonu ekler; veri silinmez.
-- Not: `tenant_settings_tenant_id_unique` psql çıktısında "Indexes" altında çıkar —
-- yani tabloya sonradan eklenmiş AYRIK (constraint olmayan) UNIQUE INDEX'tir;
-- `DROP CONSTRAINT` onu silmez, `DROP INDEX` gerekir.
DROP INDEX IF EXISTS tenant_settings_tenant_id_unique;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3) Canlı şemada `value` kolonunun varsayılanı var (`'{}'::jsonb`), migration
--    tanımında yoktu → `updateSettings` gibi `value` yazmayan INSERT'ler sıfırdan
--    kurulmuş bir DB'de NOT NULL'a çarpar. Varsayılan migration'a da bağlanır.
ALTER TABLE tenant_settings ALTER COLUMN value SET DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenant_settings.settings IS
  'Şirket profili ayarları (Ayarlar → Firma Profili); key=value satırlarından bağımsız blob.';
