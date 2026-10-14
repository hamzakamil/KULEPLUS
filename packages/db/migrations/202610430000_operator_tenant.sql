-- Faz 4 Hat B — İşletmeci şirket tenant damgası (SPEC §8.9).
-- "Platform satış gelirleri tenantların satış faturalarından ayrı" ve
-- "İşletmeci şirketin resmi muhasebesi için ayrı işletmeci tenant
--  (tenants.is_operator = TRUE, tek satır; idempotent aktarım)".
-- İşletmeci şirket (Kuleplus) kendi resmi muhasebesini ayrı bir operatör
-- tenant'ta yürütür; bu flag o tenant'ı damgalar.
-- Tek satır kuralı: partial unique index — en fazla 1 operatör tenant.
-- Yalnızca kolon + index ekler (tablo/izin/permission kataloğu değişmez);
-- mevcut satırlar FALSE alır, mevcut INSERT'ler kolon listesi verdiği için
-- davranış bozulmaz (identity/company service'leri is_operator belirtmez).

ALTER TABLE tenants
    ADD COLUMN is_operator boolean NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenants.is_operator
    IS 'Operatör (işletmeci şirket) tenant damgası — SPEC §8.9, tek satır';

-- En fazla bir operatör tenant (SPEC §8.9 "tek satır"; idempotent).
CREATE UNIQUE INDEX uq_tenants_single_operator
    ON tenants ((TRUE))
    WHERE is_operator;
