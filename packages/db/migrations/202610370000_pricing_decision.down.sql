UPDATE prices
SET amount_monthly = NULL,
    amount_yearly = NULL
WHERE plan_version_id IN (
    SELECT pv.id FROM plan_versions pv
    JOIN plans p ON p.id = pv.plan_id
    WHERE p.code IN ('core_plus', 'enterprise') AND pv.version = 1
);
