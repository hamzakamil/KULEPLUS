import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { TenantRequest } from './tenant.js';

/**
 * `Idempotency-Key` zorunluluğu (SPEC §22.2) — finansal kesinleştirme uçları için.
 *
 * Kayıt, İSTEK TRANSACTION'ı (tenant scope, RLS) içinde yazılır:
 *  - Başarılı istek → COMMIT → aynı key ile ikinci istek **409** ile reddedilir.
 *  - Başarısız istek → ROLLBACK → kayıt silinir, yeniden denemeye izin verilir.
 *
 * Sıralama: `tenantContext`ten SONRA çalışmalıdır (req.tenantId hazır olur).
 */
export function idempotency() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.headers['idempotency-key'];
      const key = Array.isArray(header) ? header[0] : header;
      if (!key || key.length < 8 || key.length > 200) {
        next(new AppError('VALIDATION_ERROR', 'Idempotency-Key başlığı zorunludur (8-200 karakter).'));
        return;
      }

      const tenantId = (req as TenantRequest).tenantId;
      if (!tenantId) {
        next(new AppError('UNAUTHENTICATED', 'Tenant bağlamı gerekli.'));
        return;
      }

      const requestHash = createHash('sha256')
        .update(JSON.stringify(req.body ?? {}))
        .digest('hex');

      try {
        await getPool('app').query(
          `INSERT INTO idempotency_keys (id, tenant_id, idempotency_key, method, path, request_hash)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId(), tenantId, key, req.method, req.path, requestHash],
        );
      } catch (err) {
        // 23505 = unique_violation → aynı (tenant, key) daha önce işlendi.
        if ((err as { code?: string }).code === '23505') {
          next(new AppError('IDEMPOTENCY_KEY_CONFLICT', 'Bu istek daha önce işlendi.'));
          return;
        }
        throw err;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
