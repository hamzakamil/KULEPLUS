-- Down: 202610350000_subscription_billing.down.sql
DELETE FROM permissions WHERE code LIKE 'subscription.subscription.%';
DROP TABLE IF EXISTS partner_commissions;
DROP TABLE IF EXISTS partner_referrals;
DROP TABLE IF EXISTS partners;
DROP TABLE IF EXISTS coupon_redemptions;
DROP TABLE IF EXISTS coupons;
DROP TABLE IF EXISTS provider_webhook_events;
DROP TABLE IF EXISTS billing_invoice_lines;
DROP TABLE IF EXISTS billing_invoices;
DROP TABLE IF EXISTS billing_payments;
DROP TABLE IF EXISTS payment_attempts;
DROP TABLE IF EXISTS commercial_order_items;
DROP TABLE IF EXISTS commercial_orders;
DROP TABLE IF EXISTS subscription_changes;
DROP TABLE IF EXISTS subscription_items;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS module_dependencies;
