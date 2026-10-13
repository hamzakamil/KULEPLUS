/** Faz 4 — e-Dönüşüm (einvoice) rotaları (SPEC §21).
 * Module code: `einvoice` (GOVERNANCE §2). Tüm uçlar auth + tenant + einvoice entitlement ister.
 * RBAC: belge okuma/send/cancel için `einvoice.document.*` izni gerekir; owner otomatik geçer (SPEC §6.6).
 */

import { Router, type Response, type NextFunction } from 'express';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth.js';
import { tenantContext, type TenantRequest } from '../../middleware/tenant.js';
import { requireEntitlement } from '../../middleware/require-entitlement.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { EInvoiceService } from './einvoice-service.js';
import {
  einvoiceSendSchema,
  einvoiceStatusQuerySchema,
  einvoiceCancelSchema,
  einvoiceDownloadQuerySchema,
  einvoiceInboxQuerySchema,
} from './einvoice-schemas.js';

export const einvoiceRoutes = Router();
const service = new EInvoiceService();

/** Tüm e-Dönüşüm uçları: kimlik + tenant + entitlement zinciri (SPEC §5.1/§8.5). */
einvoiceRoutes.use(authenticate, tenantContext, requireEntitlement('einvoice'));

// RBAC kapıları (SPEC §6.3) — `einvoice.document.*` izinleri katalogdadır.
const canDocRead = requirePermission('einvoice.document.read');
const canDocSend = requirePermission('einvoice.document.send');
const canDocCancel = requirePermission('einvoice.document.cancel');
/**
 * Fatura gönder (outbox). Belge önce outbox'a kuyruklanır; worker asenkron gönderir (SPEC §21.2).
 * Idempotent: aynı `sourceId` için bekleyen bir outbox kaydı varsa yeniden kuyruklanmaz.
 */
einvoiceRoutes.post(
  '/send',
  canDocSend,
  validate(einvoiceSendSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as TenantRequest).tenantId;
      const { sourceType, sourceId } = req.body as { sourceType: string; sourceId: string };

      // Idempotens: bekleyen aynı kaynak için outbox kaydı var mı?
      const existing = await getPool('app').query(
        `SELECT id FROM einvoice_outbox
          WHERE tenant_id = $1 AND entity_type = 'einvoice' AND entity_id = $2 AND status = 'pending'
          LIMIT 1`,
        [tenantId, sourceId],
      );
      if (existing.rows.length > 0) {
        res.status(200).json({ message: 'Gönderim zaten kuyrukta', outboxId: existing.rows[0].id });
        return;
      }

      const docId = await service.createDocument(tenantId, {
        sourceType,
        sourceId,
        documentType: sourceType,
        status: 'draft',
      });

      const outboxId = await service.enqueueSend(tenantId, sourceType, docId);

      res.status(201).json({
        message: 'e-Dönüşüm belgesi oluşturuldu, gönderim kuyruğa alındı',
        documentId: docId,
        outboxId,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Belge listesi (durum filtresi + sayfalama). */
einvoiceRoutes.get(
  '/',
  canDocRead,
  validate(einvoiceStatusQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as TenantRequest).tenantId;
      const { status, page, limit } = req.query as Record<string, string>;

      const result = await getPool('app').query(
        `SELECT id, source_type, source_id, document_type, status,
                xml_payload, external_invoice_id, attempts, max_attempts, created_at, updated_at
           FROM einvoice_documents
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR status = $2)
          ORDER BY created_at DESC
          LIMIT $3 OFFSET $4`,
        [
          tenantId,
          status ?? null,
          Number(limit) || 20,
          ((Number(page) || 1) - 1) * (Number(limit) || 20),
        ],
      );

      res.json({ items: result.rows });
    } catch (error) {
      next(error);
    }
  },
);

/** Gelen kutusu (sayfalı, yön filtresiyle) — provider'dan çekilip saklanan faturalar. */
einvoiceRoutes.get(
  '/inbox',
  canDocRead,
  validate(einvoiceInboxQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as TenantRequest).tenantId;
      const { direction, page, limit } = req.query as Record<string, string>;
      const items = await service.listInbox(tenantId, {
        direction: (direction as 'incoming' | 'outgoing' | undefined) ?? undefined,
        page: Number(page) || 1,
        limit: Number(limit) || 20,
      });
      res.json({ items });
    } catch (error) {
      next(error);
    }
  },
);

/** Gelen kutusunu sağlayıcıdan tazele (on-demand pull; idempotent upsert). */
einvoiceRoutes.post(
  '/inbox/sync',
  canDocRead,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as TenantRequest).tenantId;
      const result = await service.syncInbox(tenantId);
      res.json({ message: 'Gelen kutusu tazelendi', ...result });
    } catch (error) {
      next(error);
    }
  },
);

/** Belge detayı. */
einvoiceRoutes.get(
  '/:id',
  canDocRead,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as TenantRequest).tenantId;
      const doc = await service.getDocument(tenantId, req.params.id);
      if (!doc) {
        throw new AppError('NOT_FOUND', 'e-Dönüşüm belgesi bulunamadı');
      }
      res.json(doc);
    } catch (error) {
      next(error);
    }
  },
);

/** Durum sorgulama (provider üzerinden, önbellekli). */
einvoiceRoutes.get(
  '/:id/status',
  canDocRead,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as TenantRequest).tenantId;
      const doc = await service.getDocument(tenantId, req.params.id);
      if (!doc) {
        throw new AppError('NOT_FOUND', 'e-Dönüşüm belgesi bulunamadı');
      }
      const events = await getPool('app').query(
        `SELECT status, provider_response, created_at
           FROM einvoice_status_events
          WHERE document_id = $1
          ORDER BY created_at DESC`,
        [doc.id],
      );
      res.json({ documentId: doc.id, status: doc.status, events: events.rows });
    } catch (error) {
      next(error);
    }
  },
);

/** PDF/XML indirme — saklanan payload öncelikli, yoksa provider'dan çekilir (SPEC §21). */
einvoiceRoutes.get(
  '/:id/download',
  canDocRead,
  validate(einvoiceDownloadQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as TenantRequest).tenantId;
      const { format } = req.query as { format?: 'xml' | 'pdf' };
      const file = await service.downloadDocument(tenantId, req.params.id, format ?? 'xml');
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.data);
    } catch (error) {
      next(error);
    }
  },
);

/** Belge iptali — sağlayıcıya bildirilir (varsa), yerel durum güncellenir. */
einvoiceRoutes.post(
  '/:id/cancel',
  canDocCancel,
  validate(einvoiceCancelSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as TenantRequest).tenantId;
      const { reason } = req.body as { reason: string };
      const result = await service.cancelDocument(tenantId, req.params.id, reason);
      res.json({ message: 'Belge iptal edildi', documentId: req.params.id, ...result });
    } catch (error) {
      next(error);
    }
  },
);

export default einvoiceRoutes;
