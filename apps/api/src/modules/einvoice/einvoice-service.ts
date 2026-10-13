/** Faz 4 — e-Dönüşüm (einvoice) servisi.
 * Outbox pattern: her e-Dönüşüm olayı önce `outbox` tablosuna yazılır, worker işler.
 * Mock provider development için, gerçek sağlayıcı ADR ile değiştirilir (SPEC §21.1).
 */

import { newId, AppError } from '@kuleplus/shared';
import { getPool } from '@kuleplus/db';
import type { EInvoiceProvider, InboxInvoice } from './einvoice-port.js';
import type { EInvoiceDocument, OutboxRecord } from './einvoice-types.js';

/** Mock EDocumentPort — development; gerçek sağlayıcı bu arayüzü implement eder (SPEC §29.1 Liskov). */
export class MockEInvoiceProvider implements EInvoiceProvider {
  async sendInvoice(invoiceId: string): Promise<{
    success: boolean;
    external_invoice_id?: string;
    message?: string;
    provider_response?: string;
  }> {
    // Sandbox: fatura numarası üretir, durumu kaydeder.
    const externalId = `MOCK-${invoiceId.slice(0, 8)}`;
    return {
      success: true,
      external_invoice_id: externalId,
      message: 'Gönderim başarılı (mock)',
      provider_response: JSON.stringify({
        invoiceId,
        externalId,
        sentAt: new Date().toISOString(),
      }),
    };
  }

  async queryStatus(_invoiceId: string): Promise<{
    status: string;
    provider_response?: string;
    last_status_at?: Date;
  }> {
    return { status: 'sent', last_status_at: new Date() };
  }

  async cancelInvoice(_invoiceId: string): Promise<{ success: boolean; message?: string }> {
    return { success: true, message: 'İptal edildi (mock)' };
  }

  async listInbox(_limit = 50, _offset = 0): Promise<InboxInvoice[]> {
    return [];
  }

  async downloadDocument(_invoiceId: string): Promise<{ pdf?: Buffer; xml?: Buffer }> {
    return { xml: Buffer.from('mock-xml-placeholder') };
  }
}

export class EInvoiceService {
  private provider: EInvoiceProvider;

  constructor(provider?: EInvoiceProvider) {
    this.provider = provider ?? new MockEInvoiceProvider();
  }

  /** Outbox'a gönderim kuyruğuna ekle (transaction-safe). */
  async enqueueSend(tenantId: string, sourceType: string, sourceId: string): Promise<string> {
    const pool = getPool('app');
    const outboxId = newId();
    await pool.query(
      `INSERT INTO einvoice_outbox (id, tenant_id, entity_type, entity_id, event_type, payload, status, attempts, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        outboxId,
        tenantId,
        'einvoice',
        sourceId,
        'send',
        JSON.stringify({ sourceType }),
        'pending',
        0,
        3,
      ],
    );
    return outboxId;
  }

  /** Outbox kayıtlarını alıp işleme vermek için (worker tarafı). */
  async getPendingOutbox(limit = 100): Promise<OutboxRecord[]> {
    const pool = getPool('app');
    const res = await pool.query<{
      id: string;
      tenant_id: string;
      entity_type: 'einvoice';
      entity_id: string;
      event_type: 'send' | 'status' | 'cancel';
      payload: string;
      status: 'pending' | 'sent' | 'failed';
      attempts: number;
      max_attempts: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, tenant_id, entity_type, entity_id, event_type, payload,
              status, attempts, max_attempts, created_at, updated_at
        FROM einvoice_outbox
       WHERE status = 'pending' AND attempts < max_attempts
       ORDER BY created_at ASC LIMIT $1`,
      [limit],
    );
    return res.rows;
  }

  /** İşlem sonucunu outbox durumunda kaydet. */
  async markOutboxSent(outboxId: string, providerResponse: string): Promise<void> {
    const pool = getPool('app');
    await pool.query(
      `UPDATE einvoice_outbox SET status = 'sent', provider_response = $2, delivered_at = now(), attempts = attempts + 1
       WHERE id = $1`,
      [outboxId, providerResponse],
    );
  }

