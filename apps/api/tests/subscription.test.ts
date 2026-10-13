import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SubscriptionService } from '../src/modules/subscription/service';
import { getPool } from '@kuleplus/db';
import type { PaymentProvider } from '@kuleplus/shared';

/**
 * Subscription servis testleri — GOVERNANCE §2 `subscription` (Faz 4 Hat B).
 *
 * Servis `withTenantClient` → `pool.connect()` → `client.query`
 * (BEGIN/COMMIT/ROLLBACK) akışını kullanır. Transaction/oturum sorguları
 * otomatik `{ rows: [] }` ile geçirilir; veri sorguları her testte kurulur.
 */

const sharedMockQuery = vi.fn();
const sharedMockClient = { query: sharedMockQuery, release: vi.fn() };
const sharedMockPool = {
  query: sharedMockQuery,
  connect: vi.fn().mockResolvedValue(sharedMockClient),
};

vi.mock('@kuleplus/db', () => ({ getPool: vi.fn() }));

function useSharedPool() {
  vi.mocked(getPool).mockReturnValue(sharedMockPool as never);
  // Varsayılan: BILINMEYEN her sorgu boş `{ rows: [] }` döner (transaction akışı dahil).
  // Testler ihtiyaç duydukları sorguyu `mockImplementation` ile özelleştirir.
  sharedMockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
}

const ORDER_ROW = {
  id: 'o1',
  tenant_id: 't1',
  order_no: 'SIP-2026-0001',
  plan_version_id: 'pv1',
  amount: '149.90',
  currency: 'TRY',
  status: 'pending',
};

