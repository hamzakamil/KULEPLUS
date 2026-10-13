import { type MoneyString } from './ports.js';

/**
 * Ödeme sağlayıcısı portu — SPEC §29.1 adapter kalıbı, `subscription` modülü (Faz 4).
 *
 * Sanal POS / kart saklama sağlayıcısı (iyzico, PayTR, Stripe — K-14 kararı bekleniyor)
 * bu arayüzü uygular; dev ve test ortamında `MockPaymentProvider` kullanılır.
 *
 * Kural (SPEC §0.3): tüm tutarlar `MoneyString` — para asla float değildir.
 * Kart PAN/paniç verisi bu porttan GEÇMEZ; sağlayıcı yalnızca token/ref döner (PCI-UED).
 */
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

/** Müşteri kartı (cust_token) — tekrarlayan abonelik çekimi için saklanır. */
export interface PaymentCustomerInput {
  /** Bizim `users.id` — sağlayıcı tarafında external_id olarak tutulur. */
  externalId: string;
  email: string;
  name: string;
}

export interface PaymentCustomerResult {
  /** Sağlayıcı müşteri referansı — `subscription_customers.provider_customer_ref`. */
  providerCustomerRef: string;
}

export interface ChargeInput {
  providerCustomerRef: string;
  /** Idempotency anahtarı — aynı anahtarla ikinci çağırma yeni tahsilat üretmez. */
  idempotencyKey: string;
  amount: MoneyString;
  currency: string; // ISO 4217 (TRY)
  /** Başarılı/hibrit 3DS: yönlendirme URL'i gerekebilir. */
  callbackUrl?: string;
  description?: string;
}

export interface ChargeResult {
  /** Sağlayıcı işlem referansı — `payments.provider_ref`. */
  providerRef: string;
  status: PaymentStatus;
  /** 3DS gerekiyorsa yönlendirilecek URL; gerekmiyorsa null. */
  redirectUrl: string | null;
  detail?: string;
}

export interface RefundResult {
  providerRef: string;
  status: PaymentStatus;
  detail?: string;
}

export interface PaymentProvider {
  /** Müşteri/kart saklama kaydı oluşturur (token-only, PCI kapsamı dışı). */
  createCustomer(input: PaymentCustomerInput): Promise<PaymentCustomerResult>;

  /** Kart üzerine tahsilat (charge). `idempotencyKey` ile tekrarlanabilir. */
  charge(input: ChargeInput): Promise<ChargeResult>;

  /** Kısmi veya tam iade; `amount` verilmezse tamamı. */
  refund(providerRef: string, amount?: MoneyString): Promise<RefundResult>;

  /** Sağlayıcı tarafındaki güncel durum — webhook kaybına karşı mutabakat. */
  status(providerRef: string): Promise<{ providerRef: string; status: PaymentStatus }>;

  /**
   * Webhook gövdesini imza kontrolüyle çözümler. İmza geçersizse `null` döner
   * (throw etmez — çağırlayan 400 döner; SPEC §22.1 hata sözleşmesi).
   */
  parseWebhook(rawBody: string, signature: string | undefined): WebhookEvent | null;
}

/** Normaliz edilmiş webhook olayı — sağlayıcıdan bağımsız ortak dil. */
export interface WebhookEvent {
  /** Örnek: `payment.succeeded`, `payment.failed`, `refund.succeeded`. */
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded';
  providerRef: string;
  amount?: MoneyString;
  /** İmzalı ham gövde — denetim için olduğu gibi saklanır. */
  raw: unknown;
}
