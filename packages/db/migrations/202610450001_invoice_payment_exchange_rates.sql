-- Faz 6.6: Kur farkı muhasebeleştirme altyapısı — tahsilat/ödeme kuru + TRY karşılığı
-- addPayment artık ödeme günü kuruyla (çözülebildiğinde) TRY karşılık hesaplar; fatura kuru
-- ile fark 645 (kambiyo kârı) / 655 (kambiyo zararı) hesaplarına kur farkı olarak yazılır.
-- Denetim ve dönem sonu değerleme (revalue) için ödemenin kuru ve TRY karşılığı kalıcı tutulur.

ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(20,8);