import { z } from 'zod';

/**
 * Ortam doğrulaması — Faz 0 (README §13):
 * "env.ts (Zod ile doğrulama; eksikse uygulama başlamaz)."
 * Kaynak: kök .env.example (README §12.3).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL zorunlu'),
  REDIS_URL: z.string().min(1, 'REDIS_URL zorunlu'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET en az 32 karakter olmalı'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET en az 32 karakter olmalı'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Ortamı doğrular; başarısızlıkta hata fırlatır — çağıran taraf (server.ts)
 * loglayıp süreçten çıkarır ("eksikse uygulama başlamaz").
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(kök)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Ortam değişkenleri geçersiz:\n${details}`);
  }
  return parsed.data;
}
