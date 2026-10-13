-- Down: 202610170000_expense_categories_professional_and_vat
-- 1) KDV oranlarını eski haline getir (%20→%18, %10→%8)
UPDATE tax_rates SET rate = 18, name = 'KDV %18', updated_at = now()
WHERE code = 'KDV18' OR code = 'KDV20';

UPDATE tax_rates SET rate = 8, name = 'KDV %8', updated_at = now()
WHERE code = 'KDV8' OR code = 'KDV10';

UPDATE tax_rates SET is_active = true, updated_at = now()
WHERE code IN ('KDV8','KDV18');

-- 2) Eklenen grup/favori kolonlarını kaldır
ALTER TABLE expense_categories DROP COLUMN IF EXISTS grup;
ALTER TABLE expense_categories DROP COLUMN IF EXISTS is_favorite;

-- 3) Eklenen profesyonel kategorileri geri al (kod bazında)
DELETE FROM expense_categories
WHERE code IN ('KIRA','ELEKTRIK','SU','ISINMA','BAKIM','KUCUK_DEMIRBAS','YIYECEK','ISCILIK','TELECOM','NOTER','MAHKEME','VERGI');