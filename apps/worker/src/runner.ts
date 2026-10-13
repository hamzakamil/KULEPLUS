import 'dotenv/config';
import pino from 'pino';
import { QUEUE_NAMES, startWorker } from './index';
import { createEInvoiceMockProvider, createWebPushMockProvider, createWebPushProvider } from './handlers';

const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
    : {}),
});

/**
 * Web Push sağlayıcısını ortamdan seçer: VAPID anahtarları varsa gerçek `web-push`,
 * yoksa log mock'u (boru hattı dev'de de çalışır, gerçek gönderim yapmaz).
 */
function createWorkerPushProvider(logger: pino.Logger) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:destek@kuleplus.local';
  if (publicKey && privateKey) {
    logger.info('Web Push: VAPID anahtarları bulundu — gerçek gönderim etkin.');
    return createWebPushProvider({ publicKey, privateKey, subject });
  }
  logger.warn('Web Push: VAPID anahtarları yok — log mock sağlayıcısı kullanılıyor (dev).');
  return createWebPushMockProvider(logger);
}

const { queues, close } = await startWorker({
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  logger,
  // e-Dönüşüm sağlayıcısı: dev'de idempotent mock (SPEC §29.1). Gerçek GİB entegratörü
  // (K-07 kararı sonrası) aynı `WorkerEInvoicePort` arayüzünü implement eder → buradan değişir.
  // Web Push: VAPID anahtarları tanımlıysa gerçek gönderim, değilse log mock'u (dev).
  // E-posta/outbox bağımlılıkları verilmediği için ilgili handler'lar kurulmaz (iskelet kalır).
  handlers: {
    logger,
    einvoice: createEInvoiceMockProvider(),
    push: createWorkerPushProvider(logger),
  },
});

logger.info(`Kuyruklar: ${Object.values(QUEUE_NAMES).join(', ')}`);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} alındı, kapanıyor…`);
    close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

export { queues };
