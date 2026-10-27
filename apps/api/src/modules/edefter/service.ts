import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync, zipSync, strToU8 } from 'fflate';
import type { PoolClient } from 'pg';
import { AppError, newId } from '@kuleplus/shared';
import { accountingService } from '../accounting/service';
import { toIsoDate, toKurus, todayIso } from '../accounting/ledger';
import { buildMonth, type BookEntry, type BookLine, type BookPart } from './generator';
import { manualDocument, resolveSourceDocuments, type ResolvedDocument } from './documents';
import { loadProfile, type ProfileIssue } from './profile';
import { edefterAssetsDir, validateBook } from './validator';

/**
 * e-Defter (entegratör üzerinden): aylık yevmiye + kebir XML üretimi, ön kontrol, GİB kurallarıyla
 * doğrulama, saklama ve zip olarak teslim. İmza/berat/GİB yükleme entegratördedir.
 *
 * Kurallar (Teknik Kılavuz v1.7, Uygulama Kılavuzu v1.12):
 *  - Defter aylıktır; ay atlanamaz (önceki ayın defteri oluşturulmadan sonraki oluşturulamaz).
 *  - Madde ve satır numaraları hesap dönemi başında 1'den başlar, aylar ve parçalar boyunca
 *    müteselsil ilerler — numaralar donmuş olmalıdır: ay kilitlenmeden defter üretilmez.
 *  - Oluşturma tarihi dönem sonundan önce olamaz.
 */

export type Issue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  entryNo?: number;
  field?: string;
};

interface MonthContext {
  period: string; // YYYYAA
  monthStart: string;
  monthEnd: string;
  fiscalYear: number;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  firstMonth: string; // e-Defter'in bu hesap dönemindeki ilk ayı (YYYYAA)
}

const MONTH_RE = /^(\d{4})(0[1-9]|1[0-2])$/;
const pad2 = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const prevPeriod = (p: string) => {
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(4));
  return m === 1 ? `${y - 1}12` : `${y}${pad2(m - 1)}`;
};
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function monthContext(
  client: PoolClient,
  period: string,
  startMonth?: string,
): Promise<MonthContext> {
  const m = MONTH_RE.exec(period);
  if (!m) throw new AppError('VALIDATION_ERROR', 'Dönem YYYYAA biçiminde olmalı (ör. 202603).');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const monthStart = `${y}-${pad2(mo)}-01`;
  const monthEnd = `${y}-${pad2(mo)}-${pad2(lastDay(y, mo))}`;
  const fp = await client.query(
    `SELECT year, start_date, end_date FROM fiscal_periods
      WHERE tenant_id = current_tenant_id() AND $1::date BETWEEN start_date AND end_date
      ORDER BY start_date DESC LIMIT 1`,
    [monthStart],
  );
  if (!fp.rows[0])
    throw new AppError('VALIDATION_ERROR', `${period} dönemini kapsayan mali dönem yok.`);
  const fyStart = toIsoDate(fp.rows[0].start_date);
  const fyEnd = toIsoDate(fp.rows[0].end_date);
  const fyFirst = fyStart.slice(0, 4) + fyStart.slice(5, 7);
  const sm = startMonth ? startMonth.replace('-', '') : '';
  const firstMonth =
    sm && MONTH_RE.test(sm) && sm > fyFirst && sm <= fyEnd.slice(0, 4) + fyEnd.slice(5, 7)
      ? sm
      : fyFirst;
  return {
    period,
    monthStart,
    monthEnd,
    fiscalYear: Number(fp.rows[0].year),
    fiscalYearStart: fyStart,
    fiscalYearEnd: fyEnd,
    firstMonth,
  };
}

interface MonthData {
  entries: BookEntry[];
  issues: Issue[];
}

