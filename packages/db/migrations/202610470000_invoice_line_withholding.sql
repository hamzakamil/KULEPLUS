-- Faz 6.4: KDV hazırlık raporu — satır bazlı tevkifat oranı (%).
-- invoice_lines'ta satır düzeyinde tevkifat/stopaj oranı tutar; 0 = tevkifat yok.
-- report.service.vatReport, il.withholding_rate'ı tax_amount ile çarparak
-- tevkifat sonrası KDV'yi hesaplar (SPEC §9.3, ROADMAP Faz 6.4).
ALTER TABLE invoice_lines
  ADD COLUMN withholding_rate numeric(8,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN invoice_lines.withholding_rate
  IS 'Satır bazlı tevkifat oranı (%); 0 = tevkifat yok (KDV hazırlık raporu, Faz 6.4).';
