import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { isValidMigrationName } from './tenant.js';

/**
 * Ham SQL migration çalıştırıcı — SPEC §30.7:
 * migrations/YYYYMMDDHHMM_<slug>.sql + zorunlu YYYYMMDDHHMM_<slug>.down.sql
 *
 * Kullanım:
 *   tsx src/migrate.ts up        # bekleyen migration'ları uygula
 *   tsx src/migrate.ts down      # son migration'ı geri al
 *   tsx src/migrate.ts status    # durum listele
 *
 * Bağlantı: DATABASE_MIGRATOR_URL (app_migrator rolü).
 */
const migrationsDir = new URL('../migrations/', import.meta.url);

function listUpMigrations(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .filter((f) => {
      if (!isValidMigrationName(f)) {
        throw new Error(`Migration adı kurala uymuyor (YYYYMMDDHHMM_<slug>.sql): ${f}`);
      }
      return true;
    })
    .sort();
}

function requireDownFile(upFile: string): string {
  const downFile = upFile.replace(/\.sql$/, '.down.sql');
  try {
    readFileSync(new URL(`../migrations/${downFile}`, import.meta.url), 'utf8');
  } catch {
    throw new Error(`Down SQL eksik — SPEC §30.7 zorunlu: ${downFile}`);
  }
  return downFile;
}

async function up(client: pg.PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.id));
  for (const file of listUpMigrations()) {
    requireDownFile(file);
    if (applied.has(file)) continue;
    const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`↑ uygulandı: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

async function down(client: pg.PoolClient): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1',
  );
  if (rows.length === 0) {
    console.log('Geri alınacak migration yok.');
    return;
  }
  const id = rows[0].id;
  const downFile = requireDownFile(id);
  const sql = readFileSync(new URL(`../migrations/${downFile}`, import.meta.url), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE id = $1', [id]);
    await client.query('COMMIT');
    console.log(`↓ geri alındı: ${id}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function status(client: pg.PoolClient): Promise<void> {
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const { rows } = await client.query<{ id: string; applied_at: string }>(
    'SELECT id, applied_at FROM schema_migrations ORDER BY id',
  );
  for (const file of listUpMigrations()) {
    const row = rows.find((r) => r.id === file);
    console.log(`${row ? '✓' : '·'} ${file}${row ? ` (${row.applied_at})` : ''}`);
  }
}

const command = process.argv[2] ?? 'status';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL,
});
const client = await pool.connect();
try {
  if (command === 'up') await up(client);
  else if (command === 'down') await down(client);
  else await status(client);
} finally {
  client.release();
  await pool.end();
}
