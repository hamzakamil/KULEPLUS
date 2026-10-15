import type { Request, Response, NextFunction } from 'express';
import { AppError } from '@kuleplus/shared';

/**
 * Süreç içi kayan pencere istek sınırlayıcı — ADR-0023.
 *
 * Neden gerekli? Kayıt ve sosyal giriş uçları kimlik doğrulamasızdır ve her
 * başarılı kayıt bir şirket (tenant) doğurur. Korumasız uç = bot ile toplu
 * tenant üretimi (ROADMAP "kayıt koruması: rate limit" açık maddesinin ilk adımı).
 *
 * Neden Redis değil? Sayaç tek süreç belleğinde; çok örnekli (dikey ölçekme)
 * dağıtım örnek başına `max` kadar izin verir. Bugünkü tek örnek deployment
 * için doğru maliyet/fayda; dağıtık limiter ROADMAP'te açık iş olarak durur.
 *
 * Bellek: her çağrıda süresi dolmuş anahtarlar süpürülür, böylece harita
 * pencere dolusu anahtarla sınırlı kalır (sınırsız büyümeyi engeller).
 */
export interface RateLimitOptions {
  /** Pencere genişliği (ms). */
  windowMs: number;
  /** Pencere başına azami istek (IP başına). */
  max: number;
  /** Sayaç adı — aynı IP, farklı uçta ayrı sayılır (örn. 'auth.register'). */
  key: string;
  /** Zaman kaynağı (testlerde saatlenebilmesi için enjekte edilir). */
  now?: () => number;
}

type Bucket = { count: number; resetAt: number };

export function rateLimit({ windowMs, max, key, now = () => Date.now() }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const timestamp = now();

    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= timestamp) buckets.delete(bucketKey);
    }

    const bucketKey = `${key}:${req.ip ?? 'bilinmeyen-ip'}`;
    const bucket = buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= timestamp) {
      buckets.set(bucketKey, { count: 1, resetAt: timestamp + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));
      // İstemci (ve proxy'ler) için standart alan — SPEC §22 hata sözleşmesini bozmaz.
      res.setHeader('Retry-After', String(retryAfterSeconds));
      next(
        new AppError(
          'RATE_LIMITED',
          `Çok fazla deneme yapıldı. Lütfen ${retryAfterSeconds} saniye sonra tekrar deneyin.`,
        ),
      );
      return;
    }

    next();
  };
}
