-- 202610410000_billing_dunning.sql — down
DROP TABLE IF EXISTS dunning_attempts;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS grace_period_until;
