/**
 * CSV yardımcıları — SPEC §23 (içe/dışa aktarma) ve §3 (Türkçe/UTF-8 BOM).
 *
 * Not: Ayrıştırıcı bağımlılıksızdır (RFC4180 benzeri). Modüller arası tekrar
 * olmasın diye modül içi `import.service.ts` dosyaları bu yardımcıları kullanır.
 */
import { AppError } from '@kuleplus/shared';

/** Türkçe karakter + boşluk normalizasyonu (başlık eşleştirme için). */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Basit CSV ayrıştırıcı (RFC4180 benzeri; bağımlılık yok):
 * - UTF-8 BOM'u atlar
 * - Ayırıcı tespiti: ilk satırdaki virgül/noktalı virgül sayımı (tırnak dışı)
 * - Tırnaklı alanlar, "" escape, CRLF/LF
 */
export function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  let text = content;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  if (!text.trim()) {
    throw new AppError('VALIDATION_ERROR', 'CSV dosyası boş');
  }

  // Ayırıcı tespiti (ilk satır, tırnak dışı)
  const firstLineEnd = text.search(/\r?\n/);
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  let inQuotes = false;
  let commaCount = 0;
  let semiCount = 0;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ',') commaCount++;
    else if (!inQuotes && ch === ';') semiCount++;
  }
  const delimiter = semiCount > commaCount ? ';' : ',';

  // Satır ayrımı (tırnak içindeki yeni satırları koru)
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      // Boş satırları atla
      if (row.some((v) => v.trim() !== '')) matrix.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) matrix.push(row);

  if (matrix.length < 2) {
    throw new AppError(
      'VALIDATION_ERROR',
      'CSV en az bir başlık satırı ve bir veri satırı içermelidir',
    );
  }

  const headers = matrix[0].map((h) => h.trim());
  const rows = matrix.slice(1);
  return { headers, rows };
}

/**
 * Başlık → hedef alan eşleştirme önerisi (genel).
 * `aliases`: hedef alan adı → takma ad listesi (normalize edilmiş, küçük harfli).
 */
export function suggestFieldMapping<F extends string>(
  headers: string[],
  aliases: Record<F, string[]>,
): Record<string, F | null> {
  const mapping: Record<string, F | null> = {};
  const used = new Set<F>();
  headers.forEach((header) => {
    const norm = normalizeHeader(header);
    let matched: F | null = null;
    for (const [field, names] of Object.entries(aliases) as [F, string[]][]) {
      if (used.has(field)) continue;
      if (names.includes(norm)) {
        matched = field;
        break;
      }
    }
    if (matched) used.add(matched);
    mapping[header] = matched;
  });
  return mapping;
}

/** RFC4180 kaçışı + UTF-8 BOM — Excel Türkçe karakterleri bozmadan açar (SPEC §3). */
export function toCsvText(headers: string[], rows: unknown[][]): string {
  const esc = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const s = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const row of rows) lines.push(row.map(esc).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Sayısal alan okuma — Excel TR biçimi ("1.234,56") ve düz biçim ("1234.56") kabul edilir.
 * FLOAT/DOUBLE yasağı gereği değer yuvarlanmaz; 8 ondalığa kadar safe sayı kabul edilir (SPEC §14.1).
 */
export function parseNumeric(value: string | undefined): number | null {
  const raw = (value ?? '').trim().replace(/\s|₺|\$/g, '');
  if (!raw) return null;
  let normalized = raw;
  if (raw.includes(',')) {
    // Ondalık ayıracı virgül: binlik ayıracı (nokta) kaldırılır
    normalized = raw.replace(/\./g, '').replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Eşleştirmeyi doğrula: kullanıcı seçimi yoksa öneri kullanılır.
 * Bilinmeyen hedef alan ve aynı alana iki kolon eşlenmesi engellenir (SPEC §23.1).
 */
export function resolveCsvMapping<F extends string>(
  headers: string[],
  suggested: Record<string, F | null>,
  mapping: Record<string, string | null> | undefined,
  allowedFields: readonly F[],
): Record<string, F | null> {
  const applied: Record<string, F | null> = {};
  for (const header of headers) {
    const requested = mapping ? (mapping[header] ?? null) : suggested[header];
    if (requested !== null && requested !== undefined) {
      if (!allowedFields.includes(requested as F)) {
        throw new AppError('VALIDATION_ERROR', `Bilinmeyen hedef alan: ${String(requested)}`);
      }
      applied[header] = requested as F;
    } else {
      applied[header] = null;
    }
  }

  const seen = new Set<string>();
  for (const field of Object.values(applied)) {
    if (field) {
      if (seen.has(field)) {
        throw new AppError('VALIDATION_ERROR', `Hedef alan birden fazla kolona eşlenmiş: ${field}`);
      }
      seen.add(field);
    }
  }
  return applied;
}

/**
 * Serbest format tarih ayrıştırma (CSV içe aktarma): GG.AA.YYYY, GG/AA/YYYY,
 * GG-AA-YYYY ve YYYY-MM-DD. Geçersiz/gerçekte olmayan tarih → null.
 * Saat yoksa yerel saatle 00:00 döner.
 */
export function parseFlexibleDate(value: string | undefined): Date | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;

  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const tr = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (tr) {
    day = Number(tr[1]);
    month = Number(tr[2]);
    year = Number(tr[3]);
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}