/** Ayın onaylı fişlerini e-Defter maddelerine çevirir; numara/belge sorunlarını toplar. */
async function loadMonth(
  client: PoolClient,
  ctx: MonthContext,
  enteredByDefault: string,
): Promise<MonthData> {
  const issues: Issue[] = [];
  const firstMonthStart = `${ctx.firstMonth.slice(0, 4)}-${ctx.firstMonth.slice(4)}-01`;
  // e-Defter'e dönem içinde geçildiyse önceki maddeler kağıt defterdedir: numaralar 1'den başlar.
  const offsets = await client.query(
    `SELECT COUNT(DISTINCT e.id)::int AS entries, COUNT(l.id)::int AS lines
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
      WHERE e.tenant_id = current_tenant_id() AND e.status = 'posted' AND e.fiscal_year = $1
        AND e.entry_date < $2::date`,
    [ctx.fiscalYear, firstMonthStart],
  );
  const before = await client.query(
    `SELECT COALESCE(MAX(e.entry_no), 0)::int AS max_no, COUNT(l.id)::int AS lines
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
      WHERE e.tenant_id = current_tenant_id() AND e.status = 'posted' AND e.fiscal_year = $1
        AND e.entry_date < $2::date`,
    [ctx.fiscalYear, ctx.monthStart],
  );
  const entryOffset = Number(offsets.rows[0].entries);
  const lineOffset = Number(offsets.rows[0].lines);
  const maxBefore = Number(before.rows[0].max_no);
  let lineNo = Number(before.rows[0].lines) - lineOffset;

  const heads = await client.query(
    `SELECT e.id, e.entry_no, to_char(e.entry_date, 'YYYY-MM-DD') AS d, e.description, e.source_type,
            e.source_id, e.document_type, e.document_type_description, e.document_number,
            e.document_date, e.payment_method,
            COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)) AS entered_by
       FROM journal_entries e
       LEFT JOIN users u ON u.id = COALESCE(e.created_by, e.posted_by)
      WHERE e.tenant_id = current_tenant_id() AND e.status = 'posted' AND e.fiscal_year = $1
        AND e.entry_date BETWEEN $2::date AND $3::date
      ORDER BY e.entry_no`,
    [ctx.fiscalYear, ctx.monthStart, ctx.monthEnd],
  );
  const later = await client.query(
    `SELECT COUNT(*)::int AS n FROM journal_entries
      WHERE tenant_id = current_tenant_id() AND status = 'posted' AND fiscal_year = $1
        AND entry_date > $3::date AND entry_no <= $2`,
    [ctx.fiscalYear, heads.rows.at(-1)?.entry_no ?? 0, ctx.monthEnd],
  );
  if (
    Number(later.rows[0].n) > 0 ||
    heads.rows.some((h, i) => Number(h.entry_no) !== maxBefore + i + 1)
  ) {
    issues.push({
      level: 'error',
      code: 'numbering',
      message:
        'Madde numaraları tarih sırasında ve boşluksuz değil. Yevmiye Fişleri → "Yeniden sırala" ile düzeltip ayı kilitleyin.',
    });
  }
  const ids = heads.rows.map((h) => String(h.id));
  const lines = ids.length
    ? await client.query(
        `SELECT l.entry_id, l.line_no, l.debit, l.credit, l.description, l.document_type,
                l.document_type_description, l.document_number, l.document_date, l.payment_method,
                a.code, a.name,
                (SELECT m.name FROM accounting_accounts m
                  WHERE m.tenant_id = a.tenant_id AND m.code = split_part(a.code, '.', 1)) AS main_name
           FROM journal_lines l JOIN accounting_accounts a ON a.id = l.account_id
          WHERE l.tenant_id = current_tenant_id() AND l.entry_id = ANY($1::uuid[])
          ORDER BY l.entry_id, l.line_no`,
        [ids],
      )
    : { rows: [] as Array<Record<string, unknown>> };
  const byEntry = new Map<string, Array<Record<string, unknown>>>();
  for (const l of lines.rows) {
    const k = String(l.entry_id);
    byEntry.set(k, [...(byEntry.get(k) ?? []), l]);
  }
  const sources = await resolveSourceDocuments(
    client,
    heads.rows.map((h) => ({
      id: String(h.id),
      source_type: h.source_type ?? null,
      source_id: h.source_id ?? null,
    })),
  );

  const entries: BookEntry[] = heads.rows.map((h) => {
    const counter = Number(h.entry_no) - entryOffset;
    const headerDoc = manualDocument(h);
    const sourceDoc: ResolvedDocument = sources.get(String(h.id)) ?? {
      document: null,
      paymentMethod: null,
    };
    const bookLines: BookLine[] = (byEntry.get(String(h.id)) ?? []).map((l) => {
      const code = String(l.code);
      const main = code.split('.')[0];
      if (!/^\d{3,4}$/.test(main)) {
        issues.push({
          level: 'error',
          code: 'account',
          entryNo: counter,
          message: `Madde ${counter}: ${code} hesabının ana hesap kodu 3 veya 4 haneli rakam olmalı.`,
        });
      }
      const lineDoc = manualDocument(l);
      const resolved = lineDoc ?? headerDoc ?? sourceDoc;
      const debitK = toKurus(l.debit as string);
      const creditK = toKurus(l.credit as string);
      return {
        lineNumber: ++lineNo,
        accountMainId: main,
        accountMainDescription: String(l.main_name ?? l.name),
        accountSubId: code === main ? null : code,
        accountSubDescription: code === main ? null : String(l.name),
        debitCredit: debitK > 0 ? 'D' : 'C',
        amountK: debitK > 0 ? debitK : creditK,
        document: resolved.document,
        paymentMethod: resolved.paymentMethod ?? sourceDoc.paymentMethod,
        comment: String(l.description || h.description || '').slice(0, 1000) || null,
      };
    });
    for (const bl of bookLines) {
      const d = bl.document;
      if (d && ['invoice', 'check', 'other'].includes(d.type) && (!d.number || !d.date)) {
        issues.push({
          level: 'error',
          code: 'document',
          entryNo: counter,
          message: `Madde ${counter} (${h.description}): ${d.type === 'other' ? (d.description ?? 'belge') : d.type === 'invoice' ? 'fatura' : 'çek'} numarası ve tarihi zorunlu.`,
        });
        break;
      }
      if (d?.type === 'other' && !d.description) {
        issues.push({
          level: 'error',
          code: 'document',
          entryNo: counter,
          message: `Madde ${counter}: "Diğer" belge tipinde belgenin adı (ör. Ücret Bordrosu) yazılmalı.`,
        });
        break;
      }
    }
    if (h.source_type === 'invoice_payment' || h.source_type === 'expense_payment') {
      if (sourceDoc.paymentMethod === 'Banka' && !sourceDoc.document && !headerDoc) {
        issues.push({
          level: 'warning',
          code: 'bank_reference',
          entryNo: counter,
          message: `Madde ${counter}: banka ödemesinde dekont numarası yok; belge bilgisi olmadan yazılacak.`,
        });
      }
    }
    const by = String(h.entered_by ?? '').trim();
    return {
      counter,
      entryNumber: String(h.entry_no).padStart(6, '0'),
      date: String(h.d),
      enteredBy: by.length >= 2 ? by : enteredByDefault,
      comment: String(h.description ?? '').slice(0, 1000) || '-',
      lines: bookLines,
    };
  });
  return { entries, issues };
}

