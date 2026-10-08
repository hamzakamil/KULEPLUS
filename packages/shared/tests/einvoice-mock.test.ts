import { describe, expect, it } from 'vitest';
import { MockEInvoiceProvider } from '../src/integrations/mock';
import type { InvoiceSnapshot } from '../src/integrations/ports';

function snapshot(id: string): InvoiceSnapshot {
  return {
    id,
    tenantId: 'tenant-1',
    series: 'TST',
    number: '1',
    issueDate: '2026-10-05',
    currency: 'TRY',
    totalAmount: '1190.00000000',
    taxAmount: '190.00000000',
  };
}

describe('MockEInvoiceProvider — SPEC §21.1 sözleşmesi', () => {
  it('send yeni belge için referans üretir', async () => {
    const provider = new MockEInvoiceProvider();
    const result = await provider.send(snapshot('inv-1'));
    expect(result.providerRef).toMatch(/^MOCK-/);
    expect(result.status).toBe('sent');
  });

  it('send idempotenttir: aynı invoice.id ikinci kez önceki sonucu döner', async () => {
    const provider = new MockEInvoiceProvider();
    const first = await provider.send(snapshot('inv-1'));
    const second = await provider.send(snapshot('inv-1'));
    expect(second).toEqual(first);
    expect(provider.sentCount()).toBe(1);
  });

  it('belirsiz referansta queryStatus error döner, exception fırlatmaz (§29.1 Liskov)', async () => {
    const provider = new MockEInvoiceProvider();
    await expect(provider.send(snapshot('inv-1'))).resolves.toBeDefined();
    const unknown = await provider.queryStatus('YOK-000');
    expect(unknown.status).toBe('error');
  });

  it('cancel bilinen referansı iptal eder', async () => {
    const provider = new MockEInvoiceProvider();
    const { providerRef } = await provider.send(snapshot('inv-1'));
    const cancelled = await provider.cancel(providerRef, 'test iptali');
    expect(cancelled.status).toBe('cancelled');
    const status = await provider.queryStatus(providerRef);
    expect(status.status).toBe('cancelled');
  });

  it('fetchInbox boş liste döner (mock)', async () => {
    const provider = new MockEInvoiceProvider();
    await expect(provider.fetchInbox(new Date())).resolves.toEqual([]);
  });
});
