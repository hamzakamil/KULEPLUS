import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MoneyString } from './ports.js';
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

/**
 * iyzico ödeme sağlayıcı adaptörü — Faz 4 K-08 (SPEC §29.1 adapter kalıbı).
 *
 * `MockPaymentProvider` ile AYNI `PaymentProvider` sözleşmesini uygular (Liskov):
 * dev/test `mock`, üretim `iyzico` (env `PAYMENT_PROVIDER` ile seçilir).
 *
 * Gerçek mekanizmalar (iyzico resmi dökümanı):
 *  - Kimlik doğrulama `IYZWSv2`: her istekte rastgele `x-iyzi-rnd` üretilir;
 *    imza = HMAC-SHA256(randomKey + uri.path + body, secretKey).hex →
 *    base64("apiKey:<key>&randomKey:<rnd>&signature:<hex>") `Authorization` başlığı.
 *  - Webhook imzası `X-IYZ-SIGNATURE-V3`:
 *    HMAC-SHA256(merchantId + secretKey + eventType + subscriptionRef + orderRef +
 *    customerRef, secretKey).hex (eski X-Iyz-Signature/V2 yerine).
 *
 * Kural (SPEC §0.3): tutarlar `MoneyString`. Kart PAN/CVV bu porttan GEÇMEZ —
 * kullanıcı iyzico barındırmalı (hosted) forma yönlendirilir; sonuç imzalı
 * webhook ile döner (PCI-DSS kapsam dışı).
 *
 * Sınır: HTTP çağrıları `fetchImpl` üzerinden yürür; birim testler sahte fetch
 * ile doğrulanır (ağ bağımlılığı yok). CANLI doğrulama sandbox anahtarları +
 * iyzico'da tanımlı fiyatlandırma planı (pricingPlanReferenceCode) gerektirir —
 * bu Faz 4 çıkış kapısında yapılır.
 */

export interface IyzicoConfig {
  apiKey: string;
  secretKey: string;
  /** Üretim `https://api.iyzipay.com`, sandbox `https://sandbox-api.iyzipay.com`. */
  baseUrl?: string;
  /** Fiyatlandırma planı referans kodu — abonelik başlatmak için iyzico panelinde tanımlı olmalı. */
  pricingPlanReferenceCode: string;
  /** Webhook imzasında kullanılan üye işyeri kimliği (MID). */
  merchantId?: string;
  /** Sağlayıcı adı (webhook kaydında `provider` kolonuna yazılır). */
  providerName?: string;
  /** Test enjeksiyonu: fetch'i taklit eder (varsayılan global fetch). */
  fetchImpl?: typeof fetch;
  /** Idempotent kimlik üretici (test determinizmi). */
  randomKeyFactory?: () => string;
}

/** Auth sonucu — `Authorization` başlığı + eş zamanlı gönderilen rastgele anahtar. */
export interface IyzicoAuthHeader {
  authorization: string;
  randomKey: string;
}

/**
 * `IYZWSv2` kimlik doğrulama başlığını üretir.
 *
 * imza = HMAC-SHA256(randomKey + uriPath + body, secretKey) [hex]
 * authorization = "IYZWSv2 " + base64("apiKey:<key>&randomKey:<rnd>&signature:<hex>")
 */
export function buildIyzicoAuthHeader(args: {
  apiKey: string;
  secretKey: string;
  uriPath: string;
  body: string;
  randomKey: string;
}): IyzicoAuthHeader {
  const signature = createHmac('sha256', args.secretKey)
    .update(args.randomKey + args.uriPath + args.body)
    .digest('hex');
  const raw = `apiKey:${args.apiKey}&randomKey:${args.randomKey}&signature:${signature}`;
  return {
    authorization: `IYZWSv2 ${Buffer.from(raw, 'utf8').toString('base64')}`,
    randomKey: args.randomKey,
  };
}

/** Webhook imza (V3) doğrulama girdisi — payload alanları + sağlayıcı başlığı. */
export interface IyzicoWebhookSignatureInput {
  secretKey: string;
  /** `X-IYZ-SIGNATURE-V3` başlığı (hex). */
  signature: string | undefined;
  merchantId: string;
  eventType: string;
  subscriptionReferenceCode: string;
  orderReferenceCode: string;
  customerReferenceCode: string;
}

/**
 * iyzico `X-IYZ-SIGNATURE-V3` webhook imzasını doğrular (timing-safe).
 * Anahtar = merchantId + secretKey + eventType + subscriptionRef + orderRef + customerRef.
 */
