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

/**
 * Gap-free yevmiye madde numarası (SPEC §15). Aynı tenant'taki tüm fiş üreticileri
 * AYNI advisory lock anahtarını kullanmalıdır; aksi halde eşzamanlı iki işlem aynı
 * MAX+1 değerini okuyabilir. Çağıran açık bir transaction içinde olmalıdır
 * (`pg_advisory_xact_lock` transaction sonunda bırakılır).
 */
export async function allocateEntryNo(client: PoolClient): Promise<number> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('journal_entry_no:' || COALESCE(current_setting('app.tenant_id', true), '')))",
  );
  const seq = await client.query(
    'SELECT COALESCE(MAX(entry_no), 0) + 1 AS next_no FROM journal_entries WHERE tenant_id = current_tenant_id()',
  );
  return Number(seq.rows[0].next_no);
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
