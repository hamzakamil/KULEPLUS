import type { Logger } from 'pino';
import { getBackupService } from './service.js';

export interface BackupSchedulerHandle {
  stop: () => void;
}

/**
 * Otomatik yedek zamanlayıcısı.
 *
 * Her `tickMs`'te ayarları kontrol eder; yedekleme açıksa, çalışan yedek yoksa
 * ve `next_run_at` geçtiyse yeni bir yedek başlatır. Sayaç (`next_run_at`)
 * DB'de tutulur → süreç yeniden başlasa bile geri sayım korunur.
 *
 * Herhangi bir sistemik bağımlılığı (Redis/BullMQ) yoktur — API süreci içinde
 * çalışır; tek API örneği olan geliştirme ortamı için yeterli ve basittir.
 */
export function startBackupScheduler(logger: Logger, tickMs = 30_000): BackupSchedulerHandle {
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await getBackupService().runScheduled(logger);
    } catch (error) {
      logger.error({ err: error }, 'Yedek zamanlayıcı hatası');
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, tickMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
