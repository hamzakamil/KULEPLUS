import type { PoolClient } from 'pg';
import { AppError, newId } from '@kuleplus/shared';

/**
 * Yevmiye çekirdeği ortak yardımcıları — tüm fiş üreten modüller (muhasebe, fatura,
 * çek, kur değerleme) bunları kullanır; kural tek yerde kalır.
 */

/** Tutarı kuruşa (tamsayı) çevirir — float toplama hatalarını önler (0.1 + 0.2 ≠ 0.3). */
export function toKurus(amount: number | string | null | undefined): number {
  return Math.round(Number(amount ?? 0) * 100);
}

/** İki ondalığa yuvarlar (numeric(18,2) kolonlarına yazılacak değer). */
export function round2(amount: number | string | null | undefined): number {
  return toKurus(amount) / 100;
}

/** Dönemin mali yılı (`fiscal_periods.year`); fişin `fiscal_year` kolonu trigger ile aynı değeri alır. */
export async function fiscalYearOfPeriod(client: PoolClient, periodId: string): Promise<number> {
  const r = await client.query(
    'SELECT year FROM fiscal_periods WHERE id = $1 AND tenant_id = current_tenant_id()',
    [periodId],
  );
  if (!r.rows[0]) throw new AppError('NOT_FOUND', 'Mali dönem bulunamadı');
  return Number(r.rows[0].year);
}

/** Yevmiye numarası kilidi: tenant + mali yıl başına tek advisory lock (transaction sonunda bırakılır). */
export async function lockEntryNumbering(client: PoolClient, fiscalYear: number): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('journal_entry_no:' || COALESCE(current_setting('app.tenant_id', true), '') || ':' || $1::text))",
    [fiscalYear],
  );
}

/**
 * Gap-free yevmiye madde numarası (SPEC §15) — her mali yılda 1'den başlar (yevmiye defteri /
 * e-Defter). Fişin yazılacağı dönemin id'si verilir; numara o dönemin mali yılı içinde MAX+1'dir.
 * Aynı yıl için tüm fiş üreticileri AYNI advisory lock'u kullanır; çağıran açık bir transaction
 * içinde olmalıdır.
 */
export async function allocateEntryNo(client: PoolClient, periodId: string): Promise<number> {
  const year = await fiscalYearOfPeriod(client, periodId);
  await lockEntryNumbering(client, year);
  const seq = await client.query(
    `SELECT COALESCE(MAX(entry_no), 0) + 1 AS next_no FROM journal_entries
      WHERE tenant_id = current_tenant_id() AND fiscal_year = $1`,
    [year],
  );
  return Number(seq.rows[0].next_no);
}

/** Aynı gün içindeki fişlerin defter sırası: açılış → olağan fişler → dönem sonu → kapanış. */
export const ENTRY_TYPE_ORDER_SQL = `CASE entry_type WHEN 'acilis' THEN 0 WHEN 'donem_sonu' THEN 2 WHEN 'kapanis' THEN 3 ELSE 1 END`;

/**
 * Yevmiye madde numaralarını tarih sırasına göre yeniden dizer ("Yeniden sırala").
 * Onay sırasında verilen numara, geriye tarihli fişler yüzünden tarih sırasını bozabilir; defter
 * basılmadan / kilitlenmeden önce bu fonksiyon numaraları tarih sırasıyla boşluksuz yeniden verir.
 *
 * Kilitli kısım DOKUNULMAZ: tenant kilit tarihinden (`period_locks`) önceki fişler basılmış /
 * e-Defter'e girmiş kabul edilir; yalnızca kilit tarihi ve sonrasındaki fişler, kilitli kısmın
 * son numarasından devam edecek şekilde sıralanır. Değişen fiş sayısını döndürür.
 */
export async function resequenceEntries(client: PoolClient, fiscalYear: number): Promise<number> {
  await lockEntryNumbering(client, fiscalYear);
  const lock = await client.query(
    `SELECT MAX(lock_date) AS lock_date FROM period_locks WHERE tenant_id = current_tenant_id()`,
  );
  const lockDate = lock.rows[0]?.lock_date ? toIsoDate(lock.rows[0].lock_date) : null;
  const base = await client.query(
    `SELECT COALESCE(MAX(entry_no), 0) AS base FROM journal_entries
      WHERE tenant_id = current_tenant_id() AND fiscal_year = $1 AND entry_no IS NOT NULL
        AND $2::date IS NOT NULL AND entry_date < $2::date`,
    [fiscalYear, lockDate],
  );
  const start = Number(base.rows[0].base);
  const changed = await client.query(
    `WITH ranked AS (
       SELECT id, entry_no,
              $3::bigint + row_number() OVER (
                ORDER BY entry_date, ${ENTRY_TYPE_ORDER_SQL}, entry_no, created_at, id
              ) AS rn
         FROM journal_entries
        WHERE tenant_id = current_tenant_id() AND fiscal_year = $1 AND entry_no IS NOT NULL
          AND ($2::date IS NULL OR entry_date >= $2::date)
     )
     SELECT id, rn FROM ranked WHERE entry_no <> rn`,
    [fiscalYear, lockDate, start],
  );
  if (changed.rows.length === 0) return 0;
  const ids = changed.rows.map((r) => r.id as string);
  const nos = changed.rows.map((r) => Number(r.rn));
  // İki aşama: önce negatife al (tekil indeks çakışmasın), sonra yeni numaraları yaz.
  await client.query(
    `UPDATE journal_entries SET entry_no = -entry_no
      WHERE tenant_id = current_tenant_id() AND id = ANY($1::uuid[])`,
    [ids],
  );
  await client.query(
    `UPDATE journal_entries je SET entry_no = v.no, updated_at = now()
       FROM unnest($1::uuid[], $2::bigint[]) AS v(id, no)
      WHERE je.id = v.id AND je.tenant_id = current_tenant_id()`,
    [ids, nos],
  );
  return ids.length;
}

