import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import {
  upsertRates as sharedUpsertRates,
  getRate as sharedGetRate,
  getLatestRate as sharedGetLatestRate,
  calculateRateDifference as sharedCalculateRateDifference,
  computeRateRevaluation,
  fetchTCMBRates,
  type TCMBRate,
} from '@kuleplus/shared';

/**
 * Döviz Kur Servisi (API katmanı) — Faz 6.2 (SPEC §9.1/§9.2).
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

function mapRateRow(r: { [k: string]: unknown }): ExchangeRateRow {
  return {
    id: String(r.id),
    rateDate: String(r.rate_date),
    baseCurrency: String(r.base_currency),
    targetCurrency: String(r.target_currency),
    rate: Number(r.rate),
    source: String(r.source),
    createdAt: r.updated_at ? String(r.updated_at) : String(r.created_at ?? ''),
  };
}

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

export interface ExchangeRateListQuery {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  currency?: string;
  baseCurrency?: string;
  source?: string;
}

/** Sayfalı döviz kuru listesi (Faz 6.2). */
export async function listRates(tenantId: string, query: ExchangeRateListQuery = {}) {
  const pool = getPool('app');
  const { page = 1, limit = 20, from, to, currency, baseCurrency = 'TRY', source = 'TCMB' } = query;
  const offset = (page - 1) * limit;

  const conditions = ['tenant_id = $1', 'base_currency = $2'];
  const values: unknown[] = [tenantId, baseCurrency];
  let idx = 3;
  if (from) {
    conditions.push(`rate_date >= $${idx++}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`rate_date <= $${idx++}`);
    values.push(to);
  }
  if (currency) {
    conditions.push(`target_currency = $${idx++}`);
    values.push(currency);
  }
  if (source && source !== 'TCMB') {
    conditions.push(`source = $${idx++}`);
    values.push(source);
  }

  const where = conditions.join(' AND ');
  const [itemsRes, countRes] = await Promise.all([
    pool.query(
      `SELECT id, tenant_id, rate_date, base_currency, target_currency, rate, source, created_at, updated_at
         FROM exchange_rates
        WHERE ${where}
        ORDER BY rate_date DESC, target_currency ASC
        LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset],
    ),
    pool.query(`SELECT COUNT(*) AS total FROM exchange_rates WHERE ${where}`, values),
  ]);

  return {
    items: itemsRes.rows.map((r: { [k: string]: unknown }) => mapRateRow(r)),
    page,
    limit,
    total: Number(countRes.rows[0].total),
    totalPages: Math.ceil(Number(countRes.rows[0].total) / limit),
  };
}

/** Her para birimi için en son kur (DISTINCT ON target_currency). */
export async function latestRates(tenantId: string, baseCurrency = 'TRY', source = 'TCMB') {
  const pool = getPool('app');
  const r = await pool.query(
    `SELECT DISTINCT ON (target_currency) target_currency, rate, rate_date, source
       FROM exchange_rates
      WHERE tenant_id = $1 AND base_currency = $2 AND source = $3
      ORDER BY target_currency, rate_date DESC`,
    [tenantId, baseCurrency, source],
  );
  const rows = r.rows as Array<{
    target_currency: string;
    rate: string;
    rate_date: string;
    source: string;
  }>;
  return {
    items: rows.map((row) => ({
      currency: row.target_currency,
      rate: Number(row.rate),
      rateDate: row.rate_date,
      source: row.source,
    })),
    asOf: rows[0]?.rate_date ?? null,
  };
}

/** TCMB'den kurları çeker ve tenant'a upsert eder (kullanıcı tetikli). */
export async function importRates(
  tenantId: string,
  userId: string,
  rateDate?: string,
): Promise<{ count: number; inserted: number; updated: number }> {
  const rates = await fetchTCMBRates(rateDate);
  if (rates.length === 0) {
    throw new AppError('EXTERNAL_SERVICE_ERROR', 'TCMB kur servisi boş sonuç döndürdü');
  }
  const result = await upsertRates(tenantId, rates, { userId });
  return { count: rates.length, ...result };
}

export interface ExchangeRevaluationRow {
  accountId: string;
  accountName: string;
  currency: string;
  rateDate: string;
  foreignPosition: number;
  currentBaseValue: number;
  newBaseValue: number;
  diff: number;
  rateAvailable: boolean;
}

/** Dönem sonu değerleme: dövizli kasa/banka bakiyelerinin son kura göre TL karşılığı + kur farkı raporu. */
export async function revalueForeignBalances(
  tenantId: string,
  valuationDate: string,
  _userId: string,
): Promise<{
  entries: ExchangeRevaluationRow[];
  totalDiff: number;
}> {
  const pool = getPool('app');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    // Dövizli kasa/banka hesaplarını bul (currency <> 'TRY')
    const accounts = await client.query<{
      id: string;
      account_name: string;
      currency: string;
      opening_balance: string;
      balance: string;
    }>(
      `SELECT id, account_name, currency, opening_balance, balance FROM cash_bank_accounts
        WHERE tenant_id = current_tenant_id() AND currency <> 'TRY' AND status = 'active'`,
    );

    const entries: ExchangeRevaluationRow[] = [];
    let totalDiff = 0;

    for (const acc of accounts.rows) {
      // Hesap para birimindeki net hareket toplamı (deposit − withdrawal).
      // Transfer satırları da amount'u hedef hesabın kurundan yazdığı için
      // döviz pozisyonuna dahil edilir (Faz 6.3).
      const moves = await client.query<{ net: string }>(
        `SELECT COALESCE(SUM(CASE WHEN movement_type = 'deposit' THEN amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN movement_type = 'withdrawal' THEN amount ELSE 0 END), 0) AS net
           FROM cash_bank_movements
          WHERE account_id = $1 AND movement_type IN ('deposit', 'withdrawal')`,
        [acc.id],
      );
      const foreignPosition = Number(acc.opening_balance) + Number(moves.rows[0]?.net ?? 0);
      const currentBaseValue = Number(acc.balance);

      const latestRate = await sharedGetLatestRate(client, tenantId, acc.currency, 'TRY', 'TCMB');
      const valuation = computeRateRevaluation({
        foreignPosition,
        currentBaseValue,
        latestRate: latestRate?.rate ?? 0,
      });

      entries.push({
        accountId: acc.id,
        accountName: acc.account_name,
        currency: acc.currency,
        rateDate: latestRate?.date ?? valuationDate,
        ...valuation,
      });
      totalDiff += valuation.diff;
    }

    await client.query('COMMIT');
    return { entries, totalDiff };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
