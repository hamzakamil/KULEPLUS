/** Faz 4 — EDocumentPort arayüzü (SPEC §21.1).
 * Mock ve gerçek sağlayıcılar aynı sözleşmeyi sağlar.
 * Her metot idempotent: send(invoice.id) ikinci kez çağırılırsa önceki sonucu döner.
 */

export interface EInvoiceProvider {
  /** Fatura gönderimi. Idempotent — aynı invoice.id ikinci kez çağırılırsa önceki sonucu döner. */
  sendInvoice(invoiceId: string, payload: unknown): Promise<InvoiceSendResult>;

  /** Durum sorgulama (önbellekli). */
  queryStatus(invoiceId: string): Promise<InvoiceStatusResult>;

  /** Fatura iptal/iade. */
  cancelInvoice(invoiceId: string): Promise<CancelResult>;

  /** Gelen kutusu: provider'dan gelen faturalar. */
  listInbox(limit?: number, offset?: number): Promise<InboxInvoice[]>;

  /** PDF/XML indirme. */
  downloadDocument(invoiceId: string): Promise<{ pdf?: Buffer; xml?: Buffer }>;
}

export interface InvoiceSendResult {
  success: boolean;
  external_invoice_id?: string;
  message?: string;
  status?: string;
  provider_response?: string;
}

export interface InvoiceStatusResult {
  status: string;
  provider_response?: string;
  last_status_at?: Date;
}

export interface CancelResult {
  success: boolean;
  message?: string;
}

export interface InboxInvoice {
  id: string;
  external_invoice_id: string;
  direction: 'incoming' | 'outgoing';
  document_type: string;
  title: string;
  received_at: Date;
  payload: string;
}

export type InvoiceStatus =
  'draft' | 'sent' | 'delivered' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
