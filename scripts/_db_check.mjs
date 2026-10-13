// Geçici DB tanı script'i — salt okunur kontrol
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync('apps/api/.env', 'utf-8');
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
};
const url = get('DATABASE_URL');
console.log('DATABASE_URL =', url);

const pool = new pg.Pool({ connectionString: url });
try {
  const r1 = await pool.query('select current_database() as db, current_user as usr');
  console.log('baglanti:', r1.rows[0]);

  const mig = await pool.query(
    'select id from schema_migrations order by id',
  ).catch(() => ({ rows: [] }));
  console.log('uygulanan migration sayisi:', mig.rows.length);
  console.log('son 5 migration:', mig.rows.slice(-5).map((r) => r.id).join(', '));

  const cols = await pool.query(
    `select column_name from information_schema.columns where table_name='contacts' order by ordinal_position`,
  ).catch((e) => ({ rows: [], err: e.message }));
  console.log('contacts kolonlari:', cols.rows.map((c) => c.column_name).join(', ') || cols.err);

  const cnt = await pool.query('select count(*)::int as n from contacts').catch((e) => ({ rows: [{ n: 'ERR: ' + e.message }] }));
  console.log('contacts satir sayisi:', cnt.rows[0].n);
} catch (e) {
  console.error('DB BAGLANTI HATASI:', e.message);
} finally {
  await pool.end();
}
