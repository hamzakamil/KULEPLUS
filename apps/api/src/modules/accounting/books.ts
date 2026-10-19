import { AppError } from '@kuleplus/shared';
import { toKurus, todayIso } from './ledger';
import { accountingService } from './service';

/**
 * Resmî defterler: Yevmiye Defteri (madde sırasıyla fişler) ve Defter-i Kebir (hesap bazlı).
 *
 * Muavin/mizan raporlarından farkı: defterler yıl sonu kapanış ve açılış fişlerini DE içerir
 * (defter fişin kendisidir). Yalnızca onaylı (posted) fişler girer.
 */

const MAX_ENTRIES = 5000;
const MAX_LEDGER_ROWS = 20000;

export interface BookRange {
  from?: string;
  to?: string;
}

function range(input: BookRange) {
  const to = input.to ?? todayIso();
  const from = input.from ?? `${to.slice(0, 4)}-01-01`;
  if (from > to) throw new AppError('VALIDATION_ERROR', 'Başlangıç tarihi bitişten sonra olamaz.');
  return { from, to };
}

export interface JournalBookLine {
  account_code: string;
  account_name: string;
  description: string;
  debit: number;
  credit: number;
}
export interface JournalBookEntry {
  entry_id: string;
  fiscal_year: number;
  entry_no: number;
  entry_date: string;
  entry_type: string;
  description: string;
  source_type: string | null;
  total_debit: number;
  total_credit: number;
  lines: JournalBookLine[];
}

