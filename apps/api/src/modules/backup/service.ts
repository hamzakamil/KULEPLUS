import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Logger } from 'pino';
import type { Pool, QueryResultRow } from 'pg';
import { buildBackupBuffer } from './dump.js';
import type { UpdateBackupSettingsInput } from './schemas.js';

export type BackupJobStatus = 'running' | 'success' | 'failed';

export interface BackupJobRow extends QueryResultRow {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  status: BackupJobStatus;
  size_bytes: number | null;
  file_name: string | null;
  error: string | null;
  created_by: string | null;
  created_at: Date;
}

export interface BackupSettingsRow extends QueryResultRow {
  id: number;
  enabled: boolean;
  interval_minutes: number;
  retention_count: number;
  next_run_at: Date;
  last_run_at: Date | null;
  last_status: string | null;
  last_error: string | null;
  updated_at: Date;
}

export interface BackupStatus {
  enabled: boolean;
  intervalMinutes: number;
  retentionCount: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  hasRunning: boolean;
  now: Date;
}

/** pino veya req.log (pino-http) için dar log arayüzü. */
type LogLike = Pick<Logger, 'info' | 'error'>;

/** Yedek dosyalarının saklandığı dizin (varsayılan: <cwd>/backups). */
function backupDir(): string {
  return process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups');
}

/** Yedek dump'ı için ayrı pool — migrator rolüyle (RLS'siz tam okuma). */
let dumpPool: pg.Pool | null = null;
function getDumpPool(): pg.Pool {
  if (dumpPool) return dumpPool;
  const connectionString = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new AppError('INTERNAL_ERROR', 'Yedek bağlantısı (DATABASE_MIGRATOR_URL) tanımlı değil');
  }
  dumpPool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  });
  dumpPool.on('error', (err) => {
    console.error('Backup dump pool hatası', err);
  });
  return dumpPool;
}

