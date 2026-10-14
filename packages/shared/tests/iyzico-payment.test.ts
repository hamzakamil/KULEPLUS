import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  IyzicoPaymentProvider,
  buildIyzicoAuthHeader,
  verifyIyzicoWebhookSignature,
} from '../src/integrations/iyzico-payment';

/**
 * iyzico adaptörü birim testleri — Faz 4 K-08 (SPEC §29.1).
 *
 * Gerçek iyzico mekanizmaları (resmi döküman):
 *  - `IYZWSv2` auth: HMAC-SHA256(randomKey + uri + body, secretKey).hex →
 *    base64("apiKey:..&randomKey:..&signature:..") → `Authorization`.
 *  - `X-IYZ-SIGNATURE-V3` webhook imzası:
 *    HMAC-SHA256(merchantId + secretKey + eventType + subRef + orderRef + custRef, secretKey).hex.
 *
 * HTTP çağrıları enjekte `fetchImpl` ile taklit edilir (ağ bağımlılığı yok).
 */

const API_KEY = 'sandbox-test-api-key';
const SECRET = 'sandbox-test-secret-key';
const MERCHANT = 'merchant-123';
const PLAN = 'plan-ref-code';

/** Deterministik sahte fetch — yakalanan isteği kaydeder, verilen JSON döner. */
function makeFetch(responseBody: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => responseBody,
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('buildIyzicoAuthHeader — IYZWSv2', () => {
  it('imzayı HMAC-SHA256(randomKey+uri+body) ile üretir ve base64 sarar', () => {
    const body = '{"locale":"tr"}';
    const header = buildIyzicoAuthHeader({
      apiKey: API_KEY,
      secretKey: SECRET,
      uriPath: '/payment/bin/check',
      body,
      randomKey: '123456789',
    });
    // Beklenen imza: HMAC-SHA256("123456789/payment/bin/check{...}")
    const expectedSig = createHmac('sha256', SECRET)
      .update('123456789' + '/payment/bin/check' + body)
      .digest('hex');
    const decoded = Buffer.from(header.authorization.replace('IYZWSv2 ', ''), 'base64').toString(
      'utf8',
    );
    expect(header.authorization.startsWith('IYZWSv2 ')).toBe(true);
    expect(decoded).toContain(`apiKey:${API_KEY}`);
    expect(decoded).toContain('randomKey:123456789');
    expect(decoded).toContain(`signature:${expectedSig}`);
    expect(header.randomKey).toBe('123456789');
  });

  it('farklı body farklı imza üretir (bütünlük)', () => {
    const base = {
      apiKey: API_KEY,
      secretKey: SECRET,
      uriPath: '/p',
      randomKey: 'r',
    };
    const a = buildIyzicoAuthHeader({ ...base, body: '{"a":1}' });
    const b = buildIyzicoAuthHeader({ ...base, body: '{"a":2}' });
    expect(a.authorization).not.toBe(b.authorization);
  });
});

describe('verifyIyzicoWebhookSignature — V3', () => {
  const params = {
    merchantId: MERCHANT,
    eventType: 'SUBSCRIPTION_ORDER_SUCCESS',
    subscriptionReferenceCode: 'sub-ref-1',
    orderReferenceCode: 'order-ref-1',
    customerReferenceCode: 'cust-ref-1',
  };

  it('doğru imzayı kabul eder', () => {
    const message =
      params.merchantId +
      SECRET +
      params.eventType +
      params.subscriptionReferenceCode +
      params.orderReferenceCode +
      params.customerReferenceCode;
    const sig = createHmac('sha256', SECRET).update(message).digest('hex');
    expect(verifyIyzicoWebhookSignature({ secretKey: SECRET, signature: sig, ...params })).toBe(
      true,
    );
  });

  it('bozuk imzayı reddeder', () => {
    expect(
      verifyIyzicoWebhookSignature({ secretKey: SECRET, signature: 'deadbeef', ...params }),
    ).toBe(false);
  });

  it('imza başlığı yoksa reddeder (güvenlik varsayılanı)', () => {
    expect(
      verifyIyzicoWebhookSignature({ secretKey: SECRET, signature: undefined, ...params }),
    ).toBe(false);
  });

  it('değiştirilmiş alan (eventType) imzayı geçersiz kılar', () => {
    const message =
      params.merchantId + SECRET + params.eventType + 'sub-ref-1' + 'order-ref-1' + 'cust-ref-1';
    const sig = createHmac('sha256', SECRET).update(message).digest('hex');
    const tampered = verifyIyzicoWebhookSignature({
      secretKey: SECRET,
      signature: sig,
      ...params,
      eventType: 'SUBSCRIPTION_ORDER_FAILURE',
    });
    expect(tampered).toBe(false);
  });
});

describe('IyzicoPaymentProvider — HTTP (mock fetch)', () => {
  it('charge: /v2/subscription/initialize çağrısını doğru imza başlıklarıyla yapar', async () => {
    const { impl, calls } = makeFetch({
      status: 'success',
      data: { token: 'tok-123', referenceCode: 'sub-ref-123' },
    });
    const provider = new IyzicoPaymentProvider({
      apiKey: API_KEY,
      secretKey: SECRET,
      pricingPlanReferenceCode: PLAN,
      merchantId: MERCHANT,
      randomKeyFactory: () => 'rnd-1',
      fetchImpl: impl,
    });
    const result = await provider.charge({
      providerCustomerRef: 'cust-ref-1',
      idempotencyKey: 'idem-1',
      amount: '149.90',
      currency: 'TRY',
      callbackUrl: 'https://app.example/cb',
    });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe('https://sandbox-api.iyzipay.com/v2/subscription/initialize');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^IYZWSv2 /);
    expect(headers['x-iyzi-rnd']).toBe('rnd-1');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(call.init.body));
    expect(body.pricingPlanReferenceCode).toBe(PLAN);
    expect(body.customerReferenceCode).toBe('cust-ref-1');
    expect(body.callbackUrl).toBe('https://app.example/cb');
    // Hosted akış: başarılı başlatma → pending + redirectUrl.
    expect(result.status).toBe('pending');
    expect(result.providerRef).toBe('tok-123');
    expect(result.redirectUrl).toContain('tok-123');
  });

  it('charge: sağlayıcı failure dönerse status=failed olur', async () => {
    const { impl } = makeFetch({ status: 'failure', errorMessage: 'plan yok' });
    const provider = new IyzicoPaymentProvider({
      apiKey: API_KEY,
      secretKey: SECRET,
      pricingPlanReferenceCode: PLAN,
      randomKeyFactory: () => 'rnd-2',
      fetchImpl: impl,
    });
    const result = await provider.charge({
      providerCustomerRef: 'cust-ref-1',
      idempotencyKey: 'idem-2',
      amount: '149.90',
      currency: 'TRY',
    });
    expect(result.status).toBe('failed');
    expect(result.detail).toBeTruthy();
  });

  it('HTTP hata durumunda fırlatır (5xx)', async () => {
    const { impl } = makeFetch({ errorMessage: 'boom' }, 500);
    const provider = new IyzicoPaymentProvider({
      apiKey: API_KEY,
      secretKey: SECRET,
      pricingPlanReferenceCode: PLAN,
      fetchImpl: impl,
    });
    await expect(
      provider.charge({
        providerCustomerRef: 'c',
        idempotencyKey: 'i',
        amount: '10',
        currency: 'TRY',
      }),
    ).rejects.toThrow(/iyzico isteği başarısız/);
  });

  it('createCustomer: sağlayıcı referansını döner', async () => {
    const { impl, calls } = makeFetch({ status: 'success', data: { referenceCode: 'cust-x' } });
    const provider = new IyzicoPaymentProvider({
      apiKey: API_KEY,
      secretKey: SECRET,
      pricingPlanReferenceCode: PLAN,
      randomKeyFactory: () => 'rnd-3',
      fetchImpl: impl,
    });
    const res = await provider.createCustomer({
      externalId: 'u-1',
      email: 'a@b.c',
      name: 'Ayşe Yılmaz',
    });
    expect(res.providerCustomerRef).toBe('cust-x');
    expect(calls[0].url).toContain('/v2/subscription/customers');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.name).toBe('Ayşe');
    expect(body.surname).toBe('Yılmaz');
  });
});

