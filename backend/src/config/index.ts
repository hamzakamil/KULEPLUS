import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Veritabanı seçimi: 'mongodb' veya 'postgresql'
  dbType: (process.env.DB_TYPE || 'mongodb') as 'mongodb' | 'postgresql',

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/muhasebe',
  },

  postgresql: {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: process.env.PG_DATABASE || 'muhasebe',
    username: process.env.PG_USERNAME || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'tdhp-muhasebe-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  // Varsayılan para birimi
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'TRY',

  // Log seviyesi
  logLevel: process.env.LOG_LEVEL || 'info',
};
