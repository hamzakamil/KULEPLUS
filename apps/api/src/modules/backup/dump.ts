import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { Pool } from 'pg';

const gzipAsync = promisify(gzip);

/** PostgreSQL COPY (text) biçiminde tek bir değeri kaçışlar. */
function copyEscape(value: unknown): string {
  if (value === null || value === undefined) return '\\N';
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (value instanceof Date) return escapeCopyText(value.toISOString());
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`;
  if (typeof value === 'object') return escapeCopyText(JSON.stringify(value));
  return escapeCopyText(String(value));
}

function escapeCopyText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '');
}

/** Tanımlayıcıları COPY/tablo adlarında güvenli biçimde tırnaklar. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Veritabanının tam mantıksal yedeğini üretir (pg_dump benzeri COPY blokları).
 *
 * `public` şemasındaki tüm BASE TABLE'lar için `COPY ... FROM stdin;` blokları
 * içeren tek bir SQL dosyası gzip'lenip Buffer olarak döndürülür. Çıktı psql
 * ile geri yüklenebilir: `psql -d <hedef> -f <dosya>.sql.gz` (gunzip'ten sonra).
 *
 * `schema_migrations` hariç tutulur — o tablo hangi migration'ların uygulandığını
 * tutar ve restore akışını karıştırır.
 */
export async function buildBackupBuffer(pool: Pool): Promise<Buffer> {
  const client = await pool.connect();
  try {
    // Migrator/sahip rolü ile bağlanılır; RLS kapatılıp TÜM satırların yedeği alınır.
    // (Uygulama tabloları `ENABLE ROW LEVEL SECURITY` içerir; sahip rolü zaten
    // varsayılan olarak RLS'i atlar, yine de güvence için açıkça kapatılır.)
    try {
      await client.query('SET row_security = off');
    } catch {
      // RLS kapatma yetkisi yoksa sessizce devam edilir (kısıtlı yedek üretilir).
    }

    const tables = await client.query<{ name: string }>(
      `SELECT table_name AS name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name <> 'schema_migrations'
        ORDER BY table_name`,
    );

    const parts: string[] = [];
    parts.push('-- Kuleplus otomatik veritabanı yedeği');
    parts.push(`-- Oluşturulma: ${new Date().toISOString()}`);
    parts.push('-- Geri yükleme: gunzip -c <dosya>.sql.gz | psql -d <hedef>');
    parts.push('');
    parts.push('BEGIN;');
    parts.push('');

    for (const table of tables.rows) {
      const qualified = `public.${quoteIdent(table.name)}`;

      const cols = await client.query<{ name: string }>(
        `SELECT column_name AS name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [table.name],
      );
      const columnNames = cols.rows.map((c) => quoteIdent(c.name)).join(', ');

      const rows = await client.query<unknown[]>({
        text: `SELECT ${columnNames} FROM ${qualified}`,
        rowMode: 'array',
      });

      parts.push(`COPY ${qualified} (${columnNames}) FROM stdin;`);
      for (const row of rows.rows) {
        parts.push(row.map(copyEscape).join('\t'));
      }
      parts.push('\\.');
      parts.push('');
    }

    parts.push('COMMIT;');
    parts.push('');

    const plain = parts.join('\n');
    return await gzipAsync(Buffer.from(plain, 'utf8'));
  } finally {
    client.release();
  }
}
