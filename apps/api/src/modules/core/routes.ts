import { Router, type Response, type NextFunction } from 'express';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { DataExportService } from './export.service.js';

/**
 * `core` modülü rotaları (GOVERNANCE §2: `modules/core/`, permission `core.*`).
 * Şu an yalnızca KVKK veri taşınabilirliği ucu var (SPEC §23.2).
 */
const router = Router();
const exportService = new DataExportService();

router.use(authenticate, tenantContext);

/**
 * Tam veri dışa aktarması (ZIP: manifest + data/*.csv + README.txt) — SPEC §23.2.
 * Yönetici izni ister: tüm şirket verisini dışarı taşıyan bir uçtir.
 */
router.get(
  '/exports/full',
  requirePermission('core.settings.read'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant context yok');

      const tenantResult = await getPool('app').query<{ name: string }>(
        `SELECT name FROM tenants WHERE id = $1`,
        [tenantId],
      );
      const tenantName = tenantResult.rows[0]?.name ?? 'Şirket';

      const file = await exportService.exportFull(tenantId, tenantName);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.setHeader('X-Export-Datasets', String(file.datasetCount));
      res.setHeader('X-Export-Rows', String(file.rowCount));
      res.send(file.body);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