describe('IyzicoPaymentProvider.parseWebhook — imzalı çözümleme', () => {
  const payload = {
    iyziEventType: 'SUBSCRIPTION_ORDER_SUCCESS',
    status: 'SUCCESS',
    subscriptionReferenceCode: 'sub-ref-1',
    orderReferenceCode: 'order-ref-1',
    customerReferenceCode: 'cust-ref-1',
    merchantId: MERCHANT,
  };
  const rawBody = JSON.stringify(payload);

  function sign(body: string, secret: string, p: typeof payload): string {
    const message =
      p.merchantId +
      secret +
      p.iyziEventType +
      p.subscriptionReferenceCode +
      p.orderReferenceCode +
      p.customerReferenceCode;
    return createHmac('sha256', secret).update(message).digest('hex');
  }

  it('geçerli imzalı SUCCESS payload → payment.succeeded', () => {
    const provider = new IyzicoPaymentProvider({
      apiKey: API_KEY,
      secretKey: SECRET,
      pricingPlanReferenceCode: PLAN,
      merchantId: MERCHANT,
    });
    const sig = sign(rawBody, SECRET, payload);
    const ev = provider.parseWebhook(rawBody, sig);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('payment.succeeded');
    expect(ev?.providerRef).toBe('order-ref-1');
    expect(ev?.raw).toBeDefined();
  });

  it('geçerli imzalı FAILURE payload → payment.failed', () => {
    const failPayload = { ...payload, status: 'FAILURE' };
    const body = JSON.stringify(failPayload);
    const provider = new IyzicoPaymentProvider({
      apiKey: API_KEY,
      secretKey: SECRET,
      pricingPlanReferenceCode: PLAN,
      merchantId: MERCHANT,
    });
    const sig = sign(body, SECRET, failPayload);
    const ev = provider.parseWebhook(body, sig);
    expect(ev?.type).toBe('payment.failed');
  });

  it('bozuk imza → null (sahte webhook reddi)', () => {
    const provider = new IyzicoPaymentProvider({
      apiKey: API_KEY,
      secretKey: SECRET,
      pricingPlanReferenceCode: PLAN,
      merchantId: MERCHANT,
    });
    expect(provider.parseWebhook(rawBody, '00ff00')).toBeNull();
  });

  it('imza yoksa → null', () => {
    const provider = new IyzicoPaymentProvider({
      apiKey: API_KEY,
      secretKey: SECRET,
      pricingPlanReferenceCode: PLAN,
      merchantId: MERCHANT,
    });
    expect(provider.parseWebhook(rawBody, undefined)).toBeNull();
  });

  it('geçersiz JSON → null', () => {
    const provider = new IyzicoPaymentProvider({
      apiKey: API_KEY,
      secretKey: SECRET,
      pricingPlanReferenceCode: PLAN,
      merchantId: MERCHANT,
    });
    expect(provider.parseWebhook('not-json', 'whatever')).toBeNull();
  });
});