async function currentParts(client: PoolClient, period: string) {
  const r = await client.query(
    `SELECT id, period, book_type, part_no, unique_seq, unique_id, file_name, status, sha256, size_bytes,
            period_start, period_end, first_entry_no, last_entry_no, first_line_no, last_line_no,
            entry_count, line_count, total_debit, total_credit, created_at
       FROM edefter_parts
      WHERE tenant_id = current_tenant_id() AND period = $1 AND status <> 'superseded'
      ORDER BY book_type DESC, part_no`,
    [period],
  );
  return r.rows;
}

export interface PrecheckResult {
  period: string;
  fiscalYear: number | null;
  ready: boolean;
  issues: Issue[];
  profileIssues: ProfileIssue[];
  summary: {
    entryCount: number;
    lineCount: number;
    firstEntry: number | null;
    lastEntry: number | null;
    totalDebit: number;
    totalCredit: number;
  };
  existing: Array<Record<string, unknown>>;
}

async function precheckOn(
  client: PoolClient,
  period: string,
): Promise<{
  result: PrecheckResult;
  ctx: MonthContext | null;
  data: MonthData | null;
  loaded: Awaited<ReturnType<typeof loadProfile>>;
}> {
  const loaded = await loadProfile(client);
  const issues: Issue[] = [];
  const empty = {
    entryCount: 0,
    lineCount: 0,
    firstEntry: null,
    lastEntry: null,
    totalDebit: 0,
    totalCredit: 0,
  };
  let ctx: MonthContext | null = null;
  try {
    ctx = await monthContext(client, period, loaded.settings.startMonth);
  } catch (e) {
    issues.push({ level: 'error', code: 'period', message: (e as Error).message });
  }
  if (!ctx) {
    return {
      result: {
        period,
        fiscalYear: null,
        ready: false,
        issues,
        profileIssues: loaded.issues,
        summary: empty,
        existing: [],
      },
      ctx,
      data: null,
      loaded,
    };
  }
  if (todayIso() <= ctx.monthEnd) {
    issues.push({
      level: 'error',
      code: 'month_open',
      message: `Ay bitmeden defter oluşturulamaz (dönem sonu ${ctx.monthEnd}).`,
    });
  }
  const lock = await client.query(
    `SELECT MAX(lock_date) AS d FROM period_locks WHERE tenant_id = current_tenant_id()`,
  );
  const lockDate = lock.rows[0]?.d ? toIsoDate(lock.rows[0].d) : null;
  if (!lockDate || lockDate <= ctx.monthEnd) {
    issues.push({
      level: 'error',
      code: 'not_locked',
      message: `Ay kilitli değil. Madde numaralarının değişmemesi için ${ctx.monthEnd} dahil dönemi kilitleyin.`,
    });
  }
  const drafts = await client.query(
    `SELECT COUNT(*)::int AS n FROM journal_entries
      WHERE tenant_id = current_tenant_id() AND status = 'draft' AND entry_date BETWEEN $1 AND $2`,
    [ctx.monthStart, ctx.monthEnd],
  );
  if (drafts.rows[0].n > 0) {
    issues.push({
      level: 'error',
      code: 'drafts',
      message: `Ayda ${drafts.rows[0].n} taslak fiş var; onaylayın veya silin.`,
    });
  }
  if (period !== ctx.firstMonth) {
    const prev = await currentParts(client, prevPeriod(period));
    if (prev.length === 0) {
      issues.push({
        level: 'error',
        code: 'previous_missing',
        message: `Önce ${prevPeriod(period).slice(4)}/${prevPeriod(period).slice(0, 4)} ayının defterini oluşturun (ay atlanamaz).`,
      });
    }
  }
  const data = await loadMonth(client, ctx, loaded.settings.enteredBy?.trim() || 'Muhasebe');
  issues.push(...data.issues);
  if (data.entries.length === 0) {
    issues.push({
      level: 'error',
      code: 'empty',
      message: 'Bu ayda onaylı fiş yok; GİB boş yevmiye defterini kabul etmez.',
    });
  }
  const lines = data.entries.flatMap((e) => e.lines);
  const result: PrecheckResult = {
    period,
    fiscalYear: ctx.fiscalYear,
    ready: issues.every((i) => i.level !== 'error') && loaded.issues.length === 0,
    issues,
    profileIssues: loaded.issues,
    summary: {
      entryCount: data.entries.length,
      lineCount: lines.length,
      firstEntry: data.entries[0]?.counter ?? null,
      lastEntry: data.entries.at(-1)?.counter ?? null,
      totalDebit:
        lines.filter((l) => l.debitCredit === 'D').reduce((s, l) => s + l.amountK, 0) / 100,
      totalCredit:
        lines.filter((l) => l.debitCredit === 'C').reduce((s, l) => s + l.amountK, 0) / 100,
    },
    existing: await currentParts(client, period),
  };
  return { result, ctx, data, loaded };
}

