-- Geri alma: belge numaralarını önceki 6 haneli (fatura: yılsız) biçime döndürür.
-- DİKKAT: Yıkıcıdır — bilgi kaybı olabilir (örn. yıl bilgisi faturada korunur ama
-- sayısal kısım kısaltılır). Yalnızca geliştirme ortamında kullanılmalıdır.

UPDATE sales_quotes
SET number = regexp_replace(number, '-(\d+)$', '-' || split_part(number, '-', 3))
WHERE number ~ '^[A-Z]+-\d{4}-\d{9}$';

UPDATE sales_orders
SET number = regexp_replace(number, '-(\d+)$', '-' || split_part(number, '-', 3))
WHERE number ~ '^[A-Z]+-\d{4}-\d{9}$';

UPDATE purchase_orders
SET number = regexp_replace(number, '-(\d+)$', '-' || split_part(number, '-', 3))
WHERE number ~ '^[A-Z]+-\d{4}-\d{9}$';

UPDATE deliveries
SET number = regexp_replace(number, '-(\d+)$', '-' || split_part(number, '-', 3))
WHERE number ~ '^[A-Z]+-\d{4}-\d{9}$';

UPDATE invoices
SET number = split_part(number, '-', 1) || '-' || split_part(number, '-', 3)
WHERE number ~ '^[A-Z]+-\d{4}-\d{9}$';
