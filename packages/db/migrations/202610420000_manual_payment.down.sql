-- Down: 202610420000_manual_payment.down.sql
ALTER TABLE commercial_orders DROP COLUMN IF EXISTS payment_method;
