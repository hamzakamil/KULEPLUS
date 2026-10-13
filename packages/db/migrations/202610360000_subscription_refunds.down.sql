-- Down: 202610360000_subscription_refunds.sql
-- Not: iade kayıtları silinmeden ödeme durumu eski 3 durumlu sözlüğe dönemez;
-- bu yüzden önce ödemeler eski kabul edilen durumlara normalize edilir.
UPDATE billing_payments SET status = 'succeeded'
 WHERE status IN ('partially_refunded','refunded','disputed');

ALTER TABLE billing_payments DROP CONSTRAINT IF EXISTS billing_payments_status_check;
ALTER TABLE billing_payments
  ADD CONSTRAINT billing_payments_status_check
  CHECK (status IN ('pending','succeeded','failed'));

DROP TABLE IF EXISTS billing_allocations;
DROP TABLE IF EXISTS billing_refunds;
