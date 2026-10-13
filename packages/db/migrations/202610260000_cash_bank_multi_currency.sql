-- Faz 6.3: Çoklu para birimi — cash_bank için exchange_rate kolonu
-- Belge düzeyinde kur: hareketin döviz cinsinden tutarı ve TL karşılığı

-- ===== cash_bank_accounts: temel para birimi (base_currency) =====
ALTER TABLE cash_bank_accounts
  ADD COLUMN IF NOT EXISTS base_currency CHAR(3) NOT NULL DEFAULT 'TRY';

-- Hesap bakiyesi her zaman base_currency cinsindendir (TRY).
-- currency kolonu hesap para birimini, base_currency baz para birimini (hesap birimi = TRY cinsinden tutulur) belirtir.

-- ===== cash_bank_movements: exchange_rate ve base_amount =====
ALTER TABLE cash_bank_movements
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(20,8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(20,8) GENERATED ALWAYS AS (amount * exchange_rate) STORED;

-- base_amount = amount * exchange_rate (hesap para birimi cinsinden, yani TRY karşılığı)
-- Bu sayede dövizli hareketin TL karşılığı saklanır ve raporlamada kullanılır.

-- ===== İndeksler =====
CREATE INDEX IF NOT EXISTS idx_cash_bank_movements_currency ON cash_bank_movements(tenant_id, currency);
CREATE INDEX IF NOT EXISTS idx_cash_bank_movements_base_amount ON cash_bank_movements(tenant_id, base_amount);

-- ===== RLS zaten mevcut, ekstra policy gerekmez =====

-- ===== İzinler =====
GRANT SELECT, INSERT, UPDATE, DELETE ON cash_bank_accounts, cash_bank_movements TO app_user;