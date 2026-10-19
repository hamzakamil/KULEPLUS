import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError, newId } from '@kuleplus/shared';
import type { CreateJournalEntryInput } from './schemas';
import { resequenceEntries, toIsoDate, toKurus } from './ledger';
import { accountingService } from './service';

/**
 * Yıl sonu kapanış sihirbazı (Faz 9-3).
 *
 * Tek işlemde, kapatılan yılın son günü tarihiyle:
 *  1. 7/A yansıtma (770→632/771, 760→631/761, 750→630/751, 780→660/781, 740→622/741,
 *     710/720/730→151/7x1) ve 7xx hesaplarının kapatılması,
 *  2. 6xx gelir tablosu hesaplarının 690'a devri,
 *  3. Dönem kârı vergi karşılığı (691 / 370) ve peşin ödenen vergilerin (193) mahsubu,
 *  4. 690 / 691 → 692 → 590 (kâr) ya da 591 (zarar),
 *  5. Kapanış fişi (1–5. sınıf bakiyeleri ters çevrilir; yılın SON maddesi),
 * ve yeni yılın ilk günü tarihiyle:
 *  6. Açılış fişi (yeni yılın 1. maddesi),
 *  7. İsteğe bağlı 590→570 / 591→580 virmanı.
 * Ardından madde numaraları sıralanır ve dönem kapatılır. Önizleme aynı hesabı geri alınan bir
 * transaction'da yapar; sihirbaz ekranı tam olarak kesilecek fişleri gösterir.
 *
 * Tüm fişler `source_id = kapatılan dönemin id'si` taşır; "geri al" bunları birlikte kaldırır.
 */

export const YEAR_END_SOURCES = {
  reflect: 'year_end_reflect',
  result: 'year_end_result',
  tax: 'year_end_tax',
  closing: 'year_end_closing',
  opening: 'year_end_opening',
  transfer: 'year_end_transfer',
} as const;

/** 7/A varsayılan yansıtma tablosu: maliyet hesabı → yansıtma hesabı → hedef (6xx / 151). */
export const DEFAULT_REFLECTIONS = [
  { source_code: '710', reflect_code: '711', target_code: '151' },
  { source_code: '720', reflect_code: '721', target_code: '151' },
  { source_code: '730', reflect_code: '731', target_code: '151' },
  { source_code: '740', reflect_code: '741', target_code: '622' },
  { source_code: '750', reflect_code: '751', target_code: '630' },
  { source_code: '760', reflect_code: '761', target_code: '631' },
  { source_code: '770', reflect_code: '771', target_code: '632' },
  { source_code: '780', reflect_code: '781', target_code: '660' },
];

export const taxSettingsSchema = z.object({
  /** kurumlar: sermaye şirketi (691/370 hesaplanır) · gelir: şahıs işletmesi (vergi beyanda). */
  taxpayer_type: z.enum(['kurumlar', 'gelir']),
  corporate_tax_rate: z.number().min(0).max(100),
});
export type TaxSettings = z.infer<typeof taxSettingsSchema>;
const DEFAULT_TAX_SETTINGS: TaxSettings = { taxpayer_type: 'kurumlar', corporate_tax_rate: 25 };

export const yearEndInputSchema = z.object({
  fiscal_year: z.number().int().min(1900).max(2999),
  reflections: z
    .array(z.object({ source_code: z.string().regex(/^7[1-8]0$/), target_code: z.string().min(3) }))
    .optional(),
  tax: z
    .object({
      /** Kanunen kabul edilmeyen giderler (matraha eklenir). */
      kkeg: z.number().min(0).default(0),
      /** İndirim ve istisnalar + mahsup edilecek geçmiş yıl zararları (matrahtan düşülür). */
      deductions: z.number().min(0).default(0),
      /** Oran (%); boşsa şirket ayarı. */
      rate: z.number().min(0).max(100).optional(),
      /** Elle vergi tutarı; verilirse hesaplananın yerine geçer. */
      amount: z.number().min(0).optional(),
    })
    .optional(),
  /** Açılışla birlikte 590→570 / 591→580 virmanı yapılsın mı (genel kurul öncesi genelde hayır). */
  transfer_result: z.boolean().default(false),
});
export type YearEndInput = z.input<typeof yearEndInputSchema>;

