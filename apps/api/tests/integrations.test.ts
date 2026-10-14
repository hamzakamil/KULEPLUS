import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { IntegrationService, verifyHmacSignature } from '../src/modules/integrations/service';
import { getPool } from '@kuleplus/db';

/**
 * Integrations servis testleri — GOVERNANCE §2 `integrations` (Faz 8, SPEC §20).
 *
 * Servis lazy pool kullanır (stock deseni): constructor'a mock pool verilebilir
 * veya `getPool('app')` ile sağlanır. `verifyHmacSignature` GERÇEK crypto ile
 * çalıştığı için imzalar testte hesaplanıp doğrulanır (mock değil).
 */

const mockQuery = vi.fn();
const mockPool = { query: mockQuery, connect: vi.fn() };

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(),
}));

/** HMAC-SHA256 hex imzası üret (verifyHmacSignature karşısı için). */
function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyHmacSignature (SPEC §20)', () => {
  const secret = 'whsec_test_123';
  const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded' });

  it('geçerli imza → true', () => {
    expect(verifyHmacSignature({ rawBody: body, signature: sign(secret, body), secret })).toBe(
      true,
    );
  });

  it('sha256= önekli imza → true (önek soyulur)', () => {
    const signature = `sha256=${sign(secret, body)}`;
    expect(verifyHmacSignature({ rawBody: body, signature, secret })).toBe(true);
  });

  it('yanlış imza → false', () => {
    expect(verifyHmacSignature({ rawBody: body, signature: 'deadbeef', secret })).toBe(false);
  });

  it('farklı secret ile üretilmiş imza → false', () => {
    expect(
      verifyHmacSignature({ rawBody: body, signature: sign('whsec_OTHER', body), secret }),
    ).toBe(false);
  });

  it('gövde değiştiğinde imza geçersiz → false', () => {
    const signature = sign(secret, body);
    const tampered = body.replace('evt_1', 'evt_2');
    expect(verifyHmacSignature({ rawBody: tampered, signature, secret })).toBe(false);
  });

  it('uzunluk uyuşmazlığında güvenli false döner (timingSafeEqual patlamaz)', () => {
    const signature = sign(secret, body);
    expect(verifyHmacSignature({ rawBody: body, signature: signature.slice(0, -4), secret })).toBe(
      false,
    );
    expect(verifyHmacSignature({ rawBody: body, signature: signature + 'ff', secret })).toBe(false);
  });
});