describe('SubscriptionService — tablo sürücüsü CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedMockQuery.mockReset();
    sharedMockClient.query.mockReset();
    sharedMockClient.release.mockReset();
    sharedMockPool.connect.mockReset().mockResolvedValue(sharedMockClient);
    useSharedPool();
  });

  it('liste: tenant kapsamı + sıralama + sayfalama SQL üretir', async () => {
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    const page = await service.listResource(
      { table: 'subscriptions', columns: ['id', 'status', 'created_at'], tenantId: 't1' },
      { page: 2, limit: 25 },
    );

    const call = sharedMockQuery.mock.calls.find((c) =>
      String(c[0]).includes('"subscriptions"'),
    ) as [string, unknown[]];
    expect(call[0]).toContain('tenant_id = current_tenant_id()');
    expect(call[0]).toContain('ORDER BY created_at DESC');
    expect(call[0]).toContain('OFFSET $1 LIMIT $2');
    expect(call[1]).toEqual([25, 25]);
    expect(page).toMatchObject({ page: 2, limit: 25, total: 0 });
  });

  it('liste: global kaynakta (coupons) tenant filtresi YOKTUR', async () => {
    sharedMockQuery.mockReturnValueOnce(Promise.resolve({ rows: [] }));
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await service.listResource(
      { table: 'coupons', columns: ['id', 'code'], global: true, tenantId: 't1' },
      { page: 1, limit: 50 },
    );

    const call = sharedMockQuery.mock.calls.find((c) => String(c[0]).includes('"coupons"'));
    expect(String(call?.[0])).not.toContain('current_tenant_id');
  });

  it('liste: alt kaynak üst kayıt kimliğiyle daralır', async () => {
    sharedMockQuery.mockReturnValueOnce(Promise.resolve({ rows: [] }));
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await service.listResource(
      {
        table: 'subscription_items',
        columns: ['id', 'module_code'],
        tenantId: 't1',
        parentColumn: 'subscription_id',
        parentId: 'sub-1',
      },
      { page: 1, limit: 10 },
    );

    const call = sharedMockQuery.mock.calls.find((c) =>
      String(c[0]).includes('"subscription_items"'),
    ) as [string, unknown[]];
    expect(call[0]).toContain('"subscription_id" = $1');
    expect(call[1][0]).toBe('sub-1');
  });

  it('create: id üretir, whitelist dışı alanları YAZMAZ', async () => {
    sharedMockQuery.mockReturnValueOnce(
      Promise.resolve({ rows: [{ id: 'c1', code: 'KUP10', discount_type: 'percent' }] }),
    );
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await service.createResource({
      table: 'coupons',
      columns: ['id', 'code', 'discount_type', 'is_active'],
      global: true,
      data: { code: 'KUP10', discount_type: 'percent', is_active: true, sizdirmaca: 'x' },
    });

    const call = sharedMockQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO "coupons"'),
    ) as [string, unknown[]];
    expect(String(call[0])).not.toContain('sizdirmaca');
    expect(call[1]).toContain('KUP10');
  });

  it('update: kayıt yoksa NOT_FOUND', async () => {
    sharedMockQuery.mockReturnValue(Promise.resolve({ rows: [] }));
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await expect(
      service.updateResource({
        table: 'subscriptions',
        columns: ['status'],
        data: { status: 'cancelled' },
        id: 'yok',
        tenantId: 't1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('update: boş gövde VALIDATION_ERROR', async () => {
    // Seçim sorgusu mevcut satırı döner; boş gövde güncellemede reddedilir.
    sharedMockQuery.mockImplementation(() =>
      Promise.resolve({ rows: [{ id: 's1', tenant_id: 't1', status: 'active' }] }),
    );
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await expect(
      service.updateResource({
        table: 'subscriptions',
        columns: ['status'],
        data: {},
        id: 's1',
        tenantId: 't1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('delete: kayıt yoksa NOT_FOUND', async () => {
    sharedMockQuery.mockReturnValue(Promise.resolve({ rows: [] }));
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await expect(
      service.deleteResource({ table: 'partners', columns: ['id'], global: true, id: 'yok' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/** Checkout çok adımlı akış içerir → sorguyu içeriğe göre yönlendirir. */
function routeBySql(handlers: Array<[RegExp, () => Promise<{ rows: unknown[] }>]>) {
  sharedMockQuery.mockImplementation((sql: unknown) => {
    const s = String(sql);
    for (const [pattern, factory] of handlers) {
      if (pattern.test(s)) return factory();
    }
    return Promise.resolve({ rows: [] });
  });
}

const PRICING_ROW = {
  plan_code: 'pro',
  plan_name: 'Pro Plan',
  amount_monthly: '149.90',
  currency: 'TRY',
  vat_included: true,
};

const CHECKOUT_INPUT = {
  orderId: 'o1',
  provider: 'mock',
  providerCustomerRef: 'cust-1',
  userId: 'u1',
  tenantId: 't1',
};

function resetPool() {
  vi.clearAllMocks();
  sharedMockQuery.mockReset();
  sharedMockClient.query.mockReset();
  sharedMockClient.release.mockReset();
  sharedMockPool.connect.mockReset().mockResolvedValue(sharedMockClient);
  useSharedPool();
}

describe('SubscriptionService — checkout (SPEC §8.6 aktivasyon zinciri)', () => {
  beforeEach(resetPool);

  const orderHandlers = (row: Record<string, unknown> | null) =>
    [
      [/FROM "commercial_orders"/, () => Promise.resolve({ rows: row ? [row] : [] })],
      [/FROM plans p/, () => Promise.resolve({ rows: [PRICING_ROW] })],
    ] as Array<[RegExp, () => Promise<{ rows: unknown[] }>]>;

  it('sipariş yoksa NOT_FOUND', async () => {
    routeBySql([[/FROM "commercial_orders"/, () => Promise.resolve({ rows: [] })]]);
    const service = new SubscriptionService({ pool: sharedMockPool as never });
    await expect(service.checkout(CHECKOUT_INPUT)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("sipariş 'pending' değilse VALIDATION_ERROR (çift tahsilat engeli)", async () => {
    routeBySql(orderHandlers({ ...ORDER_ROW, status: 'paid' }));
    const service = new SubscriptionService({ pool: sharedMockPool as never });
    await expect(service.checkout(CHECKOUT_INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('plan fiyatı tanımsızsa (K-03 bekliyor) VALIDATION_ERROR', async () => {
    routeBySql([
      [/FROM "commercial_orders"/, () => Promise.resolve({ rows: [ORDER_ROW] })],
      [/FROM plans p/, () => Promise.resolve({ rows: [] })],
    ]);
    const service = new SubscriptionService({ pool: sharedMockPool as never });
    await expect(service.checkout(CHECKOUT_INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('tahsilat başarılı → fatura + ödeme + sipariş paid', async () => {
    routeBySql(orderHandlers(ORDER_ROW));
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    const result = await service.checkout(CHECKOUT_INPUT);

    expect(result.status).toBe('paid');
    expect(result.invoiceId).toBeDefined();
    const sqls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('INSERT INTO payment_attempts'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO billing_invoices'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO billing_invoice_lines'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO billing_payments'))).toBe(true);
    expect(sqls.some((s) => s.includes("UPDATE commercial_orders SET status = 'paid'"))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO audit_logs'))).toBe(true);
    const invoiceCall = sharedMockQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO billing_invoices'),
    ) as [string, unknown[]];
    expect(invoiceCall[1]).toContain(`FAT-${ORDER_ROW.order_no}`);
  });

  it('kart reddi → deneme failed, fatura OLUŞMAZ', async () => {
    routeBySql(orderHandlers({ ...ORDER_ROW, amount: '0' })); // Mock: tutar <= 0 → ret
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    const result = await service.checkout(CHECKOUT_INPUT);

    expect(result.status).toBe('failed');
    expect(result.invoiceId).toBeUndefined();
    const sqls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('INSERT INTO billing_invoices'))).toBe(false);
    expect(sqls.some((s) => s.includes("UPDATE commercial_orders SET status = 'failed'"))).toBe(
      true,
    );
  });
});
// ======================= İade (SPEC §8.7) =======================

/** İade/eşleştirme testlarının ödeme satırı (`billing_payments`). */
const PAYMENT_ROW = {
  id: 'p1',
  order_id: 'o1',
  amount: '149.90',
  currency: 'TRY',
  status: 'succeeded',
  provider_ref: 'MOCK-PAY-1',
};

/** Eşleştirme testlarının fatura satırı (`billing_invoices`). */
const INVOICE_ROW = { id: 'i1', total: '149.90', currency: 'TRY', status: 'issued' };

/** İadesi her zaman başarılı olan sağlayıcı portu. */
const refundOkProvider = {
  refund: vi.fn().mockResolvedValue({ providerRef: 'MOCK-PAY-1', status: 'refunded' }),
} as unknown as PaymentProvider;

/** İade bakiyesi sorgusu iki kez çalışır: iade ÖNCESİ ve İADE SONRASI toplam. */
function refundSql(before: string, after: string) {
  let sumCalls = 0;
  sharedMockQuery.mockImplementation((sql: unknown) => {
    const s = String(sql);
    if (s.includes('FROM "billing_payments"')) return Promise.resolve({ rows: [PAYMENT_ROW] });
    if (s.includes('FROM billing_refunds')) {
      sumCalls += 1;
      return Promise.resolve({ rows: [{ refunded: sumCalls === 1 ? before : after }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('SubscriptionService — iade (SPEC §8.7 ödeme durumları)', () => {
  beforeEach(resetPool);

  it('iade: ödeme yoksa NOT_FOUND', async () => {
    routeBySql([[/FROM "billing_payments"/, () => Promise.resolve({ rows: [] })]]);
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await expect(
      service.refundPayment({ paymentId: 'p1', userId: 'u1', tenantId: 't1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("iade: ödeme 'succeeded' değilse VALIDATION_ERROR", async () => {
    routeBySql([
      [
        /FROM "billing_payments"/,
        () => Promise.resolve({ rows: [{ ...PAYMENT_ROW, status: 'failed' }] }),
      ],
    ]);
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await expect(
      service.refundPayment({ paymentId: 'p1', userId: 'u1', tenantId: 't1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('iade: ödeme tamamen iade edilmişse VALIDATION_ERROR (çift iade engeli)', async () => {
    refundSql('149.90', '149.90');
    const service = new SubscriptionService({
      pool: sharedMockPool as never,
      paymentProvider: refundOkProvider,
    });

    await expect(
      service.refundPayment({ paymentId: 'p1', userId: 'u1', tenantId: 't1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('iade: tutar iade edilebilir bakiyeyi aşarsa VALIDATION_ERROR', async () => {
    refundSql('100.00', '100.00');
    const service = new SubscriptionService({
      pool: sharedMockPool as never,
      paymentProvider: refundOkProvider,
    });

    await expect(
      service.refundPayment({ paymentId: 'p1', amount: '60.00', userId: 'u1', tenantId: 't1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('iade: TAM iade → refund kaydı + ödeme `refunded` + sipariş `refunded`', async () => {
    refundSql('0', '149.90');
    const service = new SubscriptionService({
      pool: sharedMockPool as never,
      paymentProvider: refundOkProvider,
    });

    const result = await service.refundPayment({
      paymentId: 'p1',
      reason: 'İptal talebi',
      userId: 'u1',
      tenantId: 't1',
    });

    expect(result.status).toBe('succeeded');
    expect(result.amount).toBe('149.90000000');
    expect(result.paymentStatus).toBe('refunded');

    const sqls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('INSERT INTO billing_refunds'))).toBe(true);
    expect(sqls.some((s) => s.includes('UPDATE billing_payments SET status = $2'))).toBe(true);
    expect(
      sqls.some((s) => s.includes("UPDATE commercial_orders SET status = 'refunded'")),
    ).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO audit_logs'))).toBe(true);

    const updateCall = sharedMockQuery.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE billing_payments SET status'),
    ) as [string, unknown[]];
    expect(updateCall[1]).toContain('refunded');
  });

  it('iade: KISMI iade → ödeme `partially_refunded`, sipariş durumu değişmez', async () => {
    refundSql('0', '50.00');
    const service = new SubscriptionService({
      pool: sharedMockPool as never,
      paymentProvider: refundOkProvider,
    });

    const result = await service.refundPayment({
      paymentId: 'p1',
      amount: '50.00',
      userId: 'u1',
      tenantId: 't1',
    });

    expect(result.status).toBe('succeeded');
    expect(result.paymentStatus).toBe('partially_refunded');

    const sqls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(
      sqls.some((s) => s.includes("UPDATE commercial_orders SET status = 'refunded'")),
    ).toBe(false);
  });
});


// ======================= Fatura/alacak eşleştirme (SPEC §8.6) =======================

describe('SubscriptionService — fatura/alacak eşleştirme (SPEC §8.6)', () => {
  beforeEach(resetPool);

  const allocationHandlers = (allocated: string, invoice: Record<string, unknown> | null) =>
    [
      [/FROM "billing_payments"/, () => Promise.resolve({ rows: [PAYMENT_ROW] })],
      [/FROM "billing_invoices"/, () => Promise.resolve({ rows: invoice ? [invoice] : [] })],
      [/FROM billing_allocations/, () => Promise.resolve({ rows: [{ allocated }] })],
    ] as Array<[RegExp, () => Promise<{ rows: unknown[] }>]>;

  it('eşleştirme: fatura yoksa NOT_FOUND', async () => {
    routeBySql(allocationHandlers('0', null));
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await expect(
      service.allocatePayment({ paymentId: 'p1', invoiceId: 'i1', userId: 'u1', tenantId: 't1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('eşleştirme: fatura bakiyesi kalmamışsa VALIDATION_ERROR', async () => {
    routeBySql(allocationHandlers('149.90', INVOICE_ROW));
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await expect(
      service.allocatePayment({ paymentId: 'p1', invoiceId: 'i1', userId: 'u1', tenantId: 't1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('eşleştirme: başarılı → billing_allocations + audit kaydı, kalan bakiye döner', async () => {
    routeBySql(allocationHandlers('0', INVOICE_ROW));
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    const result = await service.allocatePayment({
      paymentId: 'p1',
      invoiceId: 'i1',
      amount: '99.90',
      userId: 'u1',
      tenantId: 't1',
    });

    expect(result.allocationId).toBeDefined();
    expect(result.remaining).toBe('50.00000000');
    const sqls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('INSERT INTO billing_allocations'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO audit_logs'))).toBe(true);
  });

  it('checkout: tahsilat faturaya eşleştirilir (SPEC §8.6 alacak adımı)', async () => {
    routeBySql([
      [/FROM "commercial_orders"/, () => Promise.resolve({ rows: [ORDER_ROW] })],
      [/FROM plans p/, () => Promise.resolve({ rows: [PRICING_ROW] })],
    ]);
    const service = new SubscriptionService({ pool: sharedMockPool as never });

    await service.checkout(CHECKOUT_INPUT);

    const sqls = sharedMockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('INSERT INTO billing_allocations'))).toBe(true);
  });
});

