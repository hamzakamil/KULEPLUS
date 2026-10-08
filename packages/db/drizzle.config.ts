import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_MIGRATOR_URL ||
      'postgresql://app_migrator:CHANGE_ME@localhost:5434/erp_db',
  },
  strict: true,
  breakpoints: true,
});
