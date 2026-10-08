import { type EmailMessage, type EmailProvider } from './email.js';

/**
 * Mock e-posta sağlayıcısı — Faz 0.
 * SPEC §29.1 (Liskov): Mock, gerçek provider ile aynı sözleşmeyi sağlar.
 * Geliştirme/entegrasyon testlerinde kullanılır; prod'de SMTP.
 */
export class MockEmailProvider implements EmailProvider {
  private sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ providerRef: string; status: 'sent' | 'failed' }> {
    this.sent.push(message);
    return {
      providerRef: `MOCK-EMAIL-${String(this.sent.length).padStart(6, '0')}`,
      status: 'sent',
    };
  }

  /** Test yardımcısı — gönderilen mesajları listeler. */
  getSent(): EmailMessage[] {
    return this.sent;
  }

  reset(): void {
    this.sent = [];
  }
}
