/** Faz 8 — WhatsAppProvider arayüzü ve mock (SPEC §18, ROADMAP §Faz 8).
 * Mock ve gerçek sağlayıcılar aynı sözleşmeyi sağlar.
 * Her metot idempotent: aynı gönderim/KİMLİK ZİMİSİ seconda çağrıldığında önceki sonucu döner.
 * SPEC §29.1 (Liskov): gerçek sağlayıcı bu arayüzü uygular.
 */

export type WhatsAppStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  status?: string;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface WhatsAppStatusResult {
  status: WhatsAppStatus;
  lastStatusAt: Date;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface WhatsAppInboxMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  direction: 'incoming' | 'outgoing';
  template?: string;
  timestamp: Date;
  status: 'pending' | 'received' | 'processed';
}

/** WhatsAppProvider arayüzü — gerçek/sağlayıcıya uygulanacak sözleşme. */
export interface WhatsAppProvider {
  /** WhatsApp mesajı gönder.
   *  Idempotent: aynı `messageId` ikinci kez çağırıldığında önceki sonucu döner. */
  sendMessage(messageId: string, to: string, body: string): Promise<WhatsAppSendResult>;

  /** Mesaj durumunu sorgula (önbellekli).
   *  `messageId` gönderimin izini döner. */
  queryStatus(messageId: string): Promise<WhatsAppStatusResult>;

  /** Gelen kutusundan WhatsApp mesajları listele. */
  listInbox(limit?: number, offset?: number): Promise<WhatsAppInboxMessage[]>;

  /** Şablon gönderimi (örnek: doğrulama kodu, bildirim). */
  sendTemplate(
    messageId: string,
    to: string,
    templateName: string,
    variables: Record<string, string>,
  ): Promise<WhatsAppSendResult>;
}

/** Mock WhatsAppProvider — development; gerçek sağlayıcı bu arayüzü implement eder (SPEC §29.1 Liskov). */
export class MockWhatsAppProvider implements WhatsAppProvider {
  private readonly messages = new Map<string, WhatsAppSendResult>(); // messageId -> result
  private readonly statuses = new Map<string, WhatsAppStatusResult>(); // messageId -> status
  private readonly inbox: WhatsAppInboxMessage[] = [];

  async sendMessage(messageId: string, to: string, body: string): Promise<WhatsAppSendResult> {
    if (this.messages.has(messageId)) return this.messages.get(messageId)!; // idempotent

    const result: WhatsAppSendResult = {
      success: true,
      messageId,
      status: 'sent',
      providerMessageId: 'MOCK-' + Math.random().toString(36).slice(2, 10),
    };
    this.messages.set(messageId, result);
    this.statuses.set(messageId, { status: 'sent', lastStatusAt: new Date() });
    // Inbox kaydı (gelen kutusuna)
    this.inbox.push({
      id: Math.random().toString(36).slice(2, 10),
      from: to,
      to: to,
      body,
      direction: 'outgoing',
      template: undefined,
      timestamp: new Date(),
      status: 'received',
    });
    return result;
  }

  async queryStatus(messageId: string): Promise<WhatsAppStatusResult> {
    if (this.statuses.has(messageId)) return this.statuses.get(messageId)!;
    return { status: 'pending', lastStatusAt: new Date() };
  }

  async listInbox(limit = 50, offset = 0): Promise<WhatsAppInboxMessage[]> {
    return this.inbox.slice(offset, offset + limit);
  }

  async sendTemplate(
    messageId: string,
    to: string,
    templateName: string,
    variables: Record<string, string>,
  ): Promise<WhatsAppSendResult> {
    return this.sendMessage(
      messageId,
      to,
      `Template: ${templateName} ${JSON.stringify(variables)}`,
    );
  }
}