type Account = { id: string; code: string; name: string };
type Balance = Account & { balanceK: number };
type DraftLine = { account: Account; debitK: number; creditK: number };
export interface DraftEntry {
  key: keyof typeof YEAR_END_SOURCES | 'transfer';
  entry_type: 'donem_sonu' | 'kapanis' | 'acilis' | 'mahsup';
  source_type: string;
  entry_date: string;
  description: string;
  lines: DraftLine[];
}

export interface YearEndResult {
  fiscal_year: number;
  year_end: string;
  opening_date: string;
  errors: string[];
  warnings: string[];
  tax_settings: TaxSettings;
  reflections: Array<{
    source_code: string;
    reflect_code: string;
    target_code: string;
    amount: number;
  }>;
  tax: {
    ticari_kar: number;
    kkeg: number;
    deductions: number;
    matrah: number;
    rate: number;
    computed: number;
    amount: number;
    prepaid_offset: number;
    payable: number;
  } | null;
  net_result: number;
  entries: Array<{
    entry_type: string;
    source_type: string;
    entry_date: string;
    description: string;
    entry_id?: string;
    entry_no?: number | null;
    lines: Array<{ account_code: string; account_name: string; debit: number; credit: number }>;
  }>;
  closed: boolean;
}

// ---------------------------------------------------------------- yardımcılar

/** Tüm hesapların tarihe kadarki onaylı bakiyesi (açılış bakiyesi dahil; borç − alacak, kuruş). */
async function balances(client: PoolClient, until: string): Promise<Balance[]> {
  const r = await client.query(
    `SELECT aa.id, aa.code, aa.name,
            (COALESCE(aa.opening_debit, 0) - COALESCE(aa.opening_credit, 0))
            + COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.id IS NOT NULL), 0) AS bal
       FROM accounting_accounts aa
       LEFT JOIN journal_lines jl ON jl.account_id = aa.id AND jl.tenant_id = aa.tenant_id
       LEFT JOIN journal_entries je
         ON je.id = jl.entry_id AND je.status = 'posted' AND je.entry_date <= $1::date
      WHERE aa.tenant_id = current_tenant_id()
      GROUP BY aa.id, aa.code, aa.name, aa.opening_debit, aa.opening_credit
      ORDER BY aa.code`,
    [until],
  );
  return r.rows
    .map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      balanceK: toKurus(row.bal),
    }))
    .filter((b) => b.balanceK !== 0);
}

const under = (code: string, root: string) => code === root || code.startsWith(`${root}.`);

async function accountByCode(client: PoolClient, code: string): Promise<Account> {
  const r = await client.query(
    'SELECT id, code, name FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1',
    [code],
  );
  if (!r.rows[0]) {
    throw new AppError(
      'VALIDATION_ERROR',
      `${code} hesabı hesap planında yok; önce hesap planını tamamlayın.`,
    );
  }
  return { id: String(r.rows[0].id), code: String(r.rows[0].code), name: String(r.rows[0].name) };
}

/** İşaretli satır: pozitif → borç, negatif → alacak. */
function signed(lines: DraftLine[], account: Account, k: number) {
  if (k > 0) lines.push({ account, debitK: k, creditK: 0 });
  else if (k < 0) lines.push({ account, debitK: 0, creditK: -k });
}

export async function getTaxSettingsOn(client: PoolClient): Promise<TaxSettings> {
  const r = await client.query(
    `SELECT value FROM tenant_settings WHERE tenant_id = current_tenant_id() AND key = 'accounting_tax'`,
  );
  const parsed = taxSettingsSchema.safeParse(r.rows[0]?.value);
  return parsed.success ? parsed.data : { ...DEFAULT_TAX_SETTINGS };
}