describe('IntegrationService — CRUD', () => {
  let service: IntegrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockPool.connect.mockReset();
    vi.mocked(getPool).mockReturnValue(mockPool as never);
    service = new IntegrationService(mockPool as never);
  });

  it('createIntegration: INSERT üretir, tenant + kaydı döner', async () => {
    const row = {
      id: 'int_1',
      tenant_id: 't1',
      provider: 'stripe',
      display_name: 'Stripe',
      is_active: true,
      created_at: '2026-10-13T00:00:00Z',
      updated_at: '2026-10-13T00:00:00Z',
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await service.createIntegration('t1', 'stripe', 'Stripe');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO integrations');
    expect(sql).toContain('RETURNING *');
    expect(params).toEqual([expect.any(String), 't1', 'stripe', 'Stripe']);
    expect(result).toEqual(row);
  });

  it('listIntegrations: tenant kapsamı + sıralama SQL üretir', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await service.listIntegrations('t1');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM integrations');
    expect(sql).toContain('tenant_id = $1');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(params).toEqual(['t1']);
  });

  it('getIntegration: tenant + id kapsamlı sorgu', async () => {
    const row = { id: 'int_1', tenant_id: 't1' };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await service.getIntegration('t1', 'int_1');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE tenant_id = $1 AND id = $2');
    expect(params).toEqual(['t1', 'int_1']);

    describe('IntegrationService — webhook olayları (idempotent)', () => {
      let service: IntegrationService;

      beforeEach(() => {
        vi.clearAllMocks();
        mockQuery.mockReset();
        mockPool.connect.mockReset();
        vi.mocked(getPool).mockReturnValue(mockPool as never);
        service = new IntegrationService(mockPool as never);
      });

      it('recordWebhookEvent: ilk olay INSERT ... ON CONFLICT DO NOTHING ile kaydedilir', async () => {
        const row = {
          id: 'evt_row_1',
          tenant_id: 't1',
          integration_id: 'int_1',
          external_event_id: 'ext_1',
          event_type: 'payment.succeeded',
          payload: { amount: 100 },
          signature: 'sig',
          processed_at: null,
          created_at: '2026-10-13T00:00:00Z',
        };
        mockQuery.mockResolvedValueOnce({ rows: [row] });

        const result = await service.recordWebhookEvent({
          tenantId: 't1',
          integrationId: 'int_1',
          externalEventId: 'ext_1',
          eventType: 'payment.succeeded',
          payload: { amount: 100 },
          signature: 'sig',
        });

        const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('INSERT INTO webhook_events');
        expect(sql).toContain('ON CONFLICT (integration_id, external_event_id) DO NOTHING');
        expect(sql).toContain('RETURNING *');
        expect(params[1]).toBe('t1');
        expect(params[2]).toBe('int_1');
        expect(params[3]).toBe('ext_1');
        expect(params[4]).toBe('payment.succeeded');
        expect(params[5]).toBe(JSON.stringify({ amount: 100 }));
        expect(result).toEqual(row);
        expect(mockQuery).toHaveBeenCalledTimes(1);
      });

      it('recordWebhookEvent: yinelenen olayda mevcut kayıt döner (idempotent)', async () => {
        const existing = {
          id: 'evt_row_1',
          tenant_id: 't1',
          integration_id: 'int_1',
          external_event_id: 'ext_1',
        };
        mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT → ON CONFLICT DO NOTHING → boş
        mockQuery.mockResolvedValueOnce({ rows: [existing] }); // fallback SELECT → mevcut kayıt

        const result = await service.recordWebhookEvent({
          tenantId: 't1',
          integrationId: 'int_1',
          externalEventId: 'ext_1',
          eventType: 'payment.succeeded',
          payload: { amount: 100 },
        });

        expect(result).toEqual(existing);
        expect(mockQuery).toHaveBeenCalledTimes(2);
        const [sql] = mockQuery.mock.calls[1] as [string];
        expect(sql).toContain('SELECT * FROM webhook_events');
        expect(sql).toContain('WHERE integration_id = $1 AND external_event_id = $2');
      });

      it('listWebhookEvents: tenant + integration kapsamlı, sıralı, limitli', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await service.listWebhookEvents('t1', 'int_1', 25);

        const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('FROM webhook_events');
        expect(sql).toContain('WHERE tenant_id = $1 AND integration_id = $2');
        expect(sql).toContain('ORDER BY created_at DESC');
        expect(sql).toContain('LIMIT $3');
        expect(params).toEqual(['t1', 'int_1', 25]);
      });

      it('getPendingEvents: yalnızca işlenmemiş (processed_at IS NULL) olaylar', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await service.getPendingEvents('t1', 'int_1', 10);

        const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('processed_at IS NULL');
        expect(sql).toContain('ORDER BY created_at ASC');
        expect(params).toEqual(['t1', 'int_1', 10]);
      });

      it('markEventProcessed: processed_at = now() güncellemesi', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await service.markEventProcessed('t1', 'evt_row_1');

        const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('UPDATE webhook_events SET processed_at = now()');
        expect(sql).toContain('WHERE tenant_id = $1 AND id = $2');
        expect(params).toEqual(['t1', 'evt_row_1']);
      });
    });

    describe('IntegrationService — harici eşleştirmeler', () => {
      let service: IntegrationService;

      beforeEach(() => {
        vi.clearAllMocks();
        mockQuery.mockReset();
        mockPool.connect.mockReset();
        vi.mocked(getPool).mockReturnValue(mockPool as never);
        service = new IntegrationService(mockPool as never);
      });

      it('findMapping: dörtlü kapsam (tenant, integration, external_id, internal_type)', async () => {
        const row = {
          id: 'map_1',
          tenant_id: 't1',
          integration_id: 'int_1',
          external_id: 'ext_cus',
          internal_type: 'contact',
          internal_id: 'c1',
        };
        mockQuery.mockResolvedValueOnce({ rows: [row] });

        const result = await service.findMapping('t1', 'int_1', 'ext_cus', 'contact');

        const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('FROM external_mappings');
        expect(sql).toContain(
          'WHERE tenant_id = $1 AND integration_id = $2 AND external_id = $3 AND internal_type = $4',
        );
        expect(params).toEqual(['t1', 'int_1', 'ext_cus', 'contact']);
        expect(result).toEqual(row);
      });

      it('findMapping: bulunamazsa null', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        expect(await service.findMapping('t1', 'int_1', 'yok', 'contact')).toBeNull();
      });

      it('createMapping: INSERT üretir ve kaydı döner', async () => {
        const row = {
          id: 'map_1',
          tenant_id: 't1',
          integration_id: 'int_1',
          external_id: 'ext_cus',
          internal_type: 'contact',
          internal_id: 'c1',
        };
        mockQuery.mockResolvedValueOnce({ rows: [row] });

        const result = await service.createMapping('t1', 'int_1', 'ext_cus', 'contact', 'c1');

        const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('INSERT INTO external_mappings');
        expect(sql).toContain('RETURNING *');
        expect(params).toEqual([expect.any(String), 't1', 'int_1', 'ext_cus', 'contact', 'c1']);
        expect(result).toEqual(row);
      });
    });

    expect(result).toEqual(row);
  });

  it('getIntegration: bulunamazsa null döner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await service.getIntegration('t1', 'yok')).toBeNull();
  });

  it('deactivateIntegration: is_active=false + updated_at günceller', async () => {
    const row = { id: 'int_1', tenant_id: 't1', is_active: false };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await service.deactivateIntegration('t1', 'int_1');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE integrations SET is_active = false');
    expect(sql).toContain('WHERE tenant_id = $1 AND id = $2');
    expect(params).toEqual(['t1', 'int_1']);
    expect(result).toEqual(row);
  });

  it('deactivateIntegration: bulunamazsa null döner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await service.deactivateIntegration('t1', 'yok')).toBeNull();
  });
});
