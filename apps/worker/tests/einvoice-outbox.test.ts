import { describe, expect, it, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { Job } from 'bullmq';
import {
  createEInvoiceOutboxHandler,
  createEInvoiceMockProvider,
  type EInvoiceOutboxJob,
  type WorkerEInvoicePort,
} from '../src/handlers';

/**
 * Faz 4 Hat A — uçtan uca e-Dönüşüm gönderim döngüsü (SPEC §21.2, ADR-0020).
 * createDocument → enqueueSend → worker (einvoice-outbox) → belge `sent`.
 *
 * `@kuleplus/db` yerine in-memory fake kullanılır; worker handler'ı gerçek SQL regex'lerini
 * sürmez, tablolar arası geçişi (einvoice_outbox / einvoice_documents / einvoice_status_events)
 * ve idempotency/retry mantığını doğrularız.
 */

const mem = vi.hoisted(() => ({
  documents: [] as Array<Record<string, unknown>>,
  outbox: [] as Array<Record<string, unknown>>,
  statusEvents: [] as Array<Record<string, unknown>>,
  getPool: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('@kuleplus/db', () => ({ getPool: mem.getPool, withTenant: mem.withTenant }));

const logger = pino({ level: 'silent' });

function fakeJob<T>(data: T, id = 'job-einvoice-1') {
  return { id, data } as unknown as Job<T>;
}

/** Worker handler'ın ürettiği SQL'leri in-memory state üzerinde işleyen basit router. */
function runFakeSql(sql: string, params: unknown[] = []): { rows: Array<Record<string, unknown>> } {
  const s = sql.replace(/\s+/g, ' ').trim();

  if (s.includes('SELECT') && s.includes('FROM einvoice_outbox')) {
    let rows = mem.outbox.filter(
      (o) => o.status === 'pending' && (o.attempts as number) < (o.max_attempts as number),
    );
    if (s.includes('WHERE id = $1')) rows = rows.filter((o) => o.id === params[0]);
    const limit =
      typeof params[params.length - 1] === 'number'
        ? Number(params[params.length - 1])
        : rows.length;
    return { rows: rows.slice(0, limit).map((o) => ({ ...o })) };
  }

  if (s.includes('SELECT') && s.includes('FROM einvoice_documents')) {
    const rows = mem.documents.filter((d) => d.id === params[0] && d.tenant_id === params[1]);
    return { rows: rows.map((d) => ({ ...d })) };
  }

  if (s.includes('INSERT INTO einvoice_status_events')) {
    mem.statusEvents.push({
      id: params[0],
      document_id: params[1],
      status: params[2],
      provider_response: params[3] ?? null,
    });
    return { rows: [] };
  }

  if (s.includes('UPDATE einvoice_outbox')) {
    const o = mem.outbox.find((x) => x.id === params[0]);
    if (!o) return { rows: [] };
    if (s.includes('RETURNING attempts')) {
      return { rows: [{ attempts: o.attempts, max_attempts: o.max_attempts }] };
    }
    if (s.includes("status = 'sent'")) {
      o.status = 'sent';
      o.provider_response = params[1] ?? null;
    } else if (s.includes("status = 'failed'")) {
      o.status = 'failed';
      o.attempts = (o.attempts as number) + 1;
    } else if (s.includes('attempts = attempts + 1')) {
      o.attempts = (o.attempts as number) + 1;
    }
    return { rows: [] };
  }

  if (s.includes('UPDATE einvoice_documents')) {
    const d = mem.documents.find((x) => x.id === params[0]);
    if (!d) return { rows: [] };
    if (s.includes("status = 'pending'")) {
      d.status = 'pending';
    } else {
      d.status = params[1];
      d.external_invoice_id = params[2] ?? d.external_invoice_id ?? null;
      d.provider_response = params[3] ?? null;
    }
    return { rows: [] };
  }

  throw new Error(`Desteklenmeyen SQL (test fake): ${s}`);
}

function setupFakes() {
  mem.documents.length = 0;
  mem.outbox.length = 0;
  mem.statusEvents.length = 0;
  const router = async (sql: string, params?: unknown[]) => runFakeSql(sql, params ?? []);
  mem.getPool.mockReturnValue({ query: router });
  mem.withTenant.mockImplementation(
    async (
      _pool: unknown,
      _tenantId: string,
      fn: (c: { query: typeof router }) => Promise<unknown>,
    ) => fn({ query: router }),
  );
}

function seedDoc(id: string, tenantId: string, status = 'draft') {
  mem.documents.push({
    id,
    tenant_id: tenantId,
    source_type: 'invoice',
    source_id: 'src-1',
    document_type: 'invoice',
    status,
    external_invoice_id: null,
    provider_response: null,
    attempts: 0,
    max_attempts: 3,
  });
}

function seedOutbox(
  id: string,
  tenantId: string,
  entityId: string,
  opts: { attempts?: number; maxAttempts?: number } = {},
) {
  mem.outbox.push({
    id,
    tenant_id: tenantId,
    entity_id: entityId,
    event_type: 'send',
    payload: JSON.stringify({ sourceType: 'invoice' }),
    status: 'pending',
    attempts: opts.attempts ?? 0,
    max_attempts: opts.maxAttempts ?? 3,
  });
}

describe('createEInvoiceMockProvider — idempotent sözleşme (SPEC §29.1)', () => {
  it('aynı documentId ikinci kez gönderilirse önceki sonucu döner', async () => {
    const provider = createEInvoiceMockProvider();
    const first = await provider.sendDocument('doc-1', {});
    const second = await provider.sendDocument('doc-1', {});
    expect(second).toEqual(first);
    expect(second.external_invoice_id).toBe(first.external_invoice_id);
    expect(second.status).toBe('sent');
  });
});

describe('uçtan uca e-Dönüşüm gönderim döngüsü (SPEC §21.2)', () => {
  beforeEach(() => {
    setupFakes();
  });

  it('bekleyen outbox → belge sent, outbox sent, status_event yazılır; provider 1 kez çağrılır', async () => {
    seedDoc('doc-1', 't1');
    seedOutbox('ob-1', 't1', 'doc-1');

    const provider = createEInvoiceMockProvider();
    const sendSpy = vi.spyOn(provider, 'sendDocument');
    const handler = createEInvoiceOutboxHandler({ logger, einvoice: provider });

    await handler(fakeJob<EInvoiceOutboxJob>({}));

    const doc = mem.documents[0];
    const ob = mem.outbox[0];
    expect(doc.status).toBe('sent');
    expect(String(doc.external_invoice_id)).toMatch(/^MOCK-/);
    expect(ob.status).toBe('sent');
    expect(mem.statusEvents).toHaveLength(1);
    expect(mem.statusEvents[0].status).toBe('sent');
    expect(mem.statusEvents[0].document_id).toBe('doc-1');
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith('doc-1', { sourceType: 'invoice' });
  });

  it('idempotent: işlenen kayıt ikinci çalıştırmada yeniden gönderilmez', async () => {
    seedDoc('doc-1', 't1');
    seedOutbox('ob-1', 't1', 'doc-1');

    const provider = createEInvoiceMockProvider();
    const sendSpy = vi.spyOn(provider, 'sendDocument');
    const handler = createEInvoiceOutboxHandler({ logger, einvoice: provider });

    await handler(fakeJob<EInvoiceOutboxJob>({}));
    await handler(fakeJob<EInvoiceOutboxJob>({}));

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(mem.statusEvents).toHaveLength(1);
  });

  it('provider success:false dönerse hata fırlar ve max_attempts aşılınca outbox failed olur', async () => {
    seedDoc('doc-1', 't1');
    seedOutbox('ob-1', 't1', 'doc-1', { maxAttempts: 1 });

    const provider: WorkerEInvoicePort = {
      sendDocument: vi.fn(async () => ({ success: false, message: 'GİB reddetti' })),
    };
    const handler = createEInvoiceOutboxHandler({ logger, einvoice: provider });

    await expect(handler(fakeJob<EInvoiceOutboxJob>({}))).rejects.toThrow('GİB reddetti');

    const ob = mem.outbox[0];
    expect(ob.status).toBe('failed');
    expect(ob.attempts).toBe(2); // 1 (ön gönderim) + 1 (failed işaretleme)
    expect(mem.documents[0].status).toBe('pending');
    expect(mem.statusEvents).toHaveLength(0);
  });

  it('provider exception atarsa (ağ hatası) retry için yeniden fırlatılır; max_attempts aşılmadıysa pending kalır', async () => {
    seedDoc('doc-1', 't1');
    seedOutbox('ob-1', 't1', 'doc-1', { attempts: 0, maxAttempts: 3 });

    const provider: WorkerEInvoicePort = {
      sendDocument: vi.fn(async () => {
        throw new Error('Sağlayıcı timeout — belirsiz sonuç, önce durum sorgulanmalı (SPEC §21.2)');
      }),
    };
    const handler = createEInvoiceOutboxHandler({ logger, einvoice: provider });

    await expect(handler(fakeJob<EInvoiceOutboxJob>({}))).rejects.toThrow('timeout');

    const ob = mem.outbox[0];
    expect(ob.status).toBe('pending'); // max_attempts 3 > attempts 1
    expect(ob.attempts).toBe(1);
  });

  it('yetim kayıt: belge yoksa outbox failed işaretlenir, hata fırlatılmaz, provider çağrılmaz', async () => {
    seedOutbox('ob-orphan', 't1', 'doc-yok');

    const provider = createEInvoiceMockProvider();
    const sendSpy = vi.spyOn(provider, 'sendDocument');
    const handler = createEInvoiceOutboxHandler({ logger, einvoice: provider });

    await expect(handler(fakeJob<EInvoiceOutboxJob>({}))).resolves.toBeUndefined();

    const ob = mem.outbox[0];
    expect(ob.status).toBe('failed');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(mem.statusEvents).toHaveLength(0);
  });

  it('einvoice provider verilmezse mock fallback devreye girer (belge sent olur)', async () => {
    seedDoc('doc-1', 't1');
    seedOutbox('ob-1', 't1', 'doc-1');

    const handler = createEInvoiceOutboxHandler({ logger, einvoice: undefined });
    await handler(fakeJob<EInvoiceOutboxJob>({}));

    expect(mem.documents[0].status).toBe('sent');
    expect(mem.outbox[0].status).toBe('sent');
    expect(mem.statusEvents).toHaveLength(1);
  });
});