async function writeAudit(
  client: PoolClient,
  userId: string,
  action: string,
  entityId: string,
  values: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
     VALUES ($1, current_tenant_id(), $2, $3, 'fiscal_periods', $4, NULL, $5, now())`,
    [newId(), userId, `fiscal_periods.${action}`, entityId, values],
  );
}

async function loadYear(client: PoolClient, year: number) {
  const r = await client.query(
    `SELECT id, year, status, start_date, end_date FROM fiscal_periods
      WHERE tenant_id = current_tenant_id() AND year = $1`,
    [year],
  );
  return r.rows[0] as
    | { id: string; year: number; status: string; start_date: unknown; end_date: unknown }
    | undefined;
}

async function existingYearEndEntries(client: PoolClient, periodId: string) {
  const r = await client.query(
    `SELECT id, created_at FROM journal_entries
      WHERE tenant_id = current_tenant_id() AND source_id = $1 AND source_type LIKE 'year\\_end\\_%'`,
    [periodId],
  );
  return r.rows as Array<{ id: string; created_at: Date }>;
}

class DryRun extends Error {
  constructor(public readonly result: YearEndResult) {
    super('dry-run');
  }
}

// ---------------------------------------------------------------- sihirbaz

async function runYearEnd(
  client: PoolClient,
  rawInput: YearEndInput,
  userId: string,
  commit: boolean,
): Promise<YearEndResult> {
  const input = yearEndInputSchema.parse(rawInput);
  const year = input.fiscal_year;
  const errors: string[] = [];
  const warnings: string[] = [];
  const settings = await getTaxSettingsOn(client);

  const period = await loadYear(client, year);
  if (!period) {
    const msg = `${year} mali dönemi tanımlı değil (bu yıla ait kayıt yok).`;
    if (commit) throw new AppError('NOT_FOUND', msg);
    return {
      fiscal_year: year,
      year_end: `${year}-12-31`,
      opening_date: `${year + 1}-01-01`,
      errors: [msg],
      warnings,
      tax_settings: settings,
      reflections: [],
      tax: null,
      net_result: 0,
      entries: [],
      closed: false,
    };
  }
  const yearEnd = toIsoDate(period.end_date);
  const next = await loadYear(client, year + 1);
  const openingDate = next
    ? toIsoDate(next.start_date)
    : toIsoDate((await client.query(`SELECT ($1::date + 1) AS d`, [yearEnd])).rows[0].d);

  const result: YearEndResult = {
    fiscal_year: year,
    year_end: yearEnd,
    opening_date: openingDate,
    errors,
    warnings,
    tax_settings: settings,
    reflections: [],
    tax: null,
    net_result: 0,
    entries: [],
    closed: false,
  };

  // ---- ön kontroller (engelleyici)
  if ((await existingYearEndEntries(client, period.id)).length > 0) {
    errors.push(
      `${year} yılı için kapanış zaten yapılmış. Yeniden yapmak için önce "Kapanışı geri al".`,
    );
  } else if (period.status === 'closed') {
    errors.push(`${year} mali dönemi kapalı.`);
  }
  if (next?.status === 'closed')
    errors.push(`${year + 1} mali dönemi kapalı; açılış fişi yazılamaz.`);
  const drafts = await client.query(
    `SELECT COUNT(*)::int AS n FROM journal_entries
      WHERE tenant_id = current_tenant_id() AND fiscal_year = $1 AND status = 'draft'`,
    [year],
  );
  if (drafts.rows[0].n > 0) {
    errors.push(`${year} yılında ${drafts.rows[0].n} taslak fiş var; onaylayın veya silin.`);
  }
  const openEarlier = await client.query(
    `SELECT DISTINCT fp.year FROM fiscal_periods fp
       JOIN journal_entries je ON je.period_id = fp.id AND je.status = 'posted'
      WHERE fp.tenant_id = current_tenant_id() AND fp.year < $1 AND fp.status <> 'closed'
      ORDER BY fp.year`,
    [year],
  );
  if (openEarlier.rows.length > 0) {
    errors.push(
      `Önce önceki yıl(lar)ı kapatın: ${openEarlier.rows.map((r) => r.year).join(', ')}.`,
    );
  }
  const lock = await client.query(
    `SELECT MAX(lock_date) AS d FROM period_locks WHERE tenant_id = current_tenant_id()`,
  );
  const lockDate = lock.rows[0]?.d ? toIsoDate(lock.rows[0].d) : null;
  if (lockDate && lockDate > yearEnd) {
    errors.push(`Dönem kilidi (${lockDate}) yıl sonunun ilerisinde; kapanış fişleri yazılamaz.`);
  } else if (lockDate && lockDate > openingDate) {
    errors.push(
      `Dönem kilidi (${lockDate}) yeni yılın ilk gününün ilerisinde; açılış fişi yazılamaz.`,
    );
  }

  // ---- 7xx kontrolü ve yansıtma planı
  const before = await balances(client, yearEnd);
  const overrides = new Map((input.reflections ?? []).map((r) => [r.source_code, r.target_code]));
  const plan = DEFAULT_REFLECTIONS.map((r) => ({
    ...r,
    target_code: overrides.get(r.source_code) ?? r.target_code,
  }));
  const handled = new Set(plan.flatMap((p) => [p.source_code, p.reflect_code]));
  const stray = before.filter((b) => b.code.startsWith('7') && !handled.has(b.code.slice(0, 3)));
  if (stray.length > 0) {
    errors.push(
      `Otomatik yansıtılamayan maliyet hesaplarında bakiye var (${stray.map((s) => s.code).join(', ')}). ` +
        '7/B (79x) dağıtımını veya bu hesapların düzeltmesini önce yapın.',
    );
  }
  for (const p of plan) {
    if (!/^(1|6)/.test(p.target_code)) {
      errors.push(
        `${p.source_code} için yansıtma hedefi 1 ya da 6. sınıf bir hesap olmalı (${p.target_code}).`,
      );
    }
  }

  // ---- uyarılar (engellemez)
  const vatLeft = before.filter(
    (b) => under(b.code.slice(0, 3), '391') || under(b.code.slice(0, 3), '191'),
  );
  if (vatLeft.length > 0) {
    warnings.push(
      `KDV hesaplarında bakiye var (${vatLeft.map((v) => `${v.code}: ${v.balanceK / 100}`).join(', ')}). ` +
        'Aralık KDV mahsup fişini kesmeniz önerilir.',
    );
  }
  if (before.some((b) => b.code.startsWith('15') && b.balanceK !== 0)) {
    warnings.push('Dönem sonu stok sayımı ve satılan malın maliyeti (621) kaydını kontrol edin.');
  }
  if (plan.some((p) => p.target_code === '151') && before.some((b) => /^7[123]0/.test(b.code))) {
    warnings.push(
      'Üretim maliyetleri (710/720/730) 151 Yarı Mamuller hesabına yansıtılıyor; mamul/SMM ayrımını kontrol edin.',
    );
  }

  if (errors.length > 0) {
    if (commit) throw new AppError('VALIDATION_ERROR', errors.join(' '));
    return result;
  }

  // ---- fişler
  const drafts_: DraftEntry[] = [];
  const write = async (d: DraftEntry) => {
    drafts_.push(d);
    if (d.lines.length < 2) return;
    await accountingService.createEntryOn(
      client,
      {
        entry_date: d.entry_date,
        entry_type: d.entry_type,
        status: 'posted',
        description: d.description,
        source_type: d.source_type,
        source_id: period.id,
        lines: d.lines.map((l) => ({
          account_id: l.account.id,
          debit: l.debitK / 100,
          credit: l.creditK / 100,
          description: d.description,
        })),
      } as CreateJournalEntryInput,
      userId,
    );
  };

  // 1) 7/A yansıtma + 7xx kapanışı
  const reflectLines: DraftLine[] = [];
  const closeCostLines: DraftLine[] = [];
  for (const p of plan) {
    const leaves = before.filter((b) => under(b.code, p.source_code));
    const sourceK = leaves.reduce((s, b) => s + b.balanceK, 0);
    const reflectK = before
      .filter((b) => under(b.code, p.reflect_code))
      .reduce((s, b) => s + b.balanceK, 0);
    const pendingK = sourceK + reflectK; // ay içinde elle yansıtılmış kısım düşülür
    if (sourceK === 0 && reflectK === 0) continue;
    const reflect = await accountByCode(client, p.reflect_code);
    if (pendingK !== 0) {
      const target = await accountByCode(client, p.target_code);
      signed(reflectLines, target, pendingK);
      signed(reflectLines, reflect, -pendingK);
    }
    result.reflections.push({ ...p, amount: pendingK / 100 });
    for (const leaf of leaves) signed(closeCostLines, leaf, -leaf.balanceK);
    signed(closeCostLines, reflect, sourceK);
  }
  await write({
    key: 'reflect',
    entry_type: 'donem_sonu',
    source_type: YEAR_END_SOURCES.reflect,
    entry_date: yearEnd,
    description: `${year} 7/A maliyet hesaplarının yansıtılması`,
    lines: reflectLines,
  });
  await write({
    key: 'reflect',
    entry_type: 'donem_sonu',
    source_type: YEAR_END_SOURCES.reflect,
    entry_date: yearEnd,
    description: `${year} maliyet hesaplarının (7xx) kapatılması`,
    lines: closeCostLines,
  });

  // 2) 6xx → 690
  const p690 = await accountByCode(client, '690');
  const afterReflect = await balances(client, yearEnd);
  const incomeLines: DraftLine[] = [];
  let to690K = 0;
  for (const b of afterReflect) {
    if (!b.code.startsWith('6') || /^69/.test(b.code)) continue;
    signed(incomeLines, b, -b.balanceK);
    to690K += b.balanceK;
  }
  signed(incomeLines, p690, to690K);
  await write({
    key: 'result',
    entry_type: 'donem_sonu',
    source_type: YEAR_END_SOURCES.result,
    entry_date: yearEnd,
    description: `${year} gelir tablosu hesaplarının 690 hesabına devri`,
    lines: incomeLines,
  });

  // 3) vergi karşılığı (691 / 370) + 193 mahsubu
  const b690K = (afterReflect.find((b) => b.code === '690')?.balanceK ?? 0) + to690K; // borç − alacak
  const ticariKarK = -b690K;
  const kkegK = toKurus(input.tax?.kkeg ?? 0);
  const deductionsK = toKurus(input.tax?.deductions ?? 0);
  const rate =
    input.tax?.rate ?? (settings.taxpayer_type === 'kurumlar' ? settings.corporate_tax_rate : 0);
  const matrahK = ticariKarK + kkegK - deductionsK;
  const computedK = matrahK > 0 ? Math.round((matrahK * rate) / 100) : 0;
  const taxK = input.tax?.amount !== undefined ? toKurus(input.tax.amount) : computedK;
  const taxLines: DraftLine[] = [];
  let prepaidK = 0;
  if (taxK > 0) {
    const a691 = await accountByCode(client, '691');
    const a370 = await accountByCode(client, '370');
    signed(taxLines, a691, taxK);
    signed(taxLines, a370, -taxK);
    let remaining = taxK;
    for (const b of afterReflect.filter((x) => under(x.code, '193') && x.balanceK > 0)) {
      const part = Math.min(remaining, b.balanceK);
      if (part <= 0) break;
      signed(taxLines, a370, part);
      signed(taxLines, b, -part);
      prepaidK += part;
      remaining -= part;
    }
  }
  const prepaidTotalK = afterReflect
    .filter((x) => under(x.code, '193'))
    .reduce((s, b) => s + b.balanceK, 0);
  if (prepaidTotalK - prepaidK > 0) {
    warnings.push(
      `193 Peşin Ödenen Vergiler hesabında ${(prepaidTotalK - prepaidK) / 100} TL mahsup edilemeyen tutar kaldı (iade/mahsup talebi).`,
    );
  }
  if (settings.taxpayer_type === 'gelir' && input.tax?.amount === undefined) {
    warnings.push(
      'Şahıs işletmesi: gelir vergisi beyannamede hesaplanır; 691/370 kaydı yapılmadı.',
    );
  }
  result.tax = {
    ticari_kar: ticariKarK / 100,
    kkeg: kkegK / 100,
    deductions: deductionsK / 100,
    matrah: matrahK / 100,
    rate,
    computed: computedK / 100,
    amount: taxK / 100,
    prepaid_offset: prepaidK / 100,
    payable: (taxK - prepaidK) / 100,
  };
  await write({
    key: 'tax',
    entry_type: 'donem_sonu',
    source_type: YEAR_END_SOURCES.tax,
    entry_date: yearEnd,
    description: `${year} dönem kârı vergi karşılığı ve peşin ödenen vergilerin mahsubu`,
    lines: taxLines,
  });

  // 4) 690 / 691 → 692 → 590 / 591
  const a692 = await accountByCode(client, '692');
  const b691K =
    afterReflect.filter((b) => under(b.code, '691')).reduce((s, b) => s + b.balanceK, 0) + taxK;
  const resultLines: DraftLine[] = [];
  signed(resultLines, p690, -b690K);
  signed(resultLines, a692, b690K);
  if (b691K !== 0) {
    signed(resultLines, await accountByCode(client, '691'), -b691K);
    signed(resultLines, a692, b691K);
  }
  const b692K = b690K + b691K + (afterReflect.find((b) => b.code === '692')?.balanceK ?? 0);
  if (b692K < 0) {
    signed(resultLines, a692, -b692K);
    signed(resultLines, await accountByCode(client, '590'), b692K);
  } else if (b692K > 0) {
    signed(resultLines, a692, -b692K);
    signed(resultLines, await accountByCode(client, '591'), b692K);
  }
  result.net_result = -b692K / 100;
  await write({
    key: 'result',
    entry_type: 'donem_sonu',
    source_type: YEAR_END_SOURCES.result,
    entry_date: yearEnd,
    description: `${year} dönem net ${b692K <= 0 ? 'kârının' : 'zararının'} 692 üzerinden ${b692K <= 0 ? '590' : '591'} hesabına devri`,
    lines: resultLines,
  });

  // 5) kapanış — 1–5. sınıf bakiyeleri sıfırlanır; 6/7 tamamen kapanmış olmalı
  const finalBal = await balances(client, yearEnd);
  const leftover = finalBal.filter((b) => /^[67]/.test(b.code));
  if (leftover.length > 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Kapanış sonrası gelir tablosu/maliyet hesaplarında bakiye kaldı: ${leftover.map((b) => b.code).join(', ')}`,
    );
  }
  const sheet = finalBal.filter((b) => /^[1-5]/.test(b.code));
  const closingLines: DraftLine[] = [];
  const openingLines: DraftLine[] = [];
  for (const b of sheet) {
    signed(closingLines, b, -b.balanceK);
    signed(openingLines, b, b.balanceK);
  }
  await write({
    key: 'closing',
    entry_type: 'kapanis',
    source_type: YEAR_END_SOURCES.closing,
    entry_date: yearEnd,
    description: `${year} kapanış fişi`,
    lines: closingLines,
  });
  await write({
    key: 'opening',
    entry_type: 'acilis',
    source_type: YEAR_END_SOURCES.opening,
    entry_date: openingDate,
    description: `${year + 1} açılış fişi`,
    lines: openingLines,
  });

  // 6) isteğe bağlı virman: 590 → 570 / 591 → 580
  if (input.transfer_result && b692K !== 0) {
    const transferLines: DraftLine[] = [];
    if (b692K < 0) {
      signed(transferLines, await accountByCode(client, '590'), -b692K);
      signed(transferLines, await accountByCode(client, '570'), b692K);
    } else {
      signed(transferLines, await accountByCode(client, '580'), b692K);
      signed(transferLines, await accountByCode(client, '591'), -b692K);
    }
    await write({
      key: 'transfer',
      entry_type: 'mahsup',
      source_type: YEAR_END_SOURCES.transfer,
      entry_date: openingDate,
      description: `${year} dönem net ${b692K < 0 ? 'kârının geçmiş yıllar kârlarına' : 'zararının geçmiş yıllar zararlarına'} virmanı`,
      lines: transferLines,
    });
  }

  // 7) sıralama + dönemi kapat
  if (commit) {
    await resequenceEntries(client, year);
    await client.query(
      `UPDATE fiscal_periods SET status = 'closed', version = version + 1, updated_by = $2, updated_at = now()
        WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [period.id, userId],
    );
    await resequenceEntries(client, year + 1);
    result.closed = true;
  }

  const written = await client.query(
    `SELECT id, entry_no, entry_type, source_type, to_char(entry_date, 'YYYY-MM-DD') AS d, description
       FROM journal_entries
      WHERE tenant_id = current_tenant_id() AND source_id = $1 AND source_type LIKE 'year\\_end\\_%'
      ORDER BY entry_date, entry_no`,
    [period.id],
  );
  const byDesc = new Map(written.rows.map((r) => [String(r.description), r]));
  result.entries = drafts_
    .filter((d) => d.lines.length >= 2)
    .map((d) => {
      const w = byDesc.get(d.description);
      return {
        entry_type: d.entry_type,
        source_type: d.source_type,
        entry_date: d.entry_date,
        description: d.description,
        entry_id: commit ? (w?.id as string | undefined) : undefined,
        entry_no: commit ? (w ? Number(w.entry_no) : null) : undefined,
        lines: d.lines.map((l) => ({
          account_code: l.account.code,
          account_name: l.account.name,
          debit: l.debitK / 100,
          credit: l.creditK / 100,
        })),
      };
    });

  if (commit) {
    await writeAudit(client, userId, 'year_end_close', period.id, {
      fiscal_year: year,
      net_result: result.net_result,
      tax: result.tax,
      entries: result.entries.map((e) => ({ id: e.entry_id, no: e.entry_no, type: e.entry_type })),
    });
  } else {
    throw new DryRun(result);
  }
  return result;
}

/** Sihirbaz önizlemesi: tüm fişler geri alınan bir transaction'da hesaplanır. */
export async function previewYearEnd(input: YearEndInput, userId: string, tenantId?: string) {
  try {
    return await accountingService.withTenantClient(tenantId, (client) =>
      runYearEnd(client, input, userId, false),
    );
  } catch (err) {
    if (err instanceof DryRun) return err.result;
    throw err;
  }
}

export async function closeYear(input: YearEndInput, userId: string, tenantId?: string) {
  return accountingService.withTenantClient(tenantId, (client) =>
    runYearEnd(client, input, userId, true),
  );
}

/**
 * Kontrollü geri alma: kapanıştan SONRA yeni yılda fiş girilmemişse ve dönem kilidi yıl sonunu
 * geçmiyorsa sihirbazın tüm fişleri kaldırılır, dönem yeniden açılır, yeni yılın madde
 * numaraları yeniden sıralanır. İşlem audit'e yazılır.
 */
export async function undoYearEnd(fiscalYear: number, userId: string, tenantId?: string) {
  return accountingService.withTenantClient(tenantId, async (client) => {
    const period = await loadYear(client, fiscalYear);
    if (!period) throw new AppError('NOT_FOUND', `${fiscalYear} mali dönemi bulunamadı.`);
    const entries = await existingYearEndEntries(client, period.id);
    if (entries.length === 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${fiscalYear} yılı için sihirbazla yapılmış kapanış yok.`,
      );
    }
    const next = await loadYear(client, fiscalYear + 1);
    if (next?.status === 'closed') {
      throw new AppError('FORBIDDEN', `${fiscalYear + 1} dönemi kapalı; önce onu geri alın.`);
    }
    const yearEnd = toIsoDate(period.end_date);
    const lock = await client.query(
      `SELECT MAX(lock_date) AS d FROM period_locks WHERE tenant_id = current_tenant_id()`,
    );
    const lockDate = lock.rows[0]?.d ? toIsoDate(lock.rows[0].d) : null;
    if (lockDate && lockDate > yearEnd) {
      throw new AppError(
        'PERIOD_LOCKED',
        `Dönem kilidi (${lockDate}) kapanış fişlerinin ilerisinde; geri alınamaz.`,
      );
    }
    const closedAt = entries.reduce(
      (m, e) => (e.created_at > m ? e.created_at : m),
      entries[0].created_at,
    );
    const later = await client.query(
      `SELECT COUNT(*)::int AS n FROM journal_entries
        WHERE tenant_id = current_tenant_id() AND fiscal_year = $1 AND created_at > $2
          AND COALESCE(source_type, '') NOT LIKE 'year\\_end\\_%'`,
      [fiscalYear + 1, closedAt],
    );
    if (later.rows[0].n > 0) {
      throw new AppError(
        'FORBIDDEN',
        `Kapanıştan sonra ${fiscalYear + 1} yılında ${later.rows[0].n} fiş girilmiş; kapanış geri alınamaz.`,
      );
    }
    const ids = entries.map((e) => e.id);
    await client.query(
      'DELETE FROM journal_lines WHERE tenant_id = current_tenant_id() AND entry_id = ANY($1::uuid[])',
      [ids],
    );
    await client.query(
      'DELETE FROM journal_entries WHERE tenant_id = current_tenant_id() AND id = ANY($1::uuid[])',
      [ids],
    );
    await client.query(
      `UPDATE fiscal_periods SET status = 'open', version = version + 1, updated_by = $2, updated_at = now()
        WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [period.id, userId],
    );
    await resequenceEntries(client, fiscalYear + 1);
    await writeAudit(client, userId, 'year_end_undo', period.id, {
      fiscal_year: fiscalYear,
      removed_entries: ids.length,
    });
    return { fiscal_year: fiscalYear, removed_entries: ids.length, reopened: true };
  });
}

export async function getTaxSettings(tenantId?: string) {
  return accountingService.withTenantClient(tenantId, (client) => getTaxSettingsOn(client));
}

export async function updateTaxSettings(input: TaxSettings, userId: string, tenantId?: string) {
  const data = taxSettingsSchema.parse(input);
  return accountingService.withTenantClient(tenantId, async (client) => {
    await client.query(
      `INSERT INTO tenant_settings (tenant_id, key, value, updated_at)
       VALUES (current_tenant_id(), 'accounting_tax', $1, now())
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [data],
    );
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
       VALUES ($1, current_tenant_id(), $2, 'tenant_settings.accounting_tax', 'tenant_settings', current_tenant_id(), NULL, $3, now())`,
      [newId(), userId, data],
    );
    return data;
  });
}
