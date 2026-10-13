-- Down: 202610180000_stock_units_warehouses_seed
DELETE FROM units WHERE code IN ('ADET','KG','LT','MT','PAKET','KUTU');
DELETE FROM warehouses WHERE code = 'MERKEZ';