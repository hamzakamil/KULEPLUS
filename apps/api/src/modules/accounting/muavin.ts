import { AppError } from '@kuleplus/shared';
import { toKurus, todayIso } from './ledger';
import { accountingService } from './service';

/**
 * Hesap muavini (yardımcı defter dökümü): bir hesabın (alt hesaplarıyla) ya da bir kod ön ekinin
 * (ör. gelir tablosundaki "63" Faaliyet Giderleri) tarih aralığındaki hareketleri, devir bakiyesi
 * ve yürüyen bakiyeyle. Raporlarla aynı kural: `to` tarihinin mali yılına ait kapanış fişi
 * varsayılan olarak dahil edilmez (kapatılan yılda bakiye sıfır görünmesin).
 */
export interface AccountLedgerInput {
  /** Hesap kodu; alt hesapları (`kod.%`) de kapsar. */
  code?: string;
  /** Kod ön eki (`63` → 630, 631, 632 …). `code` yoksa kullanılır. */
  prefix?: string;
  from?: string;
  to?: string;
  include_closing?: boolean;
  /** Dışlanacak kaynak türleri (gelir tablosundan açılınca `year_end_result`). */
  exclude_sources?: string[];
  limit?: number;
}

const MAX_ROWS = 2000;

export async function accountLedger(input: AccountLedgerInput, tenantId?: string) {
  const code = input.code?.trim();
  const prefix = input.prefix?.trim();
  if (!code && !prefix)
    throw new AppError('VALIDATION_ERROR', 'Hesap kodu (code) veya ön ek (prefix) gerekli');
  if (!/^[0-9.]+$/.test(code ?? prefix ?? '')) {
    throw new AppError('VALIDATION_ERROR', 'Hesap kodu yalnızca rakam ve nokta içerebilir');
  }
  const today = todayIso();
  const to = input.to ?? today;
  const from = input.from ?? `${to.slice(0, 4)}-01-01`;
  const limit = Math.min(Math.max(Number(input.limit ?? MAX_ROWS), 1), MAX_ROWS);
  const excludeSources = input.exclude_sources ?? [];
  const includeClosing = input.include_closing ?? false;

  return accountingService.withTenantClient(tenantId, async (client) => {
    // $1 = kod/önek deseni, $2 = tam eşleşme kodu (önek modunda NULL)
    const match = code ? `(a.code = $1 OR a.code LIKE $1 || '.%')` : `a.code LIKE $1 || '%'`;
    const pattern = code ?? prefix!;
    const head = await client.query(
      `SELECT code, name FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1`,
      [pattern],
    );
    if (code && !head.rows[0]) throw new AppError('NOT_FOUND', `${code} hesabı bulunamadı`);

    const entryFilter = `
      je.status = 'posted'
      AND ($4::boolean OR NOT (je.entry_type = 'kapanis' AND je.fiscal_year = COALESCE(
            (SELECT fp.year FROM fiscal_periods fp
              WHERE fp.tenant_id = current_tenant_id() AND $3::date BETWEEN fp.start_date AND fp.end_date
              ORDER BY fp.start_date DESC LIMIT 1),
            EXTRACT(YEAR FROM $3::date)::int)))
      AND NOT (COALESCE(je.source_type, '') = ANY($5::text[]))`;
    const params = [pattern, from, to, includeClosing, excludeSources];

    const opening = await client.query(
      `SELECT COALESCE((SELECT SUM(a.opening_debit) FROM accounting_accounts a
                         WHERE a.tenant_id = current_tenant_id() AND ${match}), 0)
              + COALESCE(SUM(jl.debit), 0) AS debit,
              COALESCE((SELECT SUM(a.opening_credit) FROM accounting_accounts a
                         WHERE a.tenant_id = current_tenant_id() AND ${match}), 0)
              + COALESCE(SUM(jl.credit), 0) AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounting_accounts a ON a.id = jl.account_id
        WHERE jl.tenant_id = current_tenant_id() AND ${match}
          AND je.entry_date < $2::date AND ${entryFilter}`,
      params,
    );
    const totals = await client.query(
      `SELECT COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit, COUNT(*)::int AS n
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounting_accounts a ON a.id = jl.account_id
        WHERE jl.tenant_id = current_tenant_id() AND ${match}
          AND je.entry_date BETWEEN $2::date AND $3::date AND ${entryFilter}`,
      params,
    );
    const rows = await client.query(
      `SELECT jl.id AS line_id, je.id AS entry_id, je.entry_no, je.fiscal_year,
              to_char(je.entry_date, 'YYYY-MM-DD') AS entry_date, je.entry_type,
              je.description AS entry_description, jl.description AS line_description,
              a.code AS account_code, a.name AS account_name, jl.debit, jl.credit,
              je.source_type, je.source_id,
              (SELECT string_agg(DISTINCT oa.code, ', ' ORDER BY oa.code)
                 FROM journal_lines ol JOIN accounting_accounts oa ON oa.id = ol.account_id
                WHERE ol.entry_id = je.id AND ol.account_id <> jl.account_id
                  AND (CASE WHEN jl.debit > 0 THEN ol.credit > 0 ELSE ol.debit > 0 END)) AS counter_accounts
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounting_accounts a ON a.id = jl.account_id
        WHERE jl.tenant_id = current_tenant_id() AND ${match}
          AND je.entry_date BETWEEN $2::date AND $3::date AND ${entryFilter}
        ORDER BY je.entry_date, je.fiscal_year, je.entry_no, jl.line_no
        LIMIT $6`,
      [...params, limit],
    );

    const openD = toKurus(opening.rows[0].debit);
    const openC = toKurus(opening.rows[0].credit);
    let run = openD - openC;
    const items = rows.rows.map((r) => {
      const d = toKurus(r.debit);
      const c = toKurus(r.credit);
      run += d - c;
      return {
        line_id: String(r.line_id),
        entry_id: String(r.entry_id),
        entry_no: r.entry_no === null ? null : Number(r.entry_no),
        fiscal_year: Number(r.fiscal_year),
        entry_date: String(r.entry_date),
        entry_type: String(r.entry_type),
        description: String(r.line_description || r.entry_description || ''),
        entry_description: String(r.entry_description ?? ''),
        account_code: String(r.account_code),
        account_name: String(r.account_name),
        counter_accounts: r.counter_accounts ? String(r.counter_accounts) : '',
        debit: d / 100,
        credit: c / 100,
        balance: run / 100,
        source_type: r.source_type ?? null,
        source_id: r.source_id ?? null,
      };
    });
    const perD = toKurus(totals.rows[0].debit);
    const perC = toKurus(totals.rows[0].credit);
    const closing = openD - openC + perD - perC;
    return {
      account: {
        code: pattern,
        name: head.rows[0]?.name ?? `${pattern} ile başlayan hesaplar`,
        mode: code ? 'account' : 'prefix',
      },
      from,
      to,
      opening: { debit: openD / 100, credit: openC / 100, balance: (openD - openC) / 100 },
      period: { debit: perD / 100, credit: perC / 100 },
      closing: { balance: closing / 100, side: closing > 0 ? 'B' : closing < 0 ? 'A' : '' },
      rows: items,
      total_rows: Number(totals.rows[0].n),
      truncated: Number(totals.rows[0].n) > items.length,
    };
  });
}
