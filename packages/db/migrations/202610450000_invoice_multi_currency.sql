-- Faz 6.5: Dövizli fatura — kur tarihi + TRY (yerel) toplam karşılığı
-- invoices.currency / invoices.exchange_rate zaten mevcut (Faz 3).
-- Eksik olan: kurun referans tarihi (rate_date) ve belge toplamının TRY karşılığı (base_total).

-- ===== invoices: rate_date + base_total =====
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS rate_date date,
  -- rate_date: dövizli faturanın kurunun referans alındığı tarih (varsayılan: issue_date).
  -- TRY faturalarda NULL kalır (kur anlamlı değildir).
  ADD COLUMN IF NOT EXISTS base_total NUMERIC(20,8)
    GENERATED ALWAYS AS (total * exchange_rate) STORED;

-- base_total = total * exchange_rate → belgenin TRY (yerel) karşılığı.
-- Generated STORED olduğu için değer DB tarafında her zaman tutarlıdır;
-- otomatik muhasebeleştirme (postInvoice) bu tutarı TRY hesaplarına yazar.

-- ===== İndeksler =====
CREATE INDEX IF NOT EXISTS idx_invoices_base_total ON invoices(tenant_id, base_total);
CREATE INDEX IF NOT EXISTS idx_invoices_rate_date ON invoices(tenant_id, rate_date);

-- ===== RLS zaten mevcut, ekstra policy gerekmez =====
