-- Faz 6: Cek/Senet modulu geri alma (SPEC §30.7: down SQL zorunlu).
DROP TABLE IF EXISTS cheque_portfolio;
DROP TABLE IF EXISTS cheque_transactions;
DROP TABLE IF EXISTS cheques;

-- Permission katalog senkronunun geri alinmasi: yalnizca bu Faz 6 migration'inin
-- ekledigi cheque.* kodlari silinir.
DELETE FROM permissions WHERE code IN (
    'cheque.cheque.read',
    'cheque.cheque.create',
    'cheque.cheque.update',
    'cheque.cheque.delete',
    'cheque.cheque.manage'
);
