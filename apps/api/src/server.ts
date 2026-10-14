import 'dotenv/config';
import pino from 'pino';
import { loadEnv } from './config/env';
import { createApp } from './app';
import { startBackupScheduler } from './modules/backup/scheduler';

/** ORTAM doğrulanır; başarısızsa başlamaz (Faz 0: env.ts + Zod). */
let env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
    : {}),
  // Gizli veri maskeleme — SPEC §27.4
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.secret', '*.token'],
    censor: '[MASKED]',
  },
});

const app = createApp({ env, logger });

// ---- Savunma hattı: süreç çöküşlerini engelle ----
// Express 4, asenkron middleware/handler redlerini yakalamaz; tek bir
// `throw` (ör. auth middleware'i) yakalanmamış rejection ile TÜM API'yi
// öldürür ve tüm sayfalar `ERR_CONNECTION_REFUSED` görür. Hataları logla,
// süreci ayakta tut; asıl hata kaynakları `next(error)` ile düzeltilir.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Yakalanmamış promise reddi — süreç korunuyor');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Yakalanmamış istisna — süreç korunuyor');
});

const server = app.listen(env.PORT, () => {
  logger.info(`API hazır: http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Otomatik yedek zamanlayıcısı — ayarlanan sıklıkta DB yedeği alır (bkz. backup modülü).
const backupScheduler = startBackupScheduler(logger);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} alındı, kapanıyor…`);
    backupScheduler.stop();
    server.close(() => process.exit(0));
  });
}
