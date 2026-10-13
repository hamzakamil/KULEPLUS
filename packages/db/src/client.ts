import pg from 'pg';
import { getTenantScope, TENANT_GUC } from './tenant';

/**
 * Kapsam-duyarlı pool: aktif istek kapsamı (tenantScope) varsa `query`
 * çağrılarını kapsamın bağlantısına yönlendirir; yoksa normal pool davranışı.
 *
 * `connect()` HER ZAMAN gerçek pool'dan yeni bağlantı verir; kapsam içindeyse
 * bağlantıya session-seviyesi tenant GUC'u kurulur ve `release()` sırasında
 * RESET'lenir (başka isteğe kirli bağlantı sızmaz). Bu sayede servislerin
 * kendi explicit transaction'ları (`withTenantClient` deseni) de doğru
 * tenant'ı görür.
 */
/** Satır tipi: kolon adı → değer (pg'nin varsayılan satır şekli). */
type DefaultRow = Record<string, unknown>;

export class TenantAwarePool extends pg.Pool {
  override query<T extends pg.QueryResultRow = DefaultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>>;
  override query<T extends pg.QueryResultRow = DefaultRow>(
    config: pg.QueryConfig,
  ): Promise<pg.QueryResult<T>>;
  override query<T extends pg.QueryResultRow = DefaultRow>(
    queryTextOrConfig: string | pg.QueryConfig,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    const scope = getTenantScope();
    if (!scope) {
      return typeof queryTextOrConfig === 'string'
        ? super.query<T>(queryTextOrConfig, values)
        : super.query<T>(queryTextOrConfig);
    }
    return typeof queryTextOrConfig === 'string'
      ? scope.client.query<T>(queryTextOrConfig, values)
      : scope.client.query<T>(queryTextOrConfig);
  }

  /**
   * Kapsam içinde alınan explicit bağlantılara session-seviyesi tenant GUC'u
   * kurulur; `release()` sırasında RESET'lenir (başka isteğe kirli bağlantı sızmaz).
   *
   * NOT: pg-pool içi `pool.query()` → `this.connect(cb)` çağrısı CALLBACK
   * formundadır; callback düşürülürse sorgu sonsuza dek asılı kalır. Bu yüzden
   * her iki imza da desteklenir.
   */
  override connect(): Promise<pg.PoolClient>;
  override connect(
    callback: (
      err: Error | undefined,
      client: pg.PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): void;
  override connect(
    callback?: (
      err: Error | undefined,
      client: pg.PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): Promise<pg.PoolClient> | void {
    if (typeof callback !== 'function') {
      return this.connectScoped();
    }
    super.connect((err, client, done) => {
      if (err || !client) {
        callback(err, client, done);
        return;
      }
      void this.armRelease(client)
        .then(() => callback(null as unknown as Error, client, done))
        .catch((armError) => {
          try {
            done(armError);
          } catch {
            // done zaten çağrılmış olabilir
          }
          callback(armError as Error, client, done);
        });
    });
  }

  private async connectScoped(): Promise<pg.PoolClient> {
    const client = await super.connect();
    await this.armRelease(client);
    return client;
  }

  /** Kapsam varsa GUC kur + release'i RESET'li hale getir (yoksa no-op) */
  private async armRelease(client: pg.PoolClient): Promise<void> {
    const scope = getTenantScope();
    if (!scope) return;
    await client.query('SELECT set_config($1, $2, false)', [TENANT_GUC, scope.tenantId]);
    const rawRelease = client.release.bind(client);
    client.release = ((err?: Error) => {
      // Önce GUC'u temizle, sonra iade et (kirli bağlantı pool'a dönmez)
      void client
        .query(`RESET ${TENANT_GUC}`)
        .catch(() => undefined)
        .finally(() => rawRelease(err));
    }) as pg.PoolClient['release'];
  }
}

/**
 * PostgreSQL connection pool — SPEC §7.
 * Tek bir pool instance (singleton pattern) kullanılır.
 */
let pool: TenantAwarePool | null = null;

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

  pool = new TenantAwarePool({
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
