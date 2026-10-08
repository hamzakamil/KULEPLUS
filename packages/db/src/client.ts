import pg from 'pg';

/**
 * PostgreSQL connection pool — SPEC §7.
 * Tek bir pool instance (singleton pattern) kullanılır.
 */
let pool: pg.Pool | null = null;

/**
 * Pool örneğini döndürür; yoksa oluşturur.
 * Bağlantı string'i: postgresql://user:pass@host:port/db
 * ENV: DATABASE_URL (app_user), DATABASE_MIGRATOR_URL (app_migrator), DATABASE_PLATFORM_URL (app_platform)
 */
export function getPool(role: 'app' | 'migrator' | 'platform' = 'app'): pg.Pool {
  if (pool) return pool;

  const envKey = {
    app: 'DATABASE_URL',
    migrator: 'DATABASE_MIGRATOR_URL',
    platform: 'DATABASE_PLATFORM_URL',
  }[role];

  const connectionString = process.env[envKey];
  if (!connectionString) {
    throw new Error(`${envKey} environment variable not set`);
  }

  pool = new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected pg pool error', err);
  });

  return pool;
}

/**
 * Mevcut pool'u kapatır (graceful shutdown).
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export { pg };
