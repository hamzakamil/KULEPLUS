import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EInvoiceService } from '../src/modules/einvoice/einvoice-service';
import type { EInvoiceProvider } from '../src/modules/einvoice/einvoice-port';
import {
  einvoiceSendSchema,
  einvoiceStatusQuerySchema,
  einvoiceCancelSchema,
  einvoiceDownloadQuerySchema,
  einvoiceInboxQuerySchema,
} from '../src/modules/einvoice/einvoice-schemas';
import { getPool } from '@kuleplus/db';
import { newId } from '@kuleplus/shared';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

describe('EInvoiceService — unit', () => {
  const mockQuery = vi.fn();
  const service = new EInvoiceService();

  beforeEach(() => {
    vi.clearAllMocks();
    const mockPool = { query: mockQuery };
    vi.mocked(getPool).mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);
  });

  describe('enqueueSend', () => {
    it('outbox kaydına pending + doğru event bilgisi yazar', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const outboxId = await service.enqueueSend('t1', 'invoice', 'doc-1');

      const [[sql, params]] = mockQuery.mock.calls;
      expect(sql).toContain('INSERT INTO einvoice_outbox');
      expect(params).toEqual([
        outboxId,
        't1',
        'einvoice',
        'doc-1',
        'send',
        JSON.stringify({ sourceType: 'invoice' }),
        'pending',
        0,
        3,
      ]);
    });
  });

  describe('createDocument', () => {
    it('einvoice_documents satırını doğru değerlerle yazar (UUID v7, newId)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const docId = await service.createDocument('t1', {
        sourceType: 'invoice',
        sourceId: 'src-1',
        documentType: 'invoice',
        status: 'draft',
      });

      const [[sql, params]] = mockQuery.mock.calls;
      expect(sql).toContain('INSERT INTO einvoice_documents');
      expect(params?.[1]).toBe('t1');
      expect(params?.[5]).toBe('draft');
      // UUID v7 (zaman sıralı) — newId üzerinden üretilmeli, gen_random_uuid değil.
      expect(params?.[0]).toBe(docId);
      expect(newId()).not.toBe(docId.replace(/-/g, ''));
    });
  });

  describe('recordStatus', () => {
    it('status_events satırını uygulama tarafı üretilen id ile yazar (gen_random_uuid yasak, ADR-0002)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await service.recordStatus('doc-1', 'sent', '{"ok":true}');

      const [[sql, params]] = mockQuery.mock.calls;
      expect(sql).toContain('INSERT INTO einvoice_status_events');
      expect(sql).not.toContain('gen_random_uuid');
      expect(params?.[2]).toBe('sent');
      expect(navigatorUuidLike(params?.[0])).toBe(true);
    });
  });

  describe('getDocument', () => {
    it('tenant filtresiyle belge getirir', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'doc-1', tenant_id: 't1', status: 'sent' }],
      });
      const doc = await service.getDocument('t1', 'doc-1');

      const [[sql, params]] = mockQuery.mock.calls;
      expect(sql).toContain('WHERE id = $1 AND tenant_id = $2');
      expect(params).toEqual(['doc-1', 't1']);
      expect(doc?.status).toBe('sent');
    });

    it('bulunamazsa null döner', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const doc = await service.getDocument('t1', 'yok');
      expect(doc).toBeNull();
    });
  });
});

function navigatorUuidLike(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
}

