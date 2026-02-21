import app from './app';
import { config } from './config';
import { connectDatabase } from './config/database';
import { logger } from './utils/logger';

async function startServer(): Promise<void> {
  try {
    // Veritabanı bağlantısı
    await connectDatabase();
    logger.info(`Veritabanı bağlantısı kuruldu (${config.dbType})`);

    // Sunucuyu başlat
    app.listen(config.port, () => {
      logger.info(`
╔══════════════════════════════════════════════════╗
║        TDHP Muhasebe Sistemi API v0.1.0          ║
╠══════════════════════════════════════════════════╣
║  Sunucu:    http://localhost:${config.port}              ║
║  API Docs:  http://localhost:${config.port}/api-docs     ║
║  DB:        ${config.dbType.padEnd(37)}║
║  Ortam:     ${config.nodeEnv.padEnd(37)}║
╚══════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    logger.error('Sunucu başlatılamadı:', error);
    process.exit(1);
  }
}

startServer();
