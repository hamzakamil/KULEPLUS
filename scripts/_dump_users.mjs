// Kullanici / uyelik dokumu
import { readFileSync } from 'node:fs';
import pg from 'pg';
const env = readFileSync('apps/api/.env', 'utf-8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: url });
const users = await pool.query(`SELECT email, status, email_verified_at IS NOT NULL AS verified, created_at::text
                                  FROM users ORDER BY created_at LIMIT 25`).catch((e) => ({ err: e.message }));
console.log('users:', JSON.stringify(users.rows ?? users.err));
const mem = await pool.query(`SELECT u.email, tm.tenant_id, tm.role_key
                                FROM tenant_members tm JOIN users u ON u.id = tm.user_id
                               LIMIT 25`).catch((e) => ({ err: e.message }));
console.log('members:', JSON.stringify(mem.rows ?? mem.err));
await pool.end();
