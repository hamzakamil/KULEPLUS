/** Para miktarı — NUMERIC(20,8) sözleşmesi için her zaman string (packages/shared/money). */
export type MoneyString = string;

/** e-Fatura durumları (GİB/ekosistem ortak diline indirgenmiş). */
export type EDocumentStatus = 'pending' | 'sent' | 'accepted' | 'rejected' | 'cancelled' | 'error';

/** Fatura özeti — provider'a giden minimum sözleşme (PII içermez, ayrıntı Faz 4'te). */
export interface InvoiceSnapshot {
  id: string;
  tenantId: string;
  series: string;
  number: string;
  issueDate: string; // ISO tarih
  currency: string; // ISO 4217
  totalAmount: MoneyString;
  taxAmount: MoneyString;
}

export interface SendResult {
  providerRef: string;
  status: EDocumentStatus;
}

export interface StatusResult {
  providerRef: string;
  status: EDocumentStatus;
  detail?: string;
}

export interface CancelResult {
  providerRef: string;
  status: EDocumentStatus;
}

export interface InboxItem {
  providerRef: string;
  receivedAt: string; // ISO tarih-saat
}

/**
 * e-Belge portu — SPEC §21.1.
 * Her metot idempotent olmalı; send aynı invoice.id ile ikinci kez çağrılırsa
 * önceki sonucu döner. fast-xml-parser entegratör payload'ı için kullanılabilir;
 * XSD/Schematron doğrulaması entegratörün sorumluluğudur.
 */
export interface EDocumentPort {
  send(invoice: InvoiceSnapshot): Promise<SendResult>;
  queryStatus(providerRef: string): Promise<StatusResult>;
  cancel(providerRef: string, reason: string): Promise<CancelResult>;
  fetchInbox(since: Date): Promise<InboxItem[]>;
}
