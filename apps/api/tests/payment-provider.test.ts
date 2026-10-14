import { describe, expect, it } from 'vitest';
import { createPaymentProvider, IyzicoPaymentProvider, MockPaymentProvider } from '@kuleplus/shared';

/**
 * Ödeme sağlayıcı seçimi testleri — Faz 4 K-08 (SPEC §29.1 adapter kalıbı).
 * Env'e göre doğru sağlayıcı kurulur; iyzico anahtarsız fail-fast.
 */
describe('createPaymentProvider (Faz 4 K-08)', () => {
  const IYZI_ENV = {
    PAYMENT_PROVIDER: 'iyzico',
    IYZICO_API_KEY: 'sandbox-key',
    IYZICO_SECRET_KEY: 'sandbox-secret',
    IYZICO_PRICING_PLAN_REF: 'plan-abc',
    IYZICO_MERCHANT_ID: 'merchant-1',
  } as NodeJS.ProcessEnv;

  it('PAYMENT_PROVIDER tanımsızsa mock döner (varsayılan)', () => {
    expect(createPaymentProvider({} as NodeJS.ProcessEnv)).toBeInstanceOf(MockPaymentProvider);
  });

  it('PAYMENT_PROVIDER=mock ise MockPaymentProvider döner', () => {
    expect(createPaymentProvider({ PAYMENT_PROVIDER: 'mock' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      MockPaymentProvider,
    );
  });

  it('PAYMENT_PROVIDER=manual ise mock havuzu döner (havale/EFT)', () => {
    expect(
      createPaymentProvider({ PAYMENT_PROVIDER: 'manual' } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(MockPaymentProvider);
  });

  it('PAYMENT_PROVIDER=iyzico anahtarlarla IyzicoPaymentProvider döner', () => {
    expect(createPaymentProvider(IYZI_ENV)).toBeInstanceOf(IyzicoPaymentProvider);
  });

  it('iyzico anahtarları eksikse fail-fast hata fırlatır', () => {
    expect(() =>
      createPaymentProvider({ PAYMENT_PROVIDER: 'iyzico' } as NodeJS.ProcessEnv),
    ).toThrow(/IYZICO_API_KEY/);
  });

  it('iyzico secret key eksikse fail-fast hata fırlatır', () => {
    expect(() =>
      createPaymentProvider({
        PAYMENT_PROVIDER: 'iyzico',
        IYZICO_API_KEY: 'k',
      } as NodeJS.ProcessEnv),
    ).toThrow(/IYZICO_SECRET_KEY/);
  });

  it('iyzico pricing plan ref eksikse fail-fast hata fırlatır', () => {
    expect(() =>
      createPaymentProvider({
        PAYMENT_PROVIDER: 'iyzico',
        IYZICO_API_KEY: 'k',
        IYZICO_SECRET_KEY: 's',
      } as NodeJS.ProcessEnv),
    ).toThrow(/IYZICO_PRICING_PLAN_REF/);
  });
});
