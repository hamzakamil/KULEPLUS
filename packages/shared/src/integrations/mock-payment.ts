import {
  type ChargeInput,
  type ChargeResult,
  type PaymentCustomerInput,
  type PaymentCustomerResult,
  type PaymentProvider,
  type PaymentStatus,
  type RefundResult,
  type WebhookEvent,
} from './payment.js';
import type { MoneyString } from './ports.js';

/**
 * Mock ödeme sağlayıcısı — Faz 0 (ROADMAP: "Mock sağlayıcılar: e-posta, SMS, ödeme, e-Dönüşüm").
 * SPEC §29.1 (Liskov): gerçek sağlayıcı ile aynı sözleşmeyi uygular.
 *
 * Davranış:
 *  - `charge` idempotent — aynı `idempotencyKey` aynı sonucu döner (SPEC §27.1).
 *  - `amount` "0" ise başarısız sayılır (ret simülasyonu).
 *  - Webhook imzası `MOCK:<providerRef>` biçiminde beklenir.
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly customers = new Map<string, string>(); // externalId -> ref
  private readonly charges = new Map<string, ChargeResult>(); // idempotencyKey -> result
  private readonly byRef = new Map<string, PaymentStatus>(); // providerRef -> status
  private readonly refunds = new Map<string, RefundResult>();
  private counter = 0;
  private failNext = false;

  async createCustomer(input: PaymentCustomerInput): Promise<PaymentCustomerResult> {
    const existing = this.customers.get(input.externalId);
    if (existing) return { providerCustomerRef: existing }; // idempotent
    this.counter += 1;
    const ref = `MOCK-CUST-${String(this.counter).padStart(6, '0')}`;
    this.customers.set(input.externalId, ref);
    return { providerCustomerRef: ref };
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const existing = this.charges.get(input.idempotencyKey);
    if (existing) return existing; // idempotent — tekrar tahsilat yok

    this.counter += 1;
    const providerRef = `MOCK-PAY-${String(this.counter).padStart(8, '0')}`;
    const declined = this.failNext || Number(input.amount) <= 0;
    if (this.failNext) this.failNext = false;

    const result: ChargeResult = {
      providerRef,
      status: declined ? 'failed' : 'succeeded',
      redirectUrl: null,
      detail: declined ? 'Kart reddetti (mock)' : undefined,
    };
    this.charges.set(input.idempotencyKey, result);
    this.byRef.set(providerRef, result.status);
    return result;
  }

  async refund(providerRef: string, amount?: MoneyString): Promise<RefundResult> {
    const existing = this.refunds.get(providerRef);
    if (existing) return existing; // idempotent

    const current = this.byRef.get(providerRef);
    if (current !== 'succeeded') {
      return { providerRef, status: 'failed', detail: 'İade edilebilir işlem yok' };
    }
    const result: RefundResult = {
      providerRef,
      status: 'refunded',
      detail: amount ? `Kısmi iade: ${amount}` : 'Tam iade',
    };
    this.refunds.set(providerRef, result);
    this.byRef.set(providerRef, 'refunded');
    return result;
  }

  async status(providerRef: string): Promise<{ providerRef: string; status: PaymentStatus }> {
    return { providerRef, status: this.byRef.get(providerRef) ?? 'pending' };
  }

  parseWebhook(rawBody: string, signature: string | undefined): WebhookEvent | null {
    if (!signature || !signature.startsWith('MOCK:')) return null; // imza geçersiz
    let payload: { type?: string; providerRef?: string; amount?: string };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      return null;
    }
    if (!payload.providerRef) return null;
    const type = payload.type ?? 'payment.succeeded';
    if (type !== 'payment.succeeded' && type !== 'payment.failed' && type !== 'refund.succeeded') {
      return null;
    }
    const status: PaymentStatus =
      type === 'payment.succeeded'
        ? 'succeeded'
        : type === 'refund.succeeded'
          ? 'refunded'
          : 'failed';
    this.byRef.set(payload.providerRef, status);
    return { type, providerRef: payload.providerRef, amount: payload.amount, raw: payload };
  }

  /** Test yardımcıları. */
  simulateFailure(): void {
    this.failNext = true;
  }

  chargeCount(): number {
    return this.charges.size;
  }

  reset(): void {
    this.customers.clear();
    this.charges.clear();
    this.byRef.clear();
    this.refunds.clear();
    this.counter = 0;
    this.failNext = false;
  }
}