export function verifyIyzicoWebhookSignature(input: IyzicoWebhookSignatureInput): boolean {
  if (!input.signature) return false;
  const message =
    input.merchantId +
    input.secretKey +
    input.eventType +
    input.subscriptionReferenceCode +
    input.orderReferenceCode +
    input.customerReferenceCode;
  const expected = createHmac('sha256', input.secretKey).update(message).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(input.signature, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export class IyzicoPaymentProvider implements PaymentProvider {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly merchantId: string;
  private readonly pricingPlanReferenceCode: string;
  private readonly fetchImpl: typeof fetch;
  private readonly randomKeyFactory: () => string;

  constructor(config: IyzicoConfig) {
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl ?? 'https://sandbox-api.iyzipay.com';
    this.merchantId = config.merchantId ?? '';
    this.pricingPlanReferenceCode = config.pricingPlanReferenceCode;
    this.fetchImpl = config.fetchImpl ?? ((...args) => fetch(...args));
    this.randomKeyFactory =
      config.randomKeyFactory ?? (() => `${Date.now()}${Math.floor(Math.random() * 1e9)}`);
  }

  /** Yetkili istek gönderir; ayrıştırılmış JSON döner. */
  private async request<T>(uriPath: string, bodyObj: unknown): Promise<T> {
    const body = JSON.stringify(bodyObj);
    const randomKey = this.randomKeyFactory();
    const { authorization } = buildIyzicoAuthHeader({
      apiKey: this.apiKey,
      secretKey: this.secretKey,
      uriPath,
      body,
      randomKey,
    });
    const res = await this.fetchImpl(`${this.baseUrl}${uriPath}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'x-iyzi-rnd': randomKey,
        'Content-Type': 'application/json',
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`iyzico isteği başarısız: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  async createCustomer(input: PaymentCustomerInput): Promise<PaymentCustomerResult> {
    const [name, ...rest] = input.name.split(' ');
    const surname = rest.join(' ') || name;
    const data = await this.request<{ data?: { referenceCode?: string } }>(
      '/v2/subscription/customers',
      { locale: 'tr', conversationId: input.externalId, name, surname, email: input.email },
    );
    // Bulunamazsa external id'yi taşı (idempotent referans kaybı olmaz).
    return { providerCustomerRef: data.data?.referenceCode ?? input.externalId };
  }

  /**
   * Abonelik tahsilatını başlatır. Kart verisi geçirilmez; iyzico barındırmalı
   * akışta `redirectUrl` döner, onay `payment.succeeded` webhook'u ile gelir.
   */
  async charge(input: ChargeInput): Promise<ChargeResult> {
    const data = await this.request<{
      status?: string;
      data?: { token?: string; referenceCode?: string };
    }>('/v2/subscription/initialize', {
      locale: 'tr',
      conversationId: input.idempotencyKey,
      pricingPlanReferenceCode: this.pricingPlanReferenceCode,
      customerReferenceCode: input.providerCustomerRef,
      callbackUrl: input.callbackUrl,
    });
    const token = data.data?.token;
    const failed = data.status !== 'success';
    return {
      providerRef: token ?? data.data?.referenceCode ?? input.idempotencyKey,
      status: failed ? 'failed' : 'pending',
      redirectUrl: token ? `${this.baseUrl}/${token}` : null,
      detail: failed ? (data.status ?? 'iyzico abonelik başlatılamadı') : undefined,
    };
  }

  async refund(providerRef: string, amount?: MoneyString): Promise<RefundResult> {
    const data = await this.request<{ status?: string }>('/v2/subscription/cancel', {
      locale: 'tr',
      conversationId: providerRef,
      subscriptionReferenceCode: providerRef,
    });
    const failed = data.status !== 'success';
    return {
      providerRef,
      status: failed ? 'failed' : 'refunded',
      detail: amount ? `İptal/iade talebi (${amount})` : 'İptal/iade talebi',
    };
  }

  async status(providerRef: string): Promise<{ providerRef: string; status: PaymentStatus }> {
    const data = await this.request<{ data?: { subscriptionStatus?: string } }>(
      `/v2/subscription/${providerRef}`,
      {},
    );
    const s = data.data?.subscriptionStatus;
    const status: PaymentStatus =
      s === 'ACTIVE' ? 'succeeded' : s === 'CANCELED' ? 'refunded' : 'pending';
    return { providerRef, status };
  }

  /**
   * Webhook'u imza kontrolüyle çözümler; imza geçersizse `null` (throw etmez —
   * çağırlayan 400 döner; SPEC §22.1).
   */
  parseWebhook(rawBody: string, signature: string | undefined): WebhookEvent | null {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
    const parsed = this.extractFields(payload);
    if (!parsed) return null;
    const merchantId =
      this.merchantId || String(payload.merchantId ?? payload.iyziMerchantId ?? '');
    const ok = verifyIyzicoWebhookSignature({
      secretKey: this.secretKey,
      signature,
      merchantId,
      eventType: parsed.eventType,
      subscriptionReferenceCode: parsed.subscriptionReferenceCode,
      orderReferenceCode: parsed.orderReferenceCode,
      customerReferenceCode: parsed.customerReferenceCode,
    });
    if (!ok) return null;

    const type =
      parsed.status === 'SUCCESS' ? 'payment.succeeded' : parsed.status ? 'payment.failed' : null;
    if (!type) return null;
    const providerRef = parsed.orderReferenceCode || parsed.subscriptionReferenceCode;
    return { type, providerRef, raw: payload };
  }

  /** iyzico payload'ından gerekli alanları ayıkar (doğrulama öncesi tip süzgeci). */
  private extractFields(payload: Record<string, unknown>): ParsedIyzicoPayload | null {
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const parsed: ParsedIyzicoPayload = {
      eventType: str(payload.iyziEventType ?? payload.eventType),
      subscriptionReferenceCode: str(payload.subscriptionReferenceCode),
      orderReferenceCode: str(payload.orderReferenceCode),
      customerReferenceCode: str(payload.customerReferenceCode),
      status: str(payload.status),
    };
    // Abonelik webhook'u en az olay tipi + bir referans kodu içermeli.
    if (!parsed.eventType || (!parsed.orderReferenceCode && !parsed.subscriptionReferenceCode)) {
      return null;
    }
    return parsed;
  }
}

/** iyzico webhook payload'ından çıkarılan normaliz edilmiş alanlar. */
interface ParsedIyzicoPayload {
  eventType: string;
  subscriptionReferenceCode: string;
  orderReferenceCode: string;
  customerReferenceCode: string;
  status: string;
}
