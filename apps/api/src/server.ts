import 'dotenv/config';
import pino from 'pino';
import { loadEnv } from './config/env';
import { createApp } from './app';

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

const server = app.listen(env.PORT, () => {
  logger.info(`API hazır: http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} alındı, kapanıyor…`);
    server.close(() => process.exit(0));
  });
}
