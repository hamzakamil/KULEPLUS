-- Faz 6.6: Dönem sonu değerleme fişi — idempotans garantisi (ADR-0017)
-- Aynı değerleme tarihi için yalnızca bir kapanış fişi yazılabilir
-- (source_type = 'revaluation', source_id = deterministik kur tarihi karması).
-- Servis "mevcut fiş" kontrolünün yanında veritabanı seviyesinde de çift yazmayı engeller.
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_revaluation_once
  ON journal_entries (tenant_id, source_id)
  WHERE source_type = 'revaluation';
