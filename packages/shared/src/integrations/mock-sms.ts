import { type SmsMessage, type SmsProvider, type SmsSendResult } from './sms.js';

/**
 * Mock SMS sağlayıcısı — Faz 0 (ROADMAP: "Mock sağlayıcılar: e-posta, SMS, ödeme, e-Dönüşüm").
 * SPEC §29.1 (Liskov): Mock, gerçek sağlayıcı ile aynı sözleşmeyi sağlar;
 * `send()` belirsiz exception fırlatmaz, her zaman `SmsSendResult` döner.
 *
 * Kredi modeli: her gönderim 1 kredi düşer; kredi biterse `status: 'failed'`.
 */
export class MockSmsProvider implements SmsProvider {
  private readonly sent: SmsMessage[] = [];
  private readonly failed: SmsMessage[] = [];
  private counter = 0;
  private credits: number;
  /** Test yardımcısı — bir sonraki gönderimi zorla başarısız yapar. */
  private failNext = false;

  constructor(initialCredits = 1000) {
    this.credits = initialCredits;
  }

  async send(message: SmsMessage): Promise<SmsSendResult> {
    if (this.failNext) {
      this.failNext = false;
      this.failed.push(message);
      return {
        providerRef: `MOCK-SMS-FAIL-${Date.now()}`,
        status: 'failed',
        detail: 'Simüle edilmiş hata',
      };
    }
    if (this.credits <= 0) {
      this.failed.push(message);
      return {
        providerRef: `MOCK-SMS-NOCREDIT-${Date.now()}`,
        status: 'failed',
        detail: 'Kredi yetersiz',
      };
    }

    this.credits -= 1;
    this.counter += 1;
    this.sent.push(message);
    return {
      providerRef: `MOCK-SMS-${String(this.counter).padStart(6, '0')}`,
      status: 'sent',
    };
  }

  async balance(): Promise<number | null> {
    return this.credits;
  }

  /** Test yardımcıları. */
  getSent(): SmsMessage[] {
    return this.sent;
  }

  getFailed(): SmsMessage[] {
    return this.failed;
  }

  /** Bir sonraki `send()` çağrısını başarısız yapar (ağ hatası simülasyonu). */
  simulateFailure(): void {
    this.failNext = true;
  }

  reset(): void {
    this.sent.length = 0;
    this.failed.length = 0;
    this.counter = 0;
    this.failNext = false;
  }
}
