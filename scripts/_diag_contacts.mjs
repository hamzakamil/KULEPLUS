// Geçici teşhis: contacts 500 kaynağını DB seviyesinde doğrula (salt okunur / rollback'li)
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync('apps/api/.env', 'utf-8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
console.log('URL:', url);
const pool = new pg.Pool({ connectionString: url });

async function tryQuery(label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    console.log(`OK  ${label}:`, JSON.stringify(r.rows).slice(0, 200));
    return true;
  } catch (e) {
    console.log(`ERR ${label}: ${e.message}`);
    return false;
  }
}

// 1) Referans tablolar var mı?
for (const t of [
  'contacts', 'contact_addresses', 'contact_phones', 'contact_emails', 'contact_relations',
  'party_ledger_entries', 'invoices', 'invoice_sequences', 'tenants', 'users',
]) {
  await tryQuery(`tablo ${t}`, `SELECT to_regclass('public.${t}') AS c`);
}

// 2) contacts code constraint
const cc = await pool.query(
  `SELECT c.column_name, c.is_nullable, c.column_default,
          (SELECT string_agg(tc.constraint_type::text, ',') FROM information_schema.table_constraints tc
             JOIN information_schema.constraint_column_usage cu ON cu.constraint_name = tc.constraint_name
            WHERE tc.table_name='contacts' AND cu.column_name = c.column_name) AS constraints
     FROM information_schema.columns c WHERE c.table_name='contacts' AND c.column_name='code'`,
).catch((e) => ({ rows: [], err: e.message }));
console.log('code constraint:', JSON.stringify(cc.rows[0] || cc.err));

// 3) tenant listesi
const tenants = await pool.query('SELECT id, name FROM tenants ORDER BY created_at LIMIT 5').catch((e) => ({ rows: [], err: e.message }));
console.log('tenants:', JSON.stringify(tenants.rows).slice(0, 300), tenants.err || '');
const tid = tenants.rows[0]?.id;

// 4) GET /contacts replikası — tenant GUC ile
if (tid) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tid]);
    const list = await c.query(
      `SELECT c.*, COALESCE(led.debit, 0) AS debit, COALESCE(led.credit, 0) AS credit,
              COALESCE(led.debit,0) - COALESCE(led.credit,0) AS balance
         FROM contacts c
         LEFT JOIN (SELECT contact_id,
                           SUM(amount) FILTER (WHERE type='receivable') AS debit,
                           SUM(amount) FILTER (WHERE type='payable') AS credit
                    FROM party_ledger_entries WHERE tenant_id = current_tenant_id()
                    GROUP BY contact_id) led ON led.contact_id = c.id
        WHERE c.tenant_id = current_tenant_id()
        GROUP BY c.id, led.debit, led.credit
        ORDER BY c.code ASC NULLS LAST, c.name ASC LIMIT 5`,
    ).catch((e) => ({ rows: [], err: e.message }));
    if (list.err) console.log('ERR GET /contacts:', list.err);
    else console.log('OK  GET /contacts rowSayisi:', list.rows.length);

    // stats
    const stats = await c.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE type='customer') AS customers,
              COUNT(*) FILTER (WHERE type='supplier') AS suppliers
         FROM contacts WHERE tenant_id = current_tenant_id()`,
    ).catch((e) => ({ rows: [], err: e.message }));
    if (stats.err) console.log('ERR GET /contacts/stats:', stats.err);
    else console.log('OK  GET /contacts/stats:', JSON.stringify(stats.rows[0]));

    await c.query('ROLLBACK');
  } finally {
    c.release();
  }
}

await pool.end();
console.log('TEŞHİS BİTTİ');
