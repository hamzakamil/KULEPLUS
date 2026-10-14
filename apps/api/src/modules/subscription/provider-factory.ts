import { IyzicoPaymentProvider } from '@kuleplus/shared';
import type { PaymentProvider } from '@kuleplus/shared';
import { MockPaymentProvider } from '@kuleplus/shared';

/**
 * Ödeme sağlayıcı fabrikası — Faz 4 K-08 (mock → iyzico / manuel havale).
 *
 * `PAYMENT_PROVIDER=mock|iyzico|manual` (kökte .env.example). Seçim çağrı
 * anında `process.env`'den okunur (Faz 1 fail-fast ilkesi): `iyzico` seçiliyse
 * API/secret/pricing plan anahtarları zorunludur, yoksa açıkça hata fırlatılır
 * (yarım yapılandırmayla üretime çıkışı önlemek).
 *
 * Kural (SPEC §29.1): tek `PaymentProvider` sözleşmesi — uygulama hangi
 * sağlayıcının seçili olduğunu bilmez (Liskov). Kart PAN/CVV asla burada
 * görülmez: iyzico barındırmalı ödeme akışı kullanılır (PCI-DSS kapsam dışı).
 */
export function createPaymentProvider(source: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const provider = (source.PAYMENT_PROVIDER ?? 'mock').trim();
  if (provider === 'iyzico') {
    const apiKey = source.IYZICO_API_KEY ?? '';
    const secretKey = source.IYZICO_SECRET_KEY ?? '';
    const pricingPlanReferenceCode = source.IYZICO_PRICING_PLAN_REF ?? '';
    if (!apiKey || !secretKey || !pricingPlanReferenceCode) {
      throw new Error(
        'PAYMENT_PROVIDER=iyzico için IYZICO_API_KEY, IYZICO_SECRET_KEY ve IYZICO_PRICING_PLAN_REF zorunlu',
      );
    }
    return new IyzicoPaymentProvider({
      apiKey,
      secretKey,
      baseUrl: source.IYZICO_BASE_URL || undefined,
      pricingPlanReferenceCode,
      merchantId: source.IYZICO_MERCHANT_ID || undefined,
    });
  }
  // mock (varsayılan) ve manual (havale/EFT — sağlayıcı I/O'su yok) aynı davranır:
  // tahsilat onayı ödeme yönergesi/webhook ile dışarıdan yapılır.
  return new MockPaymentProvider();
}
