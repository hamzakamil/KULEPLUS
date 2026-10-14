import { MockPaymentProvider } from './mock-payment.js';
import { IyzicoPaymentProvider } from './iyzico-payment.js';
import type { PaymentProvider } from './payment.js';

/**
 * Ödeme sağlayıcı seçimi (Faz 4 K-08, SPEC §29.1 adapter kalıbı).
 *
 * `PAYMENT_PROVIDER` ortam değişkenine göre sağlayıcı kurulur:
 *  - `mock`   (varsayılan) → MockPaymentProvider (dev/test, ağ yok).
 *  - `iyzico` → IyzicoPaymentProvider (gerçek sanal POS; anahtarlar zorunlu).
 *  - `manual` → MockPaymentProvider (havale/EFT manuel onay — K-08 sonrası).
 *
 * Hem API (`SubscriptionService`) hem worker (`billing-dunning` handler) bu tek
 * fabrikayı kullanır; ortam okuma bir yerde toplanır (DRY + DIP — modüller
 * `apps/*` değil paylaşılan çekirdek). Fail-fast (Faz 1 ilkesi): `iyzico` seçiliyse
 * anahtarlar okunduğu anda doğrulanır, eksikse açıkça hata fırlatılır.
 *
 * Sınır: `process.env` doğrudan okunur; birim testler env'yi geçici olarak ayarlayıp doğrular.
 */
export function createPaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const kind = env.PAYMENT_PROVIDER ?? 'mock';
  if (kind === 'iyzico') {
    const apiKey = env.IYZICO_API_KEY;
    const secretKey = env.IYZICO_SECRET_KEY;
    const pricingPlanReferenceCode = env.IYZICO_PRICING_PLAN_REF;
    if (!apiKey || !secretKey || !pricingPlanReferenceCode) {
      throw new Error(
        'PAYMENT_PROVIDER=iyzico seçili ancak IYZICO_API_KEY / IYZICO_SECRET_KEY / ' +
          'IYZICO_PRICING_PLAN_REF tanımlı değil (Faz 4 K-08 fail-fast).',
      );
    }
    return new IyzicoPaymentProvider({
      apiKey,
      secretKey,
      baseUrl: env.IYZICO_BASE_URL ?? 'https://sandbox-api.iyzipay.com',
      pricingPlanReferenceCode,
      merchantId: env.IYZICO_MERCHANT_ID,
    });
  }
  // mock veya manual: gerçek ağ yok. manual havale/EFT sonrası imzalı webhookla
  // aynı Mock sağlayıcı üzerinden ilerletilir.
  return new MockPaymentProvider();
}
