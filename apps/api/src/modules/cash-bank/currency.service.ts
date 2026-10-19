import { createHash } from 'node:crypto';
import { getPool } from '@kuleplus/db';
import type { PoolClient } from 'pg';
import { AppError, newId } from '@kuleplus/shared';
import { ensureChartOfAccountsOn } from '../accounting/chart.js';
import { allocateEntryNo, openPeriodFor } from '../accounting/ledger.js';
import { cashBankLedgerAccount } from '../accounting/subledger.js';
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
  accountType: string;
  rateDate: string;
  foreignPosition: number;
  currentBaseValue: number;
  newBaseValue: number;
  diff: number;
  rateAvailable: boolean;
}

/** Havuzdan bağlantı alıp tenant bağlamını kurar (ortak yardımcı). */
async function connectAsTenant(tenantId: string): Promise<PoolClient> {
  const pool = getPool('app');
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  return client;
}

/** Değerleme satırlarını hesaplar; yazma yapmaz (rapor ve fiş üretiminin ortak girdisi). */
async function collectRevaluationLines(
  tenantId: string,
  valuationDate: string,
): Promise<{ entries: ExchangeRevaluationRow[]; totalDiff: number }> {
  const client = await connectAsTenant(tenantId);
  try {
    // Dövizli kasa/banka hesaplarını bul (currency <> 'TRY')
    const accounts = await client.query<{
      id: string;
      account_name: string;
      currency: string;
      account_type: string;
      opening_balance: string;
      balance: string;
    }>(
      `SELECT id, account_name, currency, account_type, opening_balance, balance FROM cash_bank_accounts
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
        accountType: acc.account_type,
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

/** Dönem sonu değerleme: dövizli kasa/banka bakiyelerinin son kura göre TL karşılığı + kur farkı raporu. */
export async function revalueForeignBalances(
  tenantId: string,
  valuationDate: string,
  _userId: string,
): Promise<{
  entries: ExchangeRevaluationRow[];
  totalDiff: number;
}> {
  return collectRevaluationLines(tenantId, valuationDate);
}

// ===== Dönem sonu değerleme FİŞİ (kapanış kaydı) — Faz 6.6 =====

/** Aynı seed için her zaman aynı UUID üretir (idempotans — ADR-0017). */
function deterministicUuid(seed: string): string {
  const hash = createHash('md5').update(seed).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Hesap planında kod ile hesap çözer (tenant planı; yoksa null). */
async function resolveAccountByCodeLocal(client: PoolClient, code: string): Promise<string | null> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM accounting_accounts
      WHERE tenant_id = current_tenant_id() AND code = $1 LIMIT 1`,
    [code],
  );
  return r.rows[0]?.id ?? null;
}

/**
 * Kasa/banka hesap türü için TL karşılık muhasebe hesabı.
 * Tahsilat/ödeme fişlerindeki `account_mappings` ('cash'/'bank') → TDHP fallback.
 */
async function resolveCashBankAccountForType(
  client: PoolClient,
  accountType: string,
): Promise<string | null> {
  const sourceType = accountType === 'bank' ? 'bank' : 'cash';
  const fallbackCode = accountType === 'bank' ? '102' : '100';
  const mapped = await client.query<{ id: string }>(
    `SELECT aa.id
       FROM account_mappings am
       JOIN accounting_accounts aa ON aa.id = am.account_id AND aa.tenant_id = am.tenant_id
      WHERE am.tenant_id = current_tenant_id() AND am.source_type = $1
      LIMIT 1`,
    [sourceType],
  );
  if (mapped.rows.length > 0) return mapped.rows[0].id;
  return resolveAccountByCodeLocal(client, fallbackCode);
}

export interface RevaluationJournalResult {
  entries: ExchangeRevaluationRow[];
  totalDiff: number;
  /** Yazılan/var olan fişin id'si; fiş üretilemediyse null. */
  journalEntryId: string | null;
  /** Bu çağrıda yeni fiş mi yazıldı, yoksa önceki fiş mi kullanıldı? */
  booked: boolean;
  entryNo?: number;
}

/**
 * Dönem sonu değerleme + KAPANIŞ FİŞİ üretir (idempotent — ADR-0017).
 *
 * Değerlemeyi `revalueForeignBalances` ile aynı kurallarla hesaplar; fark
 * 646 (kambiyo kârı) / 656 (kambiyo zararı) hesaplarına karşılık, kasa/banka
 * TL karşılık hesabı (account_mappings | 100/102) ile dengeli bir `mahsup`
 * yevmiye fişi olarak `posted` statüsünde yazar.
 *
 * Aynı değerleme tarihi için ikinci çalıştırma yeni fiş yazmaz
 * (deterministik source_id + `idx_journal_entries_revaluation_once`).
 * Fark eşiği: mutlak değeri 0.005 TL'nin altındaki hesaplar fişe yazılmaz.
 */
export async function bookRevaluationJournal(
  tenantId: string,
  valuationDate: string,
  userId: string,
): Promise<RevaluationJournalResult> {
  const report = await collectRevaluationLines(tenantId, valuationDate);
  if (report.entries.length === 0) {
    return { entries: [], totalDiff: 0, journalEntryId: null, booked: false };
  }

  const client = await connectAsTenant(tenantId);
  try {
    // Idempotans: aynı değerleme tarihi için fiş varsa yeni fiş yazma.
    const sourceId = deterministicUuid(`${tenantId}:${valuationDate}`);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM journal_entries
        WHERE tenant_id = current_tenant_id()
          AND source_type = 'revaluation' AND source_id = $1
        LIMIT 1`,
      [sourceId],
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return {
        entries: report.entries,
        totalDiff: report.totalDiff,
        journalEntryId: existing.rows[0].id,
        booked: false,
      };
    }

    // Fiş için gereken hesaplar — TDHP şablonu gerekirse bootstrap edilir.
    await ensureChartOfAccountsOn(client);
    const gainAccount = await resolveAccountByCodeLocal(client, '646');
    const lossAccount = await resolveAccountByCodeLocal(client, '656');

    // Satırları topla: hesap başına denge (borç = alacak, |fark|).
    type Line = { accountId: string; debit: number; credit: number };
    const lines: Line[] = [];
    for (const e of report.entries) {
      if (!e.rateAvailable) continue;
      const absDiff = round2(Math.abs(e.diff));
      if (absDiff < 0.005) continue;
      const fxAccountId = e.diff > 0 ? gainAccount : lossAccount;
      // Değerleme hesap bazındadır: farkı o kasa/bankanın kendi alt hesabına yaz (Faz 7-1).
      const cashAccountId =
        (await cashBankLedgerAccount(client, e.accountId)) ??
        (await resolveCashBankAccountForType(client, e.accountType));
      if (!fxAccountId || !cashAccountId) continue;
      if (e.diff > 0) {
        // Varlık artışı: Borç kasa/banka, Alacak 646 (kambiyo kârı).
        lines.push({ accountId: cashAccountId, debit: absDiff, credit: 0 });
        lines.push({ accountId: fxAccountId, debit: 0, credit: absDiff });
      } else {
        // Varlık azalışı: Borç 656 (kambiyo zararı), Alacak kasa/banka.
        lines.push({ accountId: fxAccountId, debit: absDiff, credit: 0 });
        lines.push({ accountId: cashAccountId, debit: 0, credit: absDiff });
      }
    }

    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
    if (lines.length === 0 || Math.abs(totalDebit - totalCredit) >= 0.005) {
      await client.query('COMMIT');
      return {
        entries: report.entries,
        totalDiff: report.totalDiff,
        journalEntryId: null,
        booked: false,
      };
    }

    // Gap-free fiş numarası (aynı tenant içinde eşzamanlılık kilidinde — SPEC §12.3).
    // Dönem kapısı: kapalı döneme / kilit tarihinden önceye değerleme fişi yazılamaz.
    const periodId = await openPeriodFor(client, valuationDate);
    const entryNo = await allocateEntryNo(client);
    const entryId = newId();
    const description = `Dönem sonu kur değerleme ${valuationDate} (${report.entries.length} döviz hesap)`;

    await client.query(
      `INSERT INTO journal_entries
         (id, tenant_id, entry_no, entry_date, period_id, entry_type, status, description,
          source_type, source_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
       VALUES ($1, current_tenant_id(), $2, $3, $4, 'mahsup', 'posted', $5, 'revaluation', $6, $7, $7, $8, now(), $8, $8)`,
      [entryId, entryNo, valuationDate, periodId, description, sourceId, totalDebit, userId],
    );

    let lineNo = 1;
    for (const l of lines) {
      await client.query(
        `INSERT INTO journal_lines
           (id, tenant_id, entry_id, line_no, account_id, description, debit, credit, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8)`,
        [newId(), entryId, lineNo, l.accountId, description, l.debit, l.credit, userId],
      );
      lineNo++;
    }

    // ADR-0016: denetim izi — fiş aynı transaction'da kaydedilir.
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, new_values, created_at)
       VALUES ($1, current_tenant_id(), $2, 'post', 'revaluation', $3, $4, now())`,
      [
        newId(),
        userId,
        entryId,
        JSON.stringify({
          valuation_date: valuationDate,
          total_diff: report.totalDiff,
          entry_no: entryNo,
        }),
      ],
    );

    await client.query('COMMIT');
    return {
      entries: report.entries,
      totalDiff: report.totalDiff,
      journalEntryId: entryId,
      booked: true,
      entryNo,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
