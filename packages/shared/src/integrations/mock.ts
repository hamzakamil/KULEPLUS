import {
  type CancelResult,
  type EDocumentPort,
  type InboxItem,
  type InvoiceSnapshot,
  type SendResult,
  type StatusResult,
} from './ports';

/**
 * Mock e-Belge sağlayıcısı — Faz 0.
 * SPEC §29.1 (Liskov): Mock, gerçek provider ile aynı sözleşmeyi sağlar;
 * send() içinde belirsiz exception fırlatmaz.
 *
 * Idempotency: aynı invoice.id ikinci kez gönderilirse kayıtlı sonuç döner.
 */
export class MockEInvoiceProvider implements EDocumentPort {
  private readonly sent = new Map<string, SendResult>();
  private readonly statuses = new Map<string, StatusResult>();
  private counter = 0;

  async send(invoice: InvoiceSnapshot): Promise<SendResult> {
    const existing = this.sent.get(invoice.id);
    if (existing) return existing; // idempotent
    this.counter += 1;
    const result: SendResult = {
      providerRef: `MOCK-${String(this.counter).padStart(6, '0')}`,
      status: 'sent',
    };
    this.sent.set(invoice.id, result);
    this.statuses.set(result.providerRef, { ...result });
    return result;
  }

  async queryStatus(providerRef: string): Promise<StatusResult> {
    const known = this.statuses.get(providerRef);
    if (known) return known;
    return { providerRef, status: 'error', detail: 'Bilinmeyen referans' };
  }

  async cancel(providerRef: string, reason: string): Promise<CancelResult> {
    const known = this.statuses.get(providerRef);
    if (!known) return { providerRef, status: 'error' };
    const cancelled: CancelResult = { providerRef, status: 'cancelled' };
    this.statuses.set(providerRef, { ...cancelled, detail: reason });
    return cancelled;
  }

  async fetchInbox(_since: Date): Promise<InboxItem[]> {
    return [];
  }

  /** Test yardımcıları. */
  sentCount(): number {
    return this.sent.size;
  }
}
