import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';

/**
 * Döviz Kur Yardımcıları — Hem API hem Worker'dan kullanılabilir (shared).
 *
 * SPEC §9.2: TCMB kur içe aktarma, kur farkı, dönem sonu değerleme.
 */

type PoolLike = Pool | PoolClient;

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';

export interface TCMBRate {
  code: string;
  name: string;
  unit: number;
  forexBuying: number;
  forexSelling: number;
  effectiveDate: string;
}

/** TCMB XML'ini çeker ve parse eder. */
export async function fetchTCMBRates(date?: string): Promise<TCMBRate[]> {
  let url = TCMB_URL;
  if (date) {
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    url = `https://www.tcmb.gov.tr/kurlar/${day}${month}${year}.xml`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new AppError('EXTERNAL_SERVICE_ERROR', `TCMB kur servisi erişilemedi: ${res.status}`);
  }
  const xml = await res.text();

  const currencyMatches = xml.matchAll(
    /<Currency\s+[^>]*Kod="([^"]+)"[^>]*>\s*<Unit>([\d.]+)<\/Unit>\s*<Isim[^>]*>([^<]+)<\/Isim>\s*<ForexBuying>([\d.]+)?<\/ForexBuying>\s*<ForexSelling>([\d.]+)?<\/ForexSelling>/g,
  );

  const rates: TCMBRate[] = [];
  for (const match of currencyMatches) {
    const [, code, unit, name, buying, selling] = match;
    const rate = selling ? parseFloat(selling) : buying ? parseFloat(buying) : null;
    if (rate && rate > 0) {
      rates.push({
        code,
        name,
        unit: parseInt(unit, 10),
        forexBuying: buying ? parseFloat(buying) : 0,
        forexSelling: selling ? parseFloat(selling) : 0,
        effectiveDate: date ?? new Date().toISOString().slice(0, 10),
      });
    }
  }
  return rates;
}

/** Kurları exchange_rates tablosuna upsert eder (tenant bazlı). */
export async function upsertRates(
  pool: PoolLike,
  tenantId: string,
  rates: TCMBRate[],
  options?: { baseCurrency?: string; source?: string; userId?: string },
): Promise<{ inserted: number; updated: number }> {
  const base = options?.baseCurrency ?? 'TRY';
  const source = options?.source ?? 'TCMB';
  let inserted = 0;
  let updated = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    for (const r of rates) {
      const trPerUnit = r.forexSelling / r.unit;
      const rateValue = 1 / trPerUnit;

      const res = await client.query(
        `INSERT INTO exchange_rates
           (id, tenant_id, rate_date, base_currency, target_currency, rate, source, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (tenant_id, rate_date, base_currency, target_currency, source)
         DO UPDATE SET rate = EXCLUDED.rate, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [newId(), r.effectiveDate, base, r.code, rateValue, source, options?.userId ?? null],
      );
      if (res.rows[0].inserted) inserted++;
      else updated++;
    }

    await client.query('COMMIT');
    return { inserted, updated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client && typeof client === 'object' && 'release' in client) {
      (client as { release?: () => void }).release?.();
    }
  }
}

/** Belirli tarih ve para birimi çifti için kur getirir. */
export async function getRate(
  pool: PoolLike,
  tenantId: string,
  targetCurrency: string,
  rateDate: string,
  baseCurrency = 'TRY',
  source = 'TCMB',
): Promise<number | null> {
  const r = await pool.query<{ rate: string }>(
    `SELECT rate FROM exchange_rates
      WHERE tenant_id = $1 AND rate_date = $2 AND base_currency = $3 AND target_currency = $4 AND source = $5
      LIMIT 1`,
    [tenantId, rateDate, baseCurrency, targetCurrency, source],
  );
  return r.rows.length > 0 ? Number(r.rows[0].rate) : null;
}

/** En son kuru getirir (tarih verilmemişse). */
export async function getLatestRate(
  pool: PoolLike,
  tenantId: string,
  targetCurrency: string,
  baseCurrency = 'TRY',
  source = 'TCMB',
): Promise<{ rate: number; date: string } | null> {
  const r = await pool.query<{ rate: string; rate_date: string }>(
    `SELECT rate, rate_date FROM exchange_rates
      WHERE tenant_id = $1 AND base_currency = $2 AND target_currency = $3 AND source = $4
      ORDER BY rate_date DESC LIMIT 1`,
    [tenantId, baseCurrency, targetCurrency, source],
  );
  if (r.rows.length === 0) return null;
  return { rate: Number(r.rows[0].rate), date: r.rows[0].rate_date };
}

/** Kur farkı: iki tarih arasındaki kur değişimi oranı. */
export async function calculateRateDifference(
  pool: PoolLike,
  tenantId: string,
  targetCurrency: string,
  fromDate: string,
  toDate: string,
  baseCurrency = 'TRY',
  source = 'TCMB',
): Promise<{ fromRate: number; toRate: number; diffPercent: number } | null> {
  const r = await pool.query<{ rate: string; rate_date: string }>(
    `SELECT rate, rate_date FROM exchange_rates
      WHERE tenant_id = $1 AND base_currency = $2 AND target_currency = $3 AND source = $4
        AND rate_date IN ($5, $6)
      ORDER BY rate_date`,
    [tenantId, baseCurrency, targetCurrency, source, fromDate, toDate],
  );
  if (r.rows.length !== 2) return null;
  const from = Number(r.rows[0].rate);
  const to = Number(r.rows[1].rate);
  if (from === 0) return { fromRate: from, toRate: to, diffPercent: 0 };
  return {
    fromRate: from,
    toRate: to,
    diffPercent: ((to - from) / from) * 100,
  };
}