/** Yevmiye defteri: [from, to] aralığındaki onaylı fişler, mali yıl + madde no sırasıyla. */
export async function journalBook(input: BookRange, tenantId?: string) {
  const { from, to } = range(input);
  return accountingService.withTenantClient(tenantId, async (client) => {
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM journal_entries
        WHERE tenant_id = current_tenant_id() AND status = 'posted'
          AND entry_date BETWEEN $1::date AND $2::date`,
      [from, to],
    );
    const total = Number(count.rows[0].n);
    const heads = await client.query(
      `SELECT id, fiscal_year, entry_no, to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
              entry_type, description, source_type
         FROM journal_entries
        WHERE tenant_id = current_tenant_id() AND status = 'posted'
          AND entry_date BETWEEN $1::date AND $2::date
        ORDER BY fiscal_year, entry_no
        LIMIT $3`,
      [from, to, MAX_ENTRIES],
    );
    const ids = heads.rows.map((r) => String(r.id));
    const lines = ids.length
      ? await client.query(
          `SELECT l.entry_id, l.line_no, a.code, a.name, l.description, l.debit, l.credit
             FROM journal_lines l JOIN accounting_accounts a ON a.id = l.account_id
            WHERE l.tenant_id = current_tenant_id() AND l.entry_id = ANY($1::uuid[])
            ORDER BY l.entry_id, l.line_no`,
          [ids],
        )
      : { rows: [] as Array<Record<string, unknown>> };
    const byEntry = new Map<string, JournalBookLine[]>();
    for (const l of lines.rows) {
      const key = String(l.entry_id);
      const arr = byEntry.get(key) ?? [];
      arr.push({
        account_code: String(l.code),
        account_name: String(l.name),
        description: String(l.description ?? ''),
        debit: toKurus(l.debit as string) / 100,
        credit: toKurus(l.credit as string) / 100,
      });
      byEntry.set(key, arr);
    }
    let debitK = 0;
    let creditK = 0;
    const entries: JournalBookEntry[] = heads.rows.map((h) => {
      const ls = byEntry.get(String(h.id)) ?? [];
      const d = ls.reduce((s, l) => s + toKurus(l.debit), 0);
      const c = ls.reduce((s, l) => s + toKurus(l.credit), 0);
      debitK += d;
      creditK += c;
      return {
        entry_id: String(h.id),
        fiscal_year: Number(h.fiscal_year),
        entry_no: Number(h.entry_no),
        entry_date: String(h.entry_date),
        entry_type: String(h.entry_type),
        description: String(h.description),
        source_type: (h.source_type as string | null) ?? null,
        total_debit: d / 100,
        total_credit: c / 100,
        lines: ls,
      };
    });
    return {
      from,
      to,
      entries,
      total_entries: total,
      truncated: total > entries.length,
      total_debit: debitK / 100,
      total_credit: creditK / 100,
    };
  });
}

export interface LedgerRow {
  entry_id: string;
  fiscal_year: number;
  entry_no: number;
  entry_date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}
export interface LedgerAccountBlock {
  code: string;
  name: string;
  opening: { debit: number; credit: number; balance: number };
  period: { debit: number; credit: number };
  closing: { balance: number; side: 'B' | 'A' | '' };
  rows: LedgerRow[];
}

export interface GeneralLedgerInput extends BookRange {
  /** 'detail': posted hesap (alt hesaplar ayrı) · 'main': 3 haneli ana hesapta toplanır. */
  level?: 'detail' | 'main';
  /** Yalnızca hareketi/devri olan hesaplar (varsayılan true). */
  only_active?: boolean;
  /** Tek hesap/önek filtresi (ör. 320 ya da 32). */
  code_prefix?: string;
}

/** Defter-i kebir: hesap bazlı bloklar (devir, hareketler, yürüyen bakiye, dönem toplamı). */
export async function generalLedger(input: GeneralLedgerInput, tenantId?: string) {
  const { from, to } = range(input);
  const level = input.level ?? 'detail';
  const onlyActive = input.only_active ?? true;
  const prefix = input.code_prefix?.trim() ?? '';
  if (prefix && !/^[0-9.]+$/.test(prefix)) {
    throw new AppError('VALIDATION_ERROR', 'Hesap kodu yalnızca rakam ve nokta içerebilir');
  }
  const groupCode = (code: string) => (level === 'main' ? code.slice(0, 3) : code);

  return accountingService.withTenantClient(tenantId, async (client) => {
    const likePrefix = prefix ? `${prefix}%` : '%';
    // Devir: hesabın açılış bakiyesi + [from] öncesi onaylı hareketler.
    const opening = await client.query(
      `SELECT a.code, a.name,
              COALESCE(a.opening_debit, 0) + COALESCE(SUM(l.debit) FILTER (WHERE e.id IS NOT NULL), 0) AS debit,
              COALESCE(a.opening_credit, 0) + COALESCE(SUM(l.credit) FILTER (WHERE e.id IS NOT NULL), 0) AS credit
         FROM accounting_accounts a
         LEFT JOIN journal_lines l ON l.account_id = a.id AND l.tenant_id = a.tenant_id
         LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted' AND e.entry_date < $1::date
        WHERE a.tenant_id = current_tenant_id() AND a.code LIKE $2
        GROUP BY a.code, a.name, a.opening_debit, a.opening_credit
        ORDER BY a.code`,
      [from, likePrefix],
    );
    const moves = await client.query(
      `SELECT a.code, a.name, e.id AS entry_id, e.fiscal_year, e.entry_no,
              to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date,
              COALESCE(NULLIF(l.description, ''), e.description) AS description, l.debit, l.credit
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounting_accounts a ON a.id = l.account_id
        WHERE l.tenant_id = current_tenant_id() AND e.status = 'posted'
          AND e.entry_date BETWEEN $1::date AND $2::date AND a.code LIKE $3
        ORDER BY a.code, e.entry_date, e.fiscal_year, e.entry_no, l.line_no
        LIMIT $4`,
      [from, to, likePrefix, MAX_LEDGER_ROWS],
    );

    type Acc = {
      code: string;
      name: string;
      od: number;
      oc: number;
      rows: Omit<LedgerRow, 'balance'>[];
    };
    const blocks = new Map<string, Acc>();
    const ensure = (code: string, name: string) => {
      const key = groupCode(code);
      let b = blocks.get(key);
      if (!b) {
        b = { code: key, name: level === 'main' ? name : name, od: 0, oc: 0, rows: [] };
        blocks.set(key, b);
      }
      return b;
    };
    for (const r of opening.rows) {
      const od = toKurus(r.debit);
      const oc = toKurus(r.credit);
      if (od === 0 && oc === 0 && onlyActive) continue;
      const b = ensure(String(r.code), String(r.name));
      // ana hesap adı: tam eşleşen 3 haneli hesabın adı
      if (level === 'main' && String(r.code) === b.code) b.name = String(r.name);
      b.od += od;
      b.oc += oc;
    }
    for (const m of moves.rows) {
      const b = ensure(String(m.code), String(m.name));
      if (level === 'main' && String(m.code) === b.code) b.name = String(m.name);
      b.rows.push({
        entry_id: String(m.entry_id),
        fiscal_year: Number(m.fiscal_year),
        entry_no: Number(m.entry_no),
        entry_date: String(m.entry_date),
        description: String(m.description ?? ''),
        debit: toKurus(m.debit) / 100,
        credit: toKurus(m.credit) / 100,
      });
    }

    const accounts: LedgerAccountBlock[] = [];
    for (const b of [...blocks.values()].sort((x, y) => (x.code < y.code ? -1 : 1))) {
      if (onlyActive && b.rows.length === 0 && b.od === 0 && b.oc === 0) continue;
      let run = b.od - b.oc;
      if (level === 'main') {
        b.rows.sort(
          (x, y) =>
            x.entry_date.localeCompare(y.entry_date) ||
            x.fiscal_year - y.fiscal_year ||
            x.entry_no - y.entry_no,
        );
      }
      let pd = 0;
      let pc = 0;
      const rows = b.rows.map((r) => {
        const d = toKurus(r.debit);
        const c = toKurus(r.credit);
        pd += d;
        pc += c;
        run += d - c;
        return { ...r, balance: run / 100 };
      });
      accounts.push({
        code: b.code,
        name: b.name,
        opening: { debit: b.od / 100, credit: b.oc / 100, balance: (b.od - b.oc) / 100 },
        period: { debit: pd / 100, credit: pc / 100 },
        closing: { balance: run / 100, side: run > 0 ? 'B' : run < 0 ? 'A' : '' },
        rows,
      });
    }
    if (level === 'main' && accounts.length > 0) {
      const names = await client.query(
        `SELECT code, name FROM accounting_accounts
          WHERE tenant_id = current_tenant_id() AND code = ANY($1::text[])`,
        [accounts.map((a) => a.code)],
      );
      const byCode = new Map(names.rows.map((r) => [String(r.code), String(r.name)]));
      for (const a of accounts) a.name = byCode.get(a.code) ?? a.name;
    }
    return {
      from,
      to,
      level,
      accounts,
      truncated: moves.rows.length >= MAX_LEDGER_ROWS,
    };
  });
}

// ------------------------------------------------------------------ CSV

/** Excel (tr-TR) için: noktalı virgül ayraç, UTF-8 BOM, virgüllü ondalık. */
function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const money = (n: number) => n.toFixed(2).replace('.', ',');
const csv = (rows: unknown[][]) =>
  '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';

export async function journalBookCsv(input: BookRange, tenantId?: string) {
  const b = await journalBook(input, tenantId);
  const rows: unknown[][] = [
    [
      'Mali Yıl',
      'Madde No',
      'Tarih',
      'Fiş Türü',
      'Hesap Kodu',
      'Hesap Adı',
      'Açıklama',
      'Borç',
      'Alacak',
    ],
  ];
  for (const e of b.entries) {
    for (const l of e.lines) {
      rows.push([
        e.fiscal_year,
        e.entry_no,
        e.entry_date,
        e.entry_type,
        l.account_code,
        l.account_name,
        l.description || e.description,
        money(l.debit),
        money(l.credit),
      ]);
    }
  }
  rows.push(['', '', '', '', '', '', 'TOPLAM', money(b.total_debit), money(b.total_credit)]);
  return csv(rows);
}

export async function generalLedgerCsv(input: GeneralLedgerInput, tenantId?: string) {
  const g = await generalLedger(input, tenantId);
  const rows: unknown[][] = [
    [
      'Hesap Kodu',
      'Hesap Adı',
      'Tarih',
      'Mali Yıl',
      'Madde No',
      'Açıklama',
      'Borç',
      'Alacak',
      'Bakiye (B+/A-)',
    ],
  ];
  for (const a of g.accounts) {
    rows.push([
      a.code,
      a.name,
      '',
      '',
      '',
      'DEVİR',
      money(a.opening.debit),
      money(a.opening.credit),
      money(a.opening.balance),
    ]);
    for (const r of a.rows) {
      rows.push([
        a.code,
        a.name,
        r.entry_date,
        r.fiscal_year,
        r.entry_no,
        r.description,
        money(r.debit),
        money(r.credit),
        money(r.balance),
      ]);
    }
    rows.push([
      a.code,
      a.name,
      '',
      '',
      '',
      'DÖNEM TOPLAMI',
      money(a.period.debit),
      money(a.period.credit),
      money(a.closing.balance),
    ]);
  }
  return csv(rows);
}