/**
 * Fiş tarihine göre dönem kapısı — TÜM fiş üreticilerinin (muhasebe, fatura, çek, kur
 * değerleme) kullandığı TEK uygulama (SPEC §15: "kapalı döneme kayıt engeli").
 *
 * Sırayla:
 *  1. Dönem kilidi TENANT GENELİDİR: en geç `lock_date`'ten önceki tarihler, hangi mali
 *     döneme düşerse düşsün reddedilir (kilit bir döneme bağlı kayıtlıdır ama etkisi
 *     "belirlenen tarihe kadar geriye dönük" kayıt engelidir).
 *  2. Tarihi kapsayan dönem `closed` ise reddedilir.
 *  3. Kapsayan dönem yoksa o takvim yılı için dönem otomatik açılır (kontrol hiçbir
 *     zaman "dönem tanımlı değil" diye atlanmaz). Aynı yıl için farklı tarihli özel dönem
 *     varsa (ör. 1 Temmuz mali yılı) ve tarih onun dışında kalıyorsa açık hata verilir.
 * Dönem id'sini döndürür; çağıran `journal_entries.period_id` olarak yazar.
 */
export async function openPeriodFor(client: PoolClient, entryDate: string): Promise<string> {
  const lock = await client.query(
    `SELECT MAX(lock_date) AS lock_date FROM period_locks WHERE tenant_id = current_tenant_id()`,
  );
  const lockDate = lock.rows[0]?.lock_date ? toIsoDate(lock.rows[0].lock_date) : null;
  if (lockDate && entryDate < lockDate) {
    throw new AppError(
      'PERIOD_LOCKED',
      `Bu tarih dönem kilidinin gerisinde (kilit tarihi ${lockDate}).`,
    );
  }

  const find = () =>
    client.query(
      `SELECT id, status FROM fiscal_periods
        WHERE tenant_id = current_tenant_id() AND $1::date BETWEEN start_date AND end_date
        ORDER BY start_date DESC LIMIT 1`,
      [entryDate],
    );
  let period = (await find()).rows[0];
  if (!period) {
    const year = Number(entryDate.slice(0, 4));
    await client.query(
      `INSERT INTO fiscal_periods (id, tenant_id, label, year, start_date, end_date, status)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, 'open')
       ON CONFLICT (tenant_id, year) DO NOTHING`,
      [newId(), String(year), year, `${year}-01-01`, `${year}-12-31`],
    );
    period = (await find()).rows[0];
    if (!period) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Bu tarihi kapsayan mali dönem tanımlı değil; önce mali dönemi tanımlayın.',
      );
    }
  }
  if (period.status === 'closed') {
    throw new AppError('PERIOD_LOCKED', 'Bu mali dönem kapatılmış.');
  }
  return String(period.id);
}

/** Bugünün tarihi (YYYY-MM-DD, Europe/Istanbul — ADR-0019). */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

/**
 * pg `date` kolonunu YYYY-MM-DD'ye çevirir. node-pg `date`'i YEREL gece yarısı Date
 * olarak döndürür; `toISOString()` UTC+3'te bir gün geriye kayar — yerel bileşenler kullanılır.
 */
export function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/**
 * Tenant'ın `accounting` modül hakkı aktif mi? (SPEC §10.3: "Muhasebe: modül aktifse fiş").
 * Fatura/tahsilat gibi başka modüller muhasebe fişi yazmadan önce bunu sorar; böylece
 * muhasebe paketi olmayan tenant'ta sessizce yevmiye kaydı ve hesap planı oluşmaz.
 */
export async function isAccountingActive(client: PoolClient): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM tenant_entitlements
      WHERE tenant_id = current_tenant_id() AND module_code = 'accounting'
        AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
  );
  return (r.rowCount ?? 0) > 0;
}
