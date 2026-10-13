-- Belge numaralarının sayısal kısmını 9 haneye çıkarma + faturayı ortak formata alma.
--
-- Ortak kural: PREFIKS-YIL-9HANE  (ör. TKL-2026-000000001, FAT-2026-000000001)
--
-- Önceki durum:
--   Teklif/Sipariş/Satın Alma/İrsaliye : TKL-2026-000001   (6 hane)
--   Fatura                             : FAT-000001        (yıl yok, 6 hane)
--
-- Bu migration mevcut (legacy) kayıtları da yeni formata taşır. Idempotenttir:
-- zaten 9 haneli olan kayıtlar tekrar işlenmez.

-- ===== 1) Teklif / Sipariş / Satın Alma / İrsaliye → sayısal kısmı 9 haneye sıfırla =====
UPDATE sales_quotes
SET number = regexp_replace(number, '-(\d+)$', '-' || lpad(split_part(number, '-', 3), 9, '0'))
WHERE number ~ '^[A-Z]+-\d{4}-\d{1,8}$';

UPDATE sales_orders
SET number = regexp_replace(number, '-(\d+)$', '-' || lpad(split_part(number, '-', 3), 9, '0'))
WHERE number ~ '^[A-Z]+-\d{4}-\d{1,8}$';

UPDATE purchase_orders
SET number = regexp_replace(number, '-(\d+)$', '-' || lpad(split_part(number, '-', 3), 9, '0'))
WHERE number ~ '^[A-Z]+-\d{4}-\d{1,8}$';

UPDATE deliveries
SET number = regexp_replace(number, '-(\d+)$', '-' || lpad(split_part(number, '-', 3), 9, '0'))
WHERE number ~ '^[A-Z]+-\d{4}-\d{1,8}$';

-- ===== 2) Fatura → yıl ekle ve sayısal kısmı 9 haneye çıkar =====
UPDATE invoices
SET number =
  split_part(number, '-', 1) || '-' || to_char(issue_date, 'YYYY') || '-' ||
  lpad(split_part(number, '-', 2), 9, '0')
WHERE number ~ '^[A-Z]+-\d{1,8}$';

-- ===== 3) Fatura sıra tablosunda yıl bazlı sayaçlar zaten tutuluyor (fiscal_year) =====
-- Ek işlem gerekmez; yeni numaralar application katmanında üretilir.
