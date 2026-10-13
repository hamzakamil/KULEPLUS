/** Faz 4 — e-Dönüşüm entegrasyonu (SPEC §21).
 * EDocumentPort arayüzü ve Outbox/Inbox pattern.
 * Kaynak: docs/api/permissions-catalog.md, docs/product/screens.md
 */

export type InvoiceStatus = 'draft' | 'sent' | 'delivered' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

export type DocumentType = 'invoice' | 'credit_note' | 'debit_note' | 'delivery_note' | 'original_evrak' | 'evrak_eni';

export interface EInvoiceDocument {
  id: string;
  tenant_id: string;
  source_type: 'sales_quote' | 'sales_order' | 'purchase_order' | 'delivery' | 'invoice' | 'manual';
  source_id: string;
  document_type: DocumentType;
  status: InvoiceStatus;
  xml_payload?: string;
  pdf_path?: string;
  provider_response?: string;
  external_invoice_id?: string;
  attempts: number;
  max_attempts: number;
  last_attempt_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface OutboxRecord {
  id: string;
  tenant_id: string;
  entity_type: 'einvoice';
  entity_id: string;
  event_type: 'send' | 'status' | 'cancel';
  payload: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  max_attempts: number;
  delivered_at?: Date;
  created_at: Date;
  updated_at: Date;
}