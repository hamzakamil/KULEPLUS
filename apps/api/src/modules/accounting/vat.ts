import type { PoolClient } from 'pg';
import { AppError } from '@kuleplus/shared';
import type { CreateJournalEntryInput } from './schemas';
import { ensureAccountByCode } from './subledger';
import { toKurus } from './ledger';
import { accountingService } from './service';

/**
 * Aylık KDV mahsup fişi (Faz 9-2) — KDV-1 beyannamesinin muhasebe karşılığı.
 *
 * Ay sonu itibarıyla:
 *   391 Hesaplanan KDV          B (alacak bakiyesi kadar)
 *       191 İndirilecek KDV         A (borç bakiyesi kadar)
 *       190 Devreden KDV            A (önceki aydan devreden, gerektiği kadar kullanılır)
 *       360.02 Ödenecek KDV         A (kalan fark)
 * 191 (+190) hesaplanan KDV'den büyükse fark 190'a BORÇ yazılır ve sonraki aya devreder.
 * Bakiyeler kümülatiftir: önceki bir ay mahsup edilmediyse onun bakiyesi de bu fişe girer
 * (önizlemede uyarı verilir). Tevkifatlı alışlarda sorumlu sıfatıyla KDV (360.01, KDV-2) bu
 * fişe girmez; yalnızca bilgi olarak gösterilir.
 */

export const VAT_OFFSET_SOURCE = 'vat_offset';
export const VAT_PAYABLE_CODE = '360.02';

type LeafBalance = { account_id: string; code: string; name: string; balanceK: number };

export interface VatOffsetLine {
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
}

export interface VatOffsetPreview {
  year: number;
  month: number;
  entry_date: string;
  hesaplanan_kdv: number;
  indirilecek_kdv: number;
  devreden_onceki: number;
  odenecek_kdv: number;
  devreden_sonraki: number;
  /** Bilgi: ay içinde tahakkuk eden sorumlu sıfatıyla KDV (360.01, KDV-2 beyannamesi). */
  sorumlu_kdv: number;
  lines: VatOffsetLine[];
  warnings: string[];
  existing_entry: { id: string; entry_no: number } | null;
}

function monthEnd(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('VALIDATION_ERROR', 'Geçerli bir yıl ve ay (1-12) seçin.');
  }
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** Ana hesap ve alt hesaplarının (`code` / `code.%`) tarihe kadarki onaylı bakiyeleri (borç − alacak). */
async function leafBalances(
  client: PoolClient,
  code: string,
  untilDate: string,
): Promise<LeafBalance[]> {
  const r = await client.query(
    `SELECT a.id AS account_id, a.code, a.name,
            COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS balance
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounting_accounts a ON a.id = l.account_id
      WHERE e.tenant_id = current_tenant_id() AND e.status = 'posted' AND e.entry_date <= $2::date
        AND (a.code = $1 OR a.code LIKE $1 || '.%')
      GROUP BY a.id, a.code, a.name
      ORDER BY a.code`,
    [code, untilDate],
  );
  return r.rows
    .map((row) => ({
      account_id: String(row.account_id),
      code: String(row.code),
      name: String(row.name),
      balanceK: toKurus(row.balance),
    }))
    .filter((b) => b.balanceK !== 0);
}

async function existingOffset(client: PoolClient, entryDate: string) {
  const r = await client.query(
    `SELECT e.id, e.entry_no FROM journal_entries e
      WHERE e.tenant_id = current_tenant_id() AND e.source_type = $1 AND e.status = 'posted'
        AND e.entry_type <> 'ters' AND date_trunc('month', e.entry_date) = date_trunc('month', $2::date)
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = e.id)
      LIMIT 1`,
    [VAT_OFFSET_SOURCE, entryDate],
  );
  return r.rows[0] ? { id: String(r.rows[0].id), entry_no: Number(r.rows[0].entry_no) } : null;
}

async function accountByCode(client: PoolClient, code: string) {
  const r = await client.query(
    'SELECT id, code, name FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1',
    [code],
  );
  return r.rows[0] as { id: string; code: string; name: string } | undefined;
}

