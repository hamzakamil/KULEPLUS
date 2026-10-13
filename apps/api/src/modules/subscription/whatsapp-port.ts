/** Faz 8 — WhatsAppProvider arayüzü (SPEC §18, ROADMAP §Faz 8).
 * Mock ve gerçek sağlayıcılar aynı sözleşmeyi sağlar.
 * Her metot idempotent: aynı gönderim/KİMLİK ZİMİSİ zweite çağrıldığında önceki sonucu döner.
 */

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
  sendTemplate(messageId: string, to: string, templateName: string, variables: Record<string, string>): Promise<WhatsAppSendResult>;
}

/** Mock WhatsAppProvider — development; gerçek sağlayıcı bu arayüzü implement eder (SPEC §29.1 Liskov). */
export class MockWhatsAppProvider implements WhatsAppProvider {
  async sendMessage(_messageId: string, _to: string, _body: string): Promise<WhatsAppSendResult> {
    return {
      success: true,
      messageId: 'MOCK-' + Math.random().toString(36).slice(2, 10),
      status: 'sent',
      providerMessageId: 'MOCK-' + Math.random().toString(36).slice(2, 10),
    };
  }

  async queryStatus(_messageId: string): Promise<WhatsAppStatusResult> {
    return {
      status: 'sent',
      lastStatusAt: new Date(),
    };
  }

  async listInbox(_limit = 50, _offset = 0): Promise<WhatsAppInboxMessage[]> {
    return [];
  }

  async sendTemplate(_messageId: string, _to: string, _templateName: string, _variables: Record<string, string>): Promise<WhatsAppSendResult> {
    return {
      success: true,
      messageId: 'MOCK-' + Math.random().toString(36).slice(2, 10),
      status: 'sent',
      providerMessageId: 'MOCK-' + Math.random().toString(36).slice(2, 10),
    };
  }
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  status?: string;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface WhatsAppStatusResult {
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
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
