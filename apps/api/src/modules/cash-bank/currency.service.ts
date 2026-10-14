import { getPool } from '@kuleplus/db';
import {
  upsertRates as sharedUpsertRates,
  getRate as sharedGetRate,
  getLatestRate as sharedGetLatestRate,
  calculateRateDifference as sharedCalculateRateDifference,
  type TCMBRate,
} from '@kuleplus/shared';

/**
 * Döviz Kur Servisi (API katmanı) — Faz 6.2 (SPEC §9.2).
 *
 * Shared modüldeki iş mantığını API context'ine (tenant GUC, pool) bağlar.
 */

export type { TCMBRate };

export interface ExchangeRateRow {
  id: string;
  rateDate: string;
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  source: string;
  createdAt: string;
}

/** TCMB XML'ini çeker ve parse eder (shared modülü kullanır). */
export { fetchTCMBRates } from '@kuleplus/shared';

/** Kurları exchange_rates tablosuna upsert eder (tenant bazlı). */
export async function upsertRates(
  tenantId: string,
  rates: TCMBRate[],
  options?: { baseCurrency?: string; source?: string; userId?: string },
): Promise<{ inserted: number; updated: number }> {
  const pool = getPool('app');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await sharedUpsertRates(client, tenantId, rates, options);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Belirli tarih ve para birimi çifti için kur getirir. */
export async function getRate(
  tenantId: string,
  targetCurrency: string,
  rateDate: string,
  baseCurrency = 'TRY',
  source = 'TCMB',
): Promise<number | null> {
  const pool = getPool('app');
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return sharedGetRate(client, tenantId, targetCurrency, rateDate, baseCurrency, source);
  } finally {
    client.release();
  }
}

/** En son kuru getirir (tarih verilmemişse). */
export async function getLatestRate(
  tenantId: string,
  targetCurrency: string,
  baseCurrency = 'TRY',
  source = 'TCMB',
): Promise<{ rate: number; date: string } | null> {
  const pool = getPool('app');
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return sharedGetLatestRate(client, tenantId, targetCurrency, baseCurrency, source);
  } finally {
    client.release();
  }
}

/** Kur farkı: iki tarih arasındaki kur değişimi oranı. */
export async function calculateRateDifference(
  tenantId: string,
  targetCurrency: string,
  fromDate: string,
  toDate: string,
  baseCurrency = 'TRY',
  source = 'TCMB',
): Promise<{ fromRate: number; toRate: number; diffPercent: number } | null> {
  const pool = getPool('app');
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return sharedCalculateRateDifference(
      client,
      tenantId,
      targetCurrency,
      fromDate,
      toDate,
      baseCurrency,
      source,
    );
  } finally {
    client.release();
  }
}

/** Dönem sonu değerleme: dövizli bakiyeleri son kura göre yeniden hesaplar (taslak). */
export async function revalueForeignBalances(
  tenantId: string,
  _valuationDate: string,
  _userId: string,
): Promise<{
  entries: Array<{ currency: string; oldValue: number; newValue: number; diff: number }>;
}> {
  const pool = getPool('app');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    // Dövizli kasa/banka hesaplarını bul (currency <> 'TRY')
    const accounts = await client.query<{ id: string; currency: string; balance: string }>(
      `SELECT id, currency, balance FROM cash_bank_accounts
        WHERE tenant_id = current_tenant_id() AND currency <> 'TRY' AND status = 'active'`,
    );

    const entries: Array<{ currency: string; oldValue: number; newValue: number; diff: number }> =
      [];

    for (const acc of accounts.rows) {
      const latestRate = await sharedGetLatestRate(client, tenantId, acc.currency, 'TRY', 'TCMB');
      if (!latestRate) continue;

      // balance TRY cinsindendir; döviz cinsinden ayrı kolon gerektirir (Faz 6.3)
      entries.push({
        currency: acc.currency,
        oldValue: 0,
        newValue: 0,
        diff: 0,
      });
    }

    await client.query('COMMIT');
    return { entries };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
