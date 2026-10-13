import { getPool } from '@kuleplus/db';

const t = Date.now();
const pool = getPool('app');
console.log('pool sinifi:', pool.constructor.name);
const r = await pool.query('SELECT 1 AS ok');
console.log('query:', JSON.stringify(r.rows), Date.now() - t, 'ms');
await pool.end();
console.log('bitti');
