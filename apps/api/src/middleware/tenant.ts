import type { NextFunction, Request, Response } from 'express';
import { getPool, beginTenantScope, runWithTenantScope } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { AuthenticatedRequest } from './auth.js';

export interface TenantRequest extends AuthenticatedRequest {
  tenantId: string;
}

/**
 * Tenant bağlamı — SPEC §7.1.
 *
 * JWT'deki doğrulanmış tenantId'nin gerçekten bu kullanıcıya ait bir üyelik
 * olduğunu doğrular (`tenant_users`) ve `req.tenantId`'yi kurar.
 *
 * Neden açık kontrol? RLS tek başına üyeliği kanıtlamaz — core tablolarında
 * (`tenant_users`, `tenants`) RLS yoktur ve Cari/Stok servisleri `withTenant()`
 * ile GUC kurar; ancak GUC değeri JWT'den gelir. JWT imzalı olsa bile kullanıcı
 * tenant'tan çıkarılmış olabilir; bu yüzden her istekte üyelik doğrulanır
 * (SPEC §7.1: "$1 doğrulanmış üyelikten gelmeli").
 *
 * Bağlam taşıma: istek başına ayrılmış bağlantı + transaction + AsyncLocalStorage.
 * `TenantAwarePool`, kapsam içindeki TÜM `pool.query` çağrılarını aynı bağlantıya
 * yönlendirir — aksi halde pool'un farklı bağlantısına düşen sorgu
 * `current_tenant_id()`'yi null görür (yüksek trafikte veri sızıntısı/boş liste).
 * Yanıt kapanınca COMMIT (2xx/3xx) veya ROLLBACK yapılır, bağlantı iade edilir.
 *
 * Sıralama: `authenticate`ten SONRA, `requireEntitlement`/`requirePermission`
 * ÖNCESİ çalışmalıdır.
 */
export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenantId = user?.tenantId;
      if (!tenantId || !user?.sub) {
        next(new AppError('UNAUTHENTICATED', 'Tenant context yok'));
        return;
      }

      // Üyelik doğrulama — JWT imzalı olsa bile kullanıcı tenant'tan çıkarılmış
      // olabilir; RLS tek başına üyeliği kanıtlamaz (SPEC §7.1: "$1 doğrulanmış
      // üyelikten gelmeli"). Core tablolarında RLS yok, bu yüzden açık kontrol şart.
      const membership = await getPool('app').query(
        'SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 LIMIT 1',
        [tenantId, user.sub],
      );
      if ((membership.rowCount ?? 0) === 0) {
        next(new AppError('TENANT_FORBIDDEN', 'Bu tenant ile üyeliğiniz yok'));
        return;
      }

      // İstek-scoped transaction + GUC; zincirin tamamı bu kapsamda çalışır
      const { scope, finish } = await beginTenantScope(getPool('app'), tenantId);

      let settled = false;
      const settle = (commit: boolean) => {
        if (settled) return;
        settled = true;
        void finish(commit).catch((error) => {
          const log = (req as { log?: { error: (o: unknown, m: string) => void } }).log;
          if (log) log.error({ err: error }, 'Tenant kapsamı kapatılamadı');
          else console.error('Tenant kapsamı kapatılamadı', error);
        });
      };
      // Yanıt gövdesi + hata middleware'i `close`'tan önce çalışır, statusCode hazırdır
      res.on('close', () => settle(res.statusCode < 400));

      (req as TenantRequest).tenantId = tenantId;
      runWithTenantScope(scope, () => next());
    } catch (error) {
      next(error);
    }
  })();
}
