-- Fiyatlandırma: Core+ ve Enterprise ₺ tutarlarını netleştir (K-03).
-- TR SaaS muhasebe pazarı için uygun fiyatlar belirlendi.

UPDATE prices
SET amount_monthly = 299.00,
    amount_yearly = 2990.00,
    vat_included = false
WHERE plan_version_id = (
    SELECT pv.id FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE p.code = 'core_plus' AND pv.version = 1
);

UPDATE prices
SET amount_monthly = 799.00,
    amount_yearly = 7990.00,
    vat_included = false
WHERE plan_version_id = (
    SELECT pv.id FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE p.code = 'enterprise' AND pv.version = 1
);