export async function precheck(period: string, tenantId?: string): Promise<PrecheckResult> {
  return accountingService.withTenantClient(
    tenantId,
    async (client) => (await precheckOn(client, period)).result,
  );
}

export interface GenerateResult {
  period: string;
  parts: Array<{
    book: 'Y' | 'K';
    partNo: number;
    uniqueId: string;
    fileName: string;
    periodStart: string;
    periodEnd: string;
    sizeBytes: number;
    sha256: string;
    signaturePending: number;
  }>;
  summary: PrecheckResult['summary'];
}

/** Ayın defterini üretir, GİB kurallarıyla doğrular ve saklar (yeniden üretimde eskisini geçersiz kılar). */
export async function generate(
  period: string,
  userId: string,
  tenantId?: string,
  opts: { maxBytes?: number; creationDate?: string } = {},
): Promise<GenerateResult> {
  return accountingService.withTenantClient(tenantId, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('edefter:' || COALESCE(current_setting('app.tenant_id', true), '')))",
    );
    const { result, ctx, data, loaded } = await precheckOn(client, period);
    if (!result.ready || !ctx || !data) {
      const msgs = [
        ...loaded.issues.map((i) => i.message),
        ...result.issues.filter((i) => i.level === 'error').map((i) => i.message),
      ];
      throw new AppError('VALIDATION_ERROR', `e-Defter oluşturulamaz: ${msgs.join(' ')}`);
    }
    const existing = result.existing;
    if (existing.some((p) => p.status === 'delivered')) {
      throw new AppError(
        'CONFLICT',
        'Bu ayın defteri entegratöre gönderildi olarak işaretli. Yeniden üretmek için önce işareti kaldırın.',
      );
    }
    const prior = await client.query(
      `SELECT COUNT(*)::int AS n FROM edefter_parts
        WHERE tenant_id = current_tenant_id() AND fiscal_year = $1 AND book_type = 'Y'
          AND status <> 'superseded' AND period < $2 AND period >= $3`,
      [ctx.fiscalYear, period, ctx.firstMonth],
    );
    const nextSeq = Number(prior.rows[0].n) + 1;
    const creationDate = opts.creationDate ?? todayIso();
    const parts = buildMonth({
      profile: loaded.profile,
      monthStart: ctx.monthStart,
      monthEnd: ctx.monthEnd,
      fiscalYearStart: ctx.fiscalYearStart,
      fiscalYearEnd: ctx.fiscalYearEnd,
      creationDate: creationDate < ctx.monthEnd ? nextDay(ctx.monthEnd) : creationDate,
      entries: data.entries,
      nextUniqueSeq: nextSeq,
      maxBytes: opts.maxBytes,
    });
    const laterParts = await client.query(
      `SELECT COUNT(*)::int AS n FROM edefter_parts
        WHERE tenant_id = current_tenant_id() AND fiscal_year = $1 AND status <> 'superseded' AND period > $2`,
      [ctx.fiscalYear, period],
    );
    const oldPartCount = existing.filter((p) => p.book_type === 'Y').length;
    const newPartCount = parts.filter((p) => p.book === 'Y').length;
    if (Number(laterParts.rows[0].n) > 0 && oldPartCount !== newPartCount) {
      throw new AppError(
        'CONFLICT',
        'Parça sayısı değişti; sonraki ayların kontrol numaraları kayar. Önce sonraki ayların defterlerini silin.',
      );
    }

    const validated: Array<{ part: BookPart; signaturePending: number }> = [];
    for (const part of parts) {
      const v = await validateBook(part.xml, part.fileName, part.book);
      if (!v.valid) {
        throw new AppError(
          'VALIDATION_ERROR',
          `${part.fileName} GİB kurallarından geçmedi: ${v.errors.slice(0, 10).join(' | ')}`,
        );
      }
      validated.push({ part, signaturePending: v.signaturePending.length });
    }

    await client.query(
      `UPDATE edefter_parts SET status = 'superseded', updated_at = now()
        WHERE tenant_id = current_tenant_id() AND period = $1 AND status <> 'superseded'`,
      [period],
    );
    const out: GenerateResult['parts'] = [];
    for (const { part, signaturePending } of validated) {
      const bytes = Buffer.from(part.xml, 'utf8');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await client.query(
        `INSERT INTO edefter_parts
           (id, tenant_id, fiscal_year, period, book_type, part_no, unique_seq, unique_id, period_start,
            period_end, first_entry_no, last_entry_no, first_line_no, last_line_no, entry_count, line_count,
            total_debit, total_credit, file_name, sha256, size_bytes, content, created_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22)`,
        [
          newId(),
          ctx.fiscalYear,
          period,
          part.book,
          part.partNo,
          Number(part.uniqueId.slice(-6)),
          part.uniqueId,
          part.periodStart,
          part.periodEnd,
          part.firstCounter,
          part.lastCounter,
          part.firstLine,
          part.lastLine,
          part.entryCount,
          part.lineCount,
          part.totalDebitK / 100,
          part.totalCreditK / 100,
          part.fileName,
          sha256,
          bytes.length,
          Buffer.from(gzipSync(bytes)),
          userId,
        ],
      );
      out.push({
        book: part.book,
        partNo: part.partNo,
        uniqueId: part.uniqueId,
        fileName: part.fileName,
        periodStart: part.periodStart,
        periodEnd: part.periodEnd,
        sizeBytes: bytes.length,
        sha256,
        signaturePending,
      });
    }
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
       VALUES ($1, current_tenant_id(), $2, 'edefter_parts.generate', 'edefter_parts', $3, NULL, $4, now())`,
      [
        newId(),
        userId,
        newId(),
        { period, parts: out.map((p) => ({ file: p.fileName, sha256: p.sha256 })) },
      ],
    );
    return { period, parts: out, summary: result.summary };
  });
}

/** Hesap dönemindeki ayların e-Defter durumu (ekran listesi). */
export async function listYear(year: number, tenantId?: string) {
  return accountingService.withTenantClient(tenantId, async (client) => {
    const r = await client.query(
      `SELECT period, book_type, part_no, unique_id, file_name, status, size_bytes, sha256,
              first_entry_no, last_entry_no, entry_count, line_count, total_debit, total_credit, created_at
         FROM edefter_parts
        WHERE tenant_id = current_tenant_id() AND fiscal_year = $1 AND status <> 'superseded'
        ORDER BY period, book_type DESC, part_no`,
      [year],
    );
    return r.rows.map((row) => ({
      ...row,
      size_bytes: Number(row.size_bytes),
      total_debit: Number(row.total_debit),
      total_credit: Number(row.total_credit),
    }));
  });
}

/** Ayın dosyalarını zip olarak döndürür (Y + K parçaları + görüntüleme XSLT'leri). */
export async function downloadZip(
  period: string,
  tenantId?: string,
): Promise<{ fileName: string; body: Buffer }> {
  return accountingService.withTenantClient(tenantId, async (client) => {
    const r = await client.query(
      `SELECT file_name, content FROM edefter_parts
        WHERE tenant_id = current_tenant_id() AND period = $1 AND status <> 'superseded'
        ORDER BY book_type DESC, part_no`,
      [period],
    );
    if (r.rows.length === 0)
      throw new AppError('NOT_FOUND', `${period} dönemi için oluşturulmuş defter yok.`);
    const files: Record<string, Uint8Array> = {};
    for (const row of r.rows)
      files[String(row.file_name)] = gunzipSync(new Uint8Array(row.content as Buffer));
    for (const x of ['yevmiye.xslt', 'kebir.xslt']) {
      files[x] = new Uint8Array(readFileSync(join(edefterAssetsDir(), 'xslt', x)));
    }
    files['BENIOKU.txt'] = strToU8(
      'Bu dosyalar GİB e-Defter Paketi kurallarına göre imzasız üretilmiştir.\r\n' +
        'Mali mühür/NES ile imzalama, berat oluşturma ve GİB e-Defter uygulamasına yükleme entegratör tarafından yapılır.\r\n',
    );
    const vkn = String(r.rows[0].file_name).split('-')[0];
    return { fileName: `${vkn}-${period}-edefter.zip`, body: Buffer.from(zipSync(files)) };
  });
}

/** Entegratöre gönderildi işareti (gönderilen ay yanlışlıkla yeniden üretilmesin). */
export async function setDelivered(
  period: string,
  delivered: boolean,
  userId: string,
  tenantId?: string,
) {
  return accountingService.withTenantClient(tenantId, async (client) => {
    const r = await client.query(
      `UPDATE edefter_parts SET status = $2, updated_at = now()
        WHERE tenant_id = current_tenant_id() AND period = $1 AND status <> 'superseded'`,
      [period, delivered ? 'delivered' : 'generated'],
    );
    if ((r.rowCount ?? 0) === 0)
      throw new AppError('NOT_FOUND', `${period} dönemi için oluşturulmuş defter yok.`);
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
       VALUES ($1, current_tenant_id(), $2, $3, 'edefter_parts', $4, NULL, $5, now())`,
      [
        newId(),
        userId,
        `edefter_parts.${delivered ? 'delivered' : 'undelivered'}`,
        newId(),
        { period },
      ],
    );
    return { period, status: delivered ? 'delivered' : 'generated' };
  });
}

