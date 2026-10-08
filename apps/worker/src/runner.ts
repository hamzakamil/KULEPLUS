import 'dotenv/config';
import pino from 'pino';
import { QUEUE_NAMES, startWorker } from './index';

const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
    : {}),
});

const { queues, close } = await startWorker({
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  logger,
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
