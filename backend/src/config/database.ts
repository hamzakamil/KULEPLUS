import mongoose from 'mongoose';
import { Sequelize } from 'sequelize';
import { config } from './index';
import { logger } from '../utils/logger';

// MongoDB bağlantısı
export async function connectMongoDB(): Promise<void> {
  try {
    await mongoose.connect(config.mongodb.uri);
    logger.info('MongoDB bağlantısı başarılı');
  } catch (error) {
    logger.error('MongoDB bağlantı hatası:', error);
    throw error;
  }
}

// PostgreSQL bağlantısı
export const sequelize = new Sequelize(
  config.postgresql.database,
  config.postgresql.username,
  config.postgresql.password,
  {
    host: config.postgresql.host,
    port: config.postgresql.port,
    dialect: 'postgres',
    logging: config.nodeEnv === 'development' ? (msg) => logger.debug(msg) : false,
  }
);

export async function connectPostgreSQL(): Promise<void> {
  try {
    await sequelize.authenticate();
    logger.info('PostgreSQL bağlantısı başarılı');
  } catch (error) {
    logger.error('PostgreSQL bağlantı hatası:', error);
    throw error;
  }
}

// Aktif veritabanına bağlan
export async function connectDatabase(): Promise<void> {
  if (config.dbType === 'mongodb') {
    await connectMongoDB();
  } else {
    await connectPostgreSQL();
  }
}