/**
 * Önizleme hesaplar; `createPayable` true ise 360.02 hesabı yoksa açılır (yalnızca onayda).
 */
export async function computeVatOffset(
  client: PoolClient,
  year: number,
  month: number,
  createPayable = false,
): Promise<VatOffsetPreview> {
  const entryDate = monthEnd(year, month);
  const monthStart = entryDate.slice(0, 8) + '01';
  const warnings: string[] = [];
  const existing = await existingOffset(client, entryDate);
  if (existing) warnings.push(`Bu ay için KDV mahsup fişi zaten var (madde ${existing.entry_no}).`);

  const out = await leafBalances(client, '391', entryDate); // alacak bakiyesi → negatif
  const inp = await leafBalances(client, '191', entryDate);
  const carried = await leafBalances(client, '190', entryDate);

  const lines: VatOffsetLine[] = [];
  const push = (
    b: { account_id: string; code: string; name: string },
    debitK: number,
    creditK: number,
  ) =>
    lines.push({
      account_id: b.account_id,
      account_code: b.code,
      account_name: b.name,
      debit: debitK / 100,
      credit: creditK / 100,
    });

  let outK = 0;
  for (const b of out) {
    if (b.balanceK < 0) {
      outK += -b.balanceK;
      push(b, -b.balanceK, 0);
    } else {
      warnings.push(
        `${b.code} borç bakiyesi veriyor (${b.balanceK / 100}); kayıtları kontrol edin.`,
      );
    }
  }
  let inK = 0;
  for (const b of inp) {
    if (b.balanceK > 0) {
      inK += b.balanceK;
      push(b, 0, b.balanceK);
    } else {
      warnings.push(
        `${b.code} alacak bakiyesi veriyor (${b.balanceK / 100}); kayıtları kontrol edin.`,
      );
    }
  }
  const carriedK = carried.filter((b) => b.balanceK > 0).reduce((s, b) => s + b.balanceK, 0);

  let payableK = 0;
  let nextCarryK = carriedK;
  const netK = outK - inK;
  if (netK > 0) {
    // Önce devreden KDV kullanılır, kalan ödenecek KDV olur.
    let use = Math.min(carriedK, netK);
    nextCarryK = carriedK - use;
    for (const b of carried) {
      if (use <= 0) break;
      if (b.balanceK <= 0) continue;
      const part = Math.min(use, b.balanceK);
      push(b, 0, part);
      use -= part;
    }
    payableK = netK - Math.min(carriedK, netK);
    if (payableK > 0) {
      const acc = createPayable
        ? {
            id: await ensureAccountByCode(client, VAT_PAYABLE_CODE, 'Ödenecek KDV', '360'),
            code: VAT_PAYABLE_CODE,
            name: 'Ödenecek KDV',
          }
        : ((await accountByCode(client, VAT_PAYABLE_CODE)) ?? {
            id: '',
            code: VAT_PAYABLE_CODE,
            name: 'Ödenecek KDV',
          });
      push({ account_id: acc.id, code: acc.code, name: acc.name }, 0, payableK);
    }
  } else if (netK < 0) {
    const acc = await accountByCode(client, '190');
    if (!acc) throw new AppError('VALIDATION_ERROR', '190 Devreden KDV hesabı bulunamadı.');
    push({ account_id: acc.id, code: acc.code, name: acc.name }, -netK, 0);
    nextCarryK = carriedK - netK;
  }

  const drafts = await client.query(
    `SELECT COUNT(*)::int AS n FROM journal_entries
      WHERE tenant_id = current_tenant_id() AND status = 'draft' AND entry_date BETWEEN $1 AND $2`,
    [monthStart, entryDate],
  );
  if (drafts.rows[0].n > 0) {
    warnings.push(`Ay içinde ${drafts.rows[0].n} taslak fiş var; KDV tutarları eksik olabilir.`);
  }
  // Önceki aylar mahsup edilmemişse bakiyeleri bu fişe girer.
  const unOffset = await client.query(
    `SELECT DISTINCT to_char(e.entry_date, 'YYYY-MM') AS ym
       FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id
       JOIN accounting_accounts a ON a.id = l.account_id
      WHERE e.tenant_id = current_tenant_id() AND e.status = 'posted'
        AND e.entry_date < $1::date AND e.fiscal_year = $2
        AND (a.code IN ('391', '191') OR a.code LIKE '391.%' OR a.code LIKE '191.%')
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries v
           WHERE v.tenant_id = e.tenant_id AND v.source_type = $3 AND v.status = 'posted'
             AND v.entry_type <> 'ters'
             AND date_trunc('month', v.entry_date) = date_trunc('month', e.entry_date)
             AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = v.id))
      ORDER BY ym`,
    [monthStart, year, VAT_OFFSET_SOURCE],
  );
  if (unOffset.rows.length > 0) {
    warnings.push(
      `Mahsup fişi kesilmemiş önceki ay(lar): ${unOffset.rows.map((r) => r.ym).join(', ')}. Bakiyeleri bu fişe dahil edildi.`,
    );
  }
  const resp = await client.query(
    // Tahakkuk (alacak) eksi ters kayıtlar; vergi ödemesi (borç) tahakkuku azaltmaz.
    `SELECT COALESCE(SUM(l.credit), 0)
              - COALESCE(SUM(l.debit) FILTER (WHERE e.entry_type = 'ters'), 0) AS amt
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounting_accounts a ON a.id = l.account_id
      WHERE e.tenant_id = current_tenant_id() AND e.status = 'posted'
        AND e.entry_date BETWEEN $1 AND $2
        AND (a.code = '360.01' OR a.code LIKE '360.01.%')`,
    [monthStart, entryDate],
  );

  return {
    year,
    month,
    entry_date: entryDate,
    hesaplanan_kdv: outK / 100,
    indirilecek_kdv: inK / 100,
    devreden_onceki: carriedK / 100,
    odenecek_kdv: payableK / 100,
    devreden_sonraki: nextCarryK / 100,
    sorumlu_kdv: toKurus(resp.rows[0].amt) / 100,
    lines,
    warnings,
    existing_entry: existing,
  };
}

const MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

export async function previewVatOffset(year: number, month: number, tenantId?: string) {
  return accountingService.withTenantClient(tenantId, (client) =>
    computeVatOffset(client, year, month),
  );
}

/** Önizlemedeki fişi ay sonu tarihiyle onaylı olarak keser (aynı ay için ikinci fiş engellenir). */
export async function postVatOffset(
  year: number,
  month: number,
  userId: string,
  tenantId?: string,
) {
  return accountingService.withTenantClient(tenantId, async (client) => {
    // Aynı ay için eşzamanlı iki istek tek fiş üretsin.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('vat_offset:' || COALESCE(current_setting('app.tenant_id', true), '') || ':' || $1::text))",
      [`${year}-${month}`],
    );
    const p = await computeVatOffset(client, year, month, true);
    if (p.existing_entry) {
      throw new AppError(
        'CONFLICT',
        `${MONTHS[month - 1]} ${year} için KDV mahsup fişi zaten var (madde ${p.existing_entry.entry_no}). Yeniden kesmek için önce ters kaydını alın.`,
      );
    }
    if (p.lines.length < 2) {
      throw new AppError('VALIDATION_ERROR', 'Mahsup edilecek KDV bakiyesi yok.');
    }
    const entry = await accountingService.createEntryOn(
      client,
      {
        entry_date: p.entry_date,
        entry_type: 'mahsup',
        status: 'posted',
        description: `${MONTHS[month - 1]} ${year} KDV mahsubu`,
        source_type: VAT_OFFSET_SOURCE,
        lines: p.lines.map((l) => ({
          account_id: l.account_id,
          debit: l.debit,
          credit: l.credit,
          description: 'KDV mahsubu',
        })),
      } as CreateJournalEntryInput,
      userId,
    );
    return { ...p, existing_entry: null, entry_id: entry.id, entry_no: entry.entryNo };
  });
}