  /** Belge kaydı oluştur. */
  async createDocument(
    tenantId: string,
    opts: {
      sourceType: string;
      sourceId: string;
      documentType: string;
      status: string;
      xmlPayload?: string;
      externalId?: string;
    },
  ): Promise<string> {
    const pool = getPool('app');
    const docId = newId();
    await pool.query(
      `INSERT INTO einvoice_documents (id, tenant_id, source_type, source_id, document_type, status, xml_payload, external_invoice_id, attempts, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        docId,
        tenantId,
        opts.sourceType,
        opts.sourceId,
        opts.documentType,
        opts.status,
        opts.xmlPayload ?? null,
        opts.externalId ?? null,
        0,
        3,
      ],
    );
    return docId;
  }

  /** Durumu kaydet (status_events). */
  async recordStatus(documentId: string, status: string, providerResponse: string): Promise<void> {
    const pool = getPool('app');
    await pool.query(
      `INSERT INTO einvoice_status_events (id, document_id, status, provider_response)
       VALUES ($1, $2, $3, $4)`,
      [newId(), documentId, status, providerResponse],
    );
  }

  /** Belge getir. */
  async getDocument(tenantId: string, documentId: string): Promise<EInvoiceDocument | null> {
    const pool = getPool('app');
    const res = await pool.query(
      `SELECT * FROM einvoice_documents WHERE id = $1 AND tenant_id = $2`,
      [documentId, tenantId],
    );
    return res.rows[0] ?? null;
  }

  /** Gelen kutusu: provider'dan çekilip saklanan faturaları listeler (sayfalı). */
  async listInbox(
    tenantId: string,
    query: { direction?: 'incoming' | 'outgoing'; page?: number; limit?: number } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const pool = getPool('app');
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const offset = ((query.page ?? 1) - 1) * limit;
    const params: Array<string | number> = [tenantId];
    let where = 'tenant_id = $1';
    if (query.direction) {
      params.push(query.direction);
      where += ` AND direction = $${params.length}`;
    }
    params.push(limit, offset);
    const res = await pool.query(
      `SELECT id, external_invoice_id, direction, document_type, title, received_at, payload
         FROM einvoice_inbox
        WHERE ${where}
        ORDER BY received_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.rows;
  }

  /** Provider'dan gelen faturayı sakla — idempotent (UNIQUE external_invoice_id+direction). */
  async storeInbox(tenantId: string, item: InboxInvoice): Promise<void> {
    const pool = getPool('app');
    await pool.query(
      `INSERT INTO einvoice_inbox (id, tenant_id, external_invoice_id, direction, document_type, title, received_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (external_invoice_id, direction) DO UPDATE SET
         title = EXCLUDED.title,
         payload = EXCLUDED.payload,
         received_at = EXCLUDED.received_at`,
      [
        newId(),
        tenantId,
        item.external_invoice_id,
        item.direction,
        item.document_type,
        item.title ?? null,
        item.received_at,
        item.payload ?? null,
      ],
    );
  }

  /** Gelen kutusunu provider'dan tazele (on-demand pull). */
  async syncInbox(tenantId: string): Promise<{ inserted: number; syncedAt: string }> {
    const items = await this.provider.listInbox(50, 0);
    for (const item of items) {
      await this.storeInbox(tenantId, item);
    }
    return { inserted: items.length, syncedAt: new Date().toISOString() };
  }

  /** Belge içeriğini indir (XML/PDF). Saklanan payload önceliklidir; yoksa provider'dan çekilir (SPEC §21). */
  async downloadDocument(
    tenantId: string,
    documentId: string,
    format: 'xml' | 'pdf',
  ): Promise<{ filename: string; contentType: string; data: Buffer }> {
    const doc = await this.getDocument(tenantId, documentId);
    if (!doc) {
      throw new AppError('NOT_FOUND', 'e-Dönüşüm belgesi bulunamadı');
    }
    if (format === 'pdf') {
      const dl = await this.provider.downloadDocument(doc.id);
      if (dl.pdf) {
        return { filename: `einvoice-${doc.id}.pdf`, contentType: 'application/pdf', data: dl.pdf };
      }
      throw new AppError('NOT_FOUND', 'PDF içeriği bulunamadı');
    }
    // XML: önce saklanan payload, yoksa provider xml'i.
    if (doc.xml_payload) {
      return {
        filename: `einvoice-${doc.id}.xml`,
        contentType: 'application/xml',
        data: Buffer.from(doc.xml_payload, 'utf8'),
      };
    }
    const dl = await this.provider.downloadDocument(doc.id);
    if (dl.xml) {
      return { filename: `einvoice-${doc.id}.xml`, contentType: 'application/xml', data: dl.xml };
    }
    throw new AppError('NOT_FOUND', 'XML içeriği bulunamadı');
  }

  /** İptal: sağlayıcıya bildirilir (varsa), yerel durum güncellenir, olay kaydedilir. */
  async cancelDocument(
    tenantId: string,
    documentId: string,
    reason: string,
  ): Promise<{ success: boolean; provider_response?: string }> {
    const doc = await this.getDocument(tenantId, documentId);
    if (!doc) {
      throw new AppError('NOT_FOUND', 'e-Dönüşüm belgesi bulunamadı');
    }
    let providerResponse: string | undefined;
    if (doc.external_invoice_id) {
      const result = await this.provider.cancelInvoice(doc.id);
      providerResponse = JSON.stringify(result);
      if (!result.success) {
        // Sağlayıcı iptali onaylamadı — yerel duruma dokunulmaz.
        throw new AppError('EXTERNAL_SERVICE_ERROR', 'Sağlayıcı iptali onaylamadı');
      }
    }
    const pool = getPool('app');
    await pool.query(
      `UPDATE einvoice_documents SET status = 'cancelled', updated_at = now() WHERE id = $1`,
      [doc.id],
    );
    await this.recordStatus(
      doc.id,
      'cancelled',
      JSON.stringify({ reason, provider: providerResponse ?? null }),
    );
    return { success: true, provider_response: providerResponse };
  }
}