/** Son üretilmiş ayın defterlerini siler (yalnızca en son ay; gönderilmemişse). */
export async function removeMonth(period: string, userId: string, tenantId?: string) {
  return accountingService.withTenantClient(tenantId, async (client) => {
    const parts = await currentParts(client, period);
    if (parts.length === 0)
      throw new AppError('NOT_FOUND', `${period} dönemi için oluşturulmuş defter yok.`);
    if (parts.some((p) => p.status === 'delivered')) {
      throw new AppError(
        'CONFLICT',
        'Entegratöre gönderilmiş defter silinemez; önce işareti kaldırın.',
      );
    }
    const later = await client.query(
      `SELECT COUNT(*)::int AS n FROM edefter_parts
        WHERE tenant_id = current_tenant_id() AND status <> 'superseded' AND period > $1`,
      [period],
    );
    if (Number(later.rows[0].n) > 0) {
      throw new AppError('CONFLICT', 'Yalnızca en son ayın defteri silinebilir.');
    }
    await client.query(
      `UPDATE edefter_parts SET status = 'superseded', updated_at = now()
        WHERE tenant_id = current_tenant_id() AND period = $1 AND status <> 'superseded'`,
      [period],
    );
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
       VALUES ($1, current_tenant_id(), $2, 'edefter_parts.remove', 'edefter_parts', $3, NULL, $4, now())`,
      [newId(), userId, newId(), { period }],
    );
    return { period, removed: parts.length };
  });
}

/** e-Defter profili ve eksikleri (ekranda "bilgileri tamamlayın" kutusu için). */
export async function profileStatus(tenantId?: string) {
  return accountingService.withTenantClient(tenantId, async (client) => {
    const { settings, profile, issues } = await loadProfile(client);
    return { settings, vkn: profile.vkn, title: profile.title, issues };
  });
}