export class BackupService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;
  /** Süreç içi kuyruk: aynı anda birden fazla yedek üretilmez, hiçbir iş düşmez. */
  private pending = 0;
  private tail: Promise<unknown> = Promise.resolve();
  /** Süreç başına bir kez çalışan stale-run temizliği. */
  private swept = false;

  constructor(pool?: Pool) {
    this.providedPool = pool ?? null;
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  // === Okuma / durum ===

  async getSettings(): Promise<BackupSettingsRow> {
    const result = await this.getPoolInstance().query<BackupSettingsRow>(
      'SELECT * FROM backup_settings WHERE id = 1',
    );
    return result.rows[0];
  }

  async status(): Promise<BackupStatus> {
    await this.ensureSwept();
    const s = await this.getSettings();
    return {
      enabled: s.enabled,
      intervalMinutes: s.interval_minutes,
      retentionCount: s.retention_count,
      nextRunAt: s.next_run_at,
      lastRunAt: s.last_run_at,
      lastStatus: s.last_status,
      lastError: s.last_error,
      hasRunning: await this.hasRunningJob(),
      now: new Date(),
    };
  }

  async hasRunningJob(): Promise<boolean> {
    if (this.pending > 0) return true;
    const result = await this.getPoolInstance().query<{ n: string }>(
      "SELECT COUNT(*)::bigint AS n FROM backup_jobs WHERE status = 'running'",
    );
    return Number(result.rows[0]?.n ?? 0) > 0;
  }

  /**
   * Süreç başlangıcında bir kez: önceki çalıştırmadan kalan 'running' kayıtlarını
   * 'failed' olarak işaretler (süreç yeniden başlatıldığında askıda kalmaması için).
   */
  private async ensureSwept(): Promise<void> {
    if (this.swept) return;
    this.swept = true;
    try {
      const result = await this.getPoolInstance().query<BackupJobRow>(
        "SELECT * FROM backup_jobs WHERE status = 'running'",
      );
      for (const job of result.rows) {
        await this.getPoolInstance().query(
          `UPDATE backup_jobs SET status = 'failed', finished_at = now(), error = $2
            WHERE id = $1`,
          [job.id, 'Süreç yeniden başlatıldığı için tamamlanamadı.'],
        );
      }
      if (result.rows.length > 0) {
        await this.getPoolInstance().query(
          `UPDATE backup_settings
              SET last_status = 'failed',
                  last_error = 'Süreç yeniden başlatıldığı için bir yedek tamamlanamadı.',
                  updated_at = now()
            WHERE id = 1`,
        );
      }
    } catch {
      // Sweep en iyi çabadır; hata durumunda bir sonraki çağrı yine dener.
    }
  }

  async list(limit = 50): Promise<{ items: BackupJobRow[]; total: number; hasRunning: boolean }> {
    await this.ensureSwept();
    const safeLimit = Math.min(100, Math.max(1, limit));
    const [rows, total, hasRunning] = await Promise.all([
      this.getPoolInstance().query<BackupJobRow>(
        'SELECT * FROM backup_jobs ORDER BY started_at DESC LIMIT $1',
        [safeLimit],
      ),
      this.getPoolInstance().query<{ total: string }>(
        'SELECT COUNT(*)::bigint AS total FROM backup_jobs',
      ),
      this.hasRunningJob(),
    ]);
    return {
      items: rows.rows,
      total: Number(total.rows[0]?.total ?? 0),
      hasRunning,
    };
  }

  // === Ayarlar ===

  async updateSettings(input: UpdateBackupSettingsInput): Promise<BackupSettingsRow> {
    const current = await this.getSettings();
    const enabled = input.enabled ?? current.enabled;
    const intervalMinutes = input.intervalMinutes ?? current.interval_minutes;
    const retentionCount = input.retentionCount ?? current.retention_count;

    // Açıkken / sıklık değiştiğinde geri sayımı bugünden itibaren başlat.
    const nextRunAt = enabled ? new Date(Date.now() + intervalMinutes * 60_000) : null;

    await this.getPoolInstance().query(
      `UPDATE backup_settings
          SET enabled = $1,
              interval_minutes = $2,
              retention_count = $3,
              next_run_at = COALESCE($4, next_run_at),
              updated_at = now()
        WHERE id = 1`,
      [enabled, intervalMinutes, retentionCount, nextRunAt],
    );
    return this.getSettings();
  }

  // === Çalıştırma ===

  /**
   * Yeni bir yedek başlatır (manuel "Şimdi Yedekle"). Üretim arka planda
   * yürütülür; bu metot yalnızca `running` kaydını döndürür.
   */
  async runNow(
    createdBy?: string,
    logger?: LogLike,
  ): Promise<{ job: BackupJobRow; alreadyRunning: boolean }> {
    await this.ensureSwept();
    const running = await this.hasRunningJob();
    if (running) {
      const existing = await this.getPoolInstance().query<BackupJobRow>(
        "SELECT * FROM backup_jobs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1",
      );
      if (existing.rows[0]) {
        return { job: existing.rows[0], alreadyRunning: true };
      }
    }

    const id = newId();
    await this.getPoolInstance().query(
      `INSERT INTO backup_jobs (id, status, created_by, started_at, created_at)
       VALUES ($1, 'running', $2, now(), now())`,
      [id, createdBy ?? null],
    );

    // Fire-and-forget: HTTP yanıtını bekletmeden arka planda üret.
    void this.execute(id, logger).catch(() => undefined);

    const row = await this.getPoolInstance().query<BackupJobRow>(
      'SELECT * FROM backup_jobs WHERE id = $1',
      [id],
    );
    return { job: row.rows[0], alreadyRunning: false };
  }

  /**
   * Zamanlayıcı tick'i: ayar açıksa, çalışan yedek yoksa ve `next_run_at` geçtiyse
   * yedek başlatır. Geri sayım, başlatılır başlatılmaz bu andan itibaren işler.
   */
  async runScheduled(logger?: LogLike): Promise<'started' | 'skipped' | 'disabled'> {
    await this.ensureSwept();
    const settings = await this.getSettings();
    if (!settings.enabled) return 'disabled';
    if (await this.hasRunningJob()) return 'skipped';
    if (new Date(settings.next_run_at).getTime() > Date.now()) return 'skipped';

    await this.getPoolInstance().query(
      `UPDATE backup_settings
          SET next_run_at = now() + ($1 * interval '1 minute'), updated_at = now()
        WHERE id = 1`,
      [settings.interval_minutes],
    );

    const id = newId();
    await this.getPoolInstance().query(
      `INSERT INTO backup_jobs (id, status, created_by, started_at, created_at)
       VALUES ($1, 'running', NULL, now(), now())`,
      [id],
    );

    void this.execute(id, logger).catch(() => undefined);
    logger?.info?.({ backupId: id }, 'Zamanlanmış yedek başlatıldı');
    return 'started';
  }

  /**
   * Yedek üretimini sıraya alır. Aynı anda tek yedek üretilir; çakışan işler
   * düşmek yerine kuyrukta bekleyip sırayla tamamlanır (askıda kayıt kalmaz).
   */
  async execute(id: string, logger?: LogLike): Promise<void> {
    this.pending += 1;
    this.tail = this.tail
      .then(() => this.executeJob(id, logger))
      .catch(() => undefined)
      .finally(() => {
        this.pending -= 1;
      });
  }

  /** Tek bir yedeği üretir (kuyruk tarafından arka arkaya çağrılır). */
  private async executeJob(id: string, logger?: LogLike): Promise<void> {
    try {
      const buffer = await buildBackupBuffer(getDumpPool());

      await fs.mkdir(backupDir(), { recursive: true });
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const fileName = `backup-${stamp}-${id.slice(0, 8)}.sql.gz`;
      const filePath = path.join(backupDir(), fileName);
      await fs.writeFile(filePath, buffer);

      await this.getPoolInstance().query(
        `UPDATE backup_jobs
            SET status = 'success', finished_at = now(), size_bytes = $2, file_name = $3, error = NULL
          WHERE id = $1`,
        [id, buffer.length, fileName],
      );
      await this.markRun('success', null);
      await this.prune();
      logger?.info?.({ backupId: id, bytes: buffer.length }, 'Yedek alındı');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.getPoolInstance().query(
          `UPDATE backup_jobs
              SET status = 'failed', finished_at = now(), error = $2
            WHERE id = $1`,
          [id, message],
        );
        await this.markRun('failed', message);
      } catch (updateError) {
        logger?.error?.(
          { err: updateError },
          `Yedek hata kaydı güncellenemedi (orijinal hata: ${message})`,
        );
      }
      logger?.error?.({ backupId: id, err: message }, 'Yedek alınamadı');
    }
  }

  // === Dosya / silme ===

  async getFile(
    id: string,
  ): Promise<{ path: string; fileName: string; size: number | null } | null> {
    const result = await this.getPoolInstance().query<BackupJobRow>(
      'SELECT * FROM backup_jobs WHERE id = $1',
      [id],
    );
    const job = result.rows[0];
    if (!job?.file_name) return null;
    const filePath = path.join(backupDir(), job.file_name);
    try {
      await fs.access(filePath);
    } catch {
      return null;
    }
    return { path: filePath, fileName: job.file_name, size: job.size_bytes };
  }

  async remove(id: string): Promise<void> {
    const result = await this.getPoolInstance().query<BackupJobRow>(
      'SELECT * FROM backup_jobs WHERE id = $1',
      [id],
    );
    const job = result.rows[0];
    if (!job) throw new AppError('NOT_FOUND', 'Yedek kaydı bulunamadı');
    if (job.status === 'running') {
      throw new AppError('CONFLICT', 'Çalışan bir yedek silinemez');
    }
    if (job.file_name) {
      try {
        await fs.unlink(path.join(backupDir(), job.file_name));
      } catch {
        // Dosya zaten yok — kayıt yine de silinir.
      }
    }
    await this.getPoolInstance().query('DELETE FROM backup_jobs WHERE id = $1', [id]);
  }

  // === Yardımcılar ===

  private async markRun(status: BackupJobStatus, lastError: string | null): Promise<void> {
    await this.getPoolInstance().query(
      `UPDATE backup_settings
          SET last_run_at = now(), last_status = $1, last_error = $2, updated_at = now()
        WHERE id = 1`,
      [status, lastError],
    );
  }

  /** Saklama politikası: en yeni `retention_count` yedek dışındakileri (dosya + kayıt) siler. */
  private async prune(): Promise<void> {
    const settings = await this.getSettings();
    const result = await this.getPoolInstance().query<BackupJobRow>(
      `SELECT * FROM backup_jobs
        WHERE status = 'success' AND file_name IS NOT NULL
        ORDER BY started_at DESC
        OFFSET $1`,
      [settings.retention_count],
    );
    for (const job of result.rows) {
      if (job.file_name) {
        try {
          await fs.unlink(path.join(backupDir(), job.file_name));
        } catch {
          // Dosya yok — kayıt yine de temizlenir.
        }
      }
      await this.getPoolInstance().query('DELETE FROM backup_jobs WHERE id = $1', [job.id]);
    }
    if (result.rows.length > 0) {
      await this.getPoolInstance().query(
        'UPDATE backup_settings SET updated_at = now() WHERE id = 1',
      );
    }
  }
}

/** Süreç genelinde tek servis örneği (route'lar + zamanlayıcı paylaşır). */
let serviceInstance: BackupService | null = null;
export function getBackupService(): BackupService {
  if (!serviceInstance) serviceInstance = new BackupService();
  return serviceInstance;
}