describe('einvoice schemas — zod', () => {
  it('einvoiceSendSchema geçerli UUID + kaynak tipi kabul eder', () => {
    const out = einvoiceSendSchema.parse({
      sourceType: 'invoice',
      sourceId: '11111111-1111-4111-8111-111111111111',
    });
    expect(out.sourceType).toBe('invoice');
  });

  it('einvoiceSendSchema geçersiz kaynak tipini reddeder', () => {
    expect(() =>
      einvoiceSendSchema.parse({
        sourceType: 'makale',
        sourceId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toThrow();
  });

  it('einvoiceStatusQuerySchema sayfalama defaultlarını uygular', () => {
    const out = einvoiceStatusQuerySchema.parse({});
    expect(out.page).toBe(1);
    expect(out.limit).toBe(20);
  });

  it('einvoiceCancelSchema neden zorunludur', () => {
    expect(() => einvoiceCancelSchema.parse({})).toThrow();
  });

  it('einvoiceDownloadQuerySchema varsayılan format xml', () => {
    expect(einvoiceDownloadQuerySchema.parse({}).format).toBe('xml');
    expect(einvoiceDownloadQuerySchema.parse({ format: 'pdf' }).format).toBe('pdf');
    expect(() => einvoiceDownloadQuerySchema.parse({ format: 'exe' })).toThrow();
  });

  it('einvoiceInboxQuerySchema sayfalama + yön filter uygular', () => {
    const out = einvoiceInboxQuerySchema.parse({ direction: 'incoming' });
    expect(out.direction).toBe('incoming');
    expect(out.page).toBe(1);
    expect(out.limit).toBe(20);
    expect(() => einvoiceInboxQuerySchema.parse({ direction: 'sideways' })).toThrow();
  });
});

describe('EInvoiceService — inbox & download & cancel', () => {
  const mockQuery = vi.fn();

  /** EInvoiceProvider sözleşmesini karşılayan fake; testler override eder. */
  function fakeProvider(overrides: Partial<EInvoiceProvider> = {}): EInvoiceProvider {
    return {
      sendInvoice: vi.fn(async () => ({ success: true })),
      queryStatus: vi.fn(async () => ({ status: 'sent' })),
      cancelInvoice: vi.fn(async () => ({ success: true })),
      listInbox: vi.fn(async () => []),
      downloadDocument: vi.fn(async () => ({ xml: Buffer.from('<Invoice/>') })),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    const mockPool = { query: mockQuery };
    vi.mocked(getPool).mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);
  });

  describe('listInbox', () => {
    it('tenant + yön filtresi + sayfalama ile einvoice_inbox sorgular', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'i1', external_invoice_id: 'GIB-1', direction: 'incoming' }],
      });
      const svc = new EInvoiceService();
      const res = await svc.listInbox('t1', { direction: 'incoming', page: 2, limit: 10 });

      const [[sql, params]] = mockQuery.mock.calls;
      expect(String(sql)).toContain('FROM einvoice_inbox');
      expect(String(sql)).toContain('tenant_id = $1');
      expect(String(sql)).toContain('direction = $2');
      expect(String(sql)).toContain('ORDER BY received_at DESC');
      expect(String(sql)).toContain('LIMIT $3 OFFSET $4');
      expect(params).toEqual(['t1', 'incoming', 10, 10]);
      expect(res).toHaveLength(1);
    });

    it('yön verilmezse yalnızca tenant filtresi uygular', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const svc = new EInvoiceService();
      await svc.listInbox('t1', { page: 1, limit: 20 });

      const [[sql, params]] = mockQuery.mock.calls;
      expect(String(sql)).not.toContain('direction =');
      expect(params).toEqual(['t1', 20, 0]);
    });
  });

  describe('storeInbox / syncInbox', () => {
    it('storeInbox idempotent upsert kullanır (UNIQUE external_invoice_id+direction)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const svc = new EInvoiceService();
      await svc.storeInbox('t1', {
        id: 'x',
        external_invoice_id: 'GIB-1',
        direction: 'incoming',
        document_type: 'invoice',
        title: 'Alış Faturası 1',
        received_at: new Date('2026-10-01T00:00:00Z'),
        payload: '<Invoice/>',
      });

      const [[sql, params]] = mockQuery.mock.calls;
      expect(String(sql)).toContain('INSERT INTO einvoice_inbox');
      expect(String(sql)).toContain('ON CONFLICT (external_invoice_id, direction) DO UPDATE');
      expect(params?.[1]).toBe('t1');
      expect(params?.[2]).toBe('GIB-1');
      expect(params?.[3]).toBe('incoming');
    });

    it('syncInbox provider kayıtlarını saklar ve sayıyı döner', async () => {
      const listInbox = vi.fn(async () => [
        {
          id: 'a',
          external_invoice_id: 'GIB-1',
          direction: 'incoming' as const,
          document_type: 'invoice',
          title: 'A',
          received_at: new Date(),
          payload: '<A/>',
        },
        {
          id: 'b',
          external_invoice_id: 'GIB-2',
          direction: 'incoming' as const,
          document_type: 'invoice',
          title: 'B',
          received_at: new Date(),
          payload: '<B/>',
        },
      ]);
      mockQuery.mockResolvedValue({ rows: [] });
      const svc = new EInvoiceService(fakeProvider({ listInbox }));

      const result = await svc.syncInbox('t1');

      expect(result.inserted).toBe(2);
      expect(result.syncedAt).toBeTruthy();
      expect(listInbox).toHaveBeenCalledWith(50, 0);
      expect(mockQuery.mock.calls.length).toBe(2);
    });
  });

  describe('downloadDocument', () => {
    it('saklanan xml_payload önceliklidir; provider çağrılmaz', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'doc-1', tenant_id: 't1', xml_payload: '<Invoice>stored</Invoice>' }],
      });
      const downloadDocument = vi.fn();
      const svc = new EInvoiceService(fakeProvider({ downloadDocument }));

      const file = await svc.downloadDocument('t1', 'doc-1', 'xml');

      expect(file.contentType).toBe('application/xml');
      expect(file.filename).toBe('einvoice-doc-1.xml');
      expect(file.data.toString('utf8')).toContain('stored');
      expect(downloadDocument).not.toHaveBeenCalled();
    });

    it('payload yoksa provider.pdf döner', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'doc-1', tenant_id: 't1', xml_payload: null }],
      });
      const downloadDocument = vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.4 fake') }));
      const svc = new EInvoiceService(fakeProvider({ downloadDocument }));

      const file = await svc.downloadDocument('t1', 'doc-1', 'pdf');

      expect(file.contentType).toBe('application/pdf');
      expect(file.data.toString('utf8')).toContain('%PDF');
      expect(downloadDocument).toHaveBeenCalledWith('doc-1');
    });

    it('belge yoksa NOT_FOUND', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const svc = new EInvoiceService();
      await expect(svc.downloadDocument('t1', 'yok', 'xml')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('cancelDocument', () => {
    it('external id varsa sağlayıcıya bildirir + yerel durumu günceller + olay kaydeder', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'doc-1', tenant_id: 't1', external_invoice_id: 'GIB-1', status: 'sent' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const cancelInvoice = vi.fn(async () => ({ success: true, message: 'ok' }));
      const svc = new EInvoiceService(fakeProvider({ cancelInvoice }));

      const result = await svc.cancelDocument('t1', 'doc-1', 'yanlış tutar');

      expect(cancelInvoice).toHaveBeenCalledWith('doc-1');
      expect(result.success).toBe(true);
      expect(result.provider_response).toContain('ok');
      const calls = mockQuery.mock.calls;
      expect(String(calls[1][0])).toContain('UPDATE einvoice_documents SET status');
      expect(String(calls[2][0])).toContain('INSERT INTO einvoice_status_events');
      expect(String(calls[2][0])).toContain('provider');
    });

    it('external id yoksa sağlayıcı çağrılmaz; yerel iptal olur', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'doc-2', tenant_id: 't1', external_invoice_id: null, status: 'draft' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const cancelInvoice = vi.fn();
      const svc = new EInvoiceService(fakeProvider({ cancelInvoice }));

      await svc.cancelDocument('t1', 'doc-2', 'gereksiz');

      expect(cancelInvoice).not.toHaveBeenCalled();
      expect(String(mockQuery.mock.calls[1][0])).toContain("status = 'cancelled'");
    });

    it('sağlayıcı iptali onaylamazsa EXTERNAL_SERVICE_ERROR; yerel durum değişmez', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'doc-3', tenant_id: 't1', external_invoice_id: 'GIB-3', status: 'sent' }],
      });
      const cancelInvoice = vi.fn(async () => ({ success: false, message: 'reddedildi' }));
      const svc = new EInvoiceService(fakeProvider({ cancelInvoice }));

      await expect(svc.cancelDocument('t1', 'doc-3', 'neden')).rejects.toMatchObject({
        code: 'EXTERNAL_SERVICE_ERROR',
      });
      // UPDATE asla çağrılmaz — yerel durum korunur.
      expect(mockQuery.mock.calls.length).toBe(1);
    });
  });
});
