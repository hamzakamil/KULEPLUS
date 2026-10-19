import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InvoiceService } from '../src/modules/trade/invoice/service';
import { getPool } from '@kuleplus/db';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn() })),
  getTenantScope: vi.fn(() => null),
}));

type PostResult = {
  invoiceId: string;
  entryId: string | null;
  entryNo: number | null;
  alreadyPosted: boolean;
  totals?: { totalDebit: number; totalCredit: number };
};

describe('InvoiceService.postInvoice — otomatik muhasebeleştirme (Faz 3/5)', () => {
  let service: InvoiceService;
  let clientQuery: ReturnType<typeof vi.fn>;
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  const salesInvoice = {
    id: 'inv-1',
    type: 'sales',
    status: 'sent',
    posting_status: 'draft',
    number: 'FAT-2026-000000001',
    issue_date: '2026-10-01',
    subtotal: '1000',
    discount_total: '0',
    tax_total: '200',
    total: '1200',
    currency: 'TRY',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clientQuery = vi.fn();
    client = { query: clientQuery, release: vi.fn() };
    vi.mocked(getPool).mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(client),
    } as never);
    service = new InvoiceService();
  });

  function routeHappy(invoice: Record<string, unknown> = salesInvoice) {
    clientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim())) return Promise.resolve({ rows: [] });
      if (s.includes('FROM tenant_entitlements'))
        return Promise.resolve({ rows: [{ one: 1 }], rowCount: 1 }); // accounting aktif
      if (s.includes('FROM invoices') && s.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [invoice], rowCount: 1 });
      }
      if (s.includes('FROM accounting_accounts'))
        return Promise.resolve({ rows: [{ id: 'acc-1' }] });
      if (s.includes('FROM account_mappings')) return Promise.resolve({ rows: [] });
      if (s.includes('period_locks')) return Promise.resolve({ rows: [{ lock_date: null }] });
      if (s.includes('FROM fiscal_periods')) return Promise.resolve({ rows: [{ id: 'period-1', status: 'open' }] });
      if (s.includes('COUNT(*)') && s.includes('FROM accounting_accounts'))
        return Promise.resolve({ rows: [{ total: '1' }] });
      if (s.includes('FROM accounting_accounts'))
        return Promise.resolve({ rows: [{ id: 'acc-1' }] });
      if (s.includes('FROM account_mappings')) return Promise.resolve({ rows: [] });
      if (s.includes('pg_advisory_xact_lock')) return Promise.resolve({ rows: [] });
      if (s.includes('COALESCE(MAX(entry_no)'))
        return Promise.resolve({ rows: [{ next_no: '5' }] });
      return Promise.resolve({ rows: [] });
    });
  }

  it('satış faturası → dengeli fiş üretir, entryNo gap-free, posting_status güncellenir', async () => {
    routeHappy();
    const res = (await service.postInvoice('inv-1', 'user-1')) as PostResult;

    expect(res.alreadyPosted).toBe(false);
    expect(res.entryNo).toBe(5);
    expect(res.entryId).toBeTruthy();
    expect(res.totals?.totalDebit).toBe(1200);
    expect(res.totals?.totalCredit).toBe(1200);

    const inserted = clientQuery.mock.calls.some((c) =>
      String(c[0]).includes('INSERT INTO journal_entries'),
    );
    const updated = clientQuery.mock.calls.some((c) => String(c[0]).includes('UPDATE invoices'));
    expect(inserted).toBe(true);
    expect(updated).toBe(true);
  });

  it('idempotent: zaten posted ise yeni fiş üretmez, mevcut fişi döner', async () => {
    clientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim())) return Promise.resolve({ rows: [] });
      if (s.includes('FROM tenant_entitlements'))
        return Promise.resolve({ rows: [{ one: 1 }], rowCount: 1 }); // accounting aktif
      if (s.includes('FROM invoices') && s.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{ ...salesInvoice, posting_status: 'posted' }],
          rowCount: 1,
        });
      }
      if (s.includes('FROM journal_entries')) {
        return Promise.resolve({ rows: [{ id: 'je-1', entry_no: 3 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = (await service.postInvoice('inv-1', 'user-1')) as PostResult;
    expect(res.alreadyPosted).toBe(true);
    expect(res.entryId).toBe('je-1');
    expect(
      clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO journal_entries')),
    ).toBe(false);
  });

  it('desteklenmeyen belge türü → VALIDATION_ERROR', async () => {
    routeHappy({ ...salesInvoice, type: 'proforma' });
    await expect(service.postInvoice('inv-1', 'user-1')).rejects.toThrow(
      'otomatik muhasebeleştirme desteklenmiyor',
    );
  });

  it('fatura yoksa → NOT_FOUND', async () => {
    clientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim())) return Promise.resolve({ rows: [] });
      if (s.includes('FROM tenant_entitlements'))
        return Promise.resolve({ rows: [{ one: 1 }], rowCount: 1 }); // accounting aktif
      if (s.includes('FROM invoices') && s.includes('FOR UPDATE'))
        return Promise.resolve({ rows: [], rowCount: 0 });
      return Promise.resolve({ rows: [] });
    });
    await expect(service.postInvoice('yok', 'user-1')).rejects.toThrow('Fatura bulunamadı');
  });

  describe('addPayment — tahsilat/ödeme fişi (Faz 13/15)', () => {
    function routePayment(invoiceType: 'sales' | 'purchase') {
      clientQuery.mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('FROM tenant_entitlements'))
          return Promise.resolve({ rows: [{ one: 1 }], rowCount: 1 }); // accounting aktif
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim()))
          return Promise.resolve({ rows: [] });
        if (s.includes('FROM invoices')) {
          return Promise.resolve({
            rows: [
              {
                id: 'inv-1',
                number: 'FAT-2026-000000001',
                type: invoiceType,
                status: 'draft',
                posting_status: 'posted',
                total: '1200',
                paid_amount: '0',
                balance: '1200',
              },
            ],
            rowCount: 1,
          });
        }
        if (s.includes('COUNT(*)') && s.includes('FROM accounting_accounts'))
          return Promise.resolve({ rows: [{ total: '1' }] });
        if (s.includes('FROM accounting_accounts'))
          return Promise.resolve({ rows: [{ id: 'acc-1' }] });
        if (s.includes('FROM account_mappings')) return Promise.resolve({ rows: [] });
        if (s.includes('period_locks')) return Promise.resolve({ rows: [{ lock_date: null }] });
        if (s.includes('FROM fiscal_periods')) return Promise.resolve({ rows: [{ id: 'period-1', status: 'open' }] });
        if (s.includes('pg_advisory_xact_lock')) return Promise.resolve({ rows: [] });
        if (s.includes('COALESCE(MAX(entry_no)'))
          return Promise.resolve({ rows: [{ next_no: '9' }] });
        return Promise.resolve({ rows: [] });
      });
    }

    it('tahsilat → entry_type tahsil, tutar doğru, iki fiş satırı', async () => {
      routePayment('sales');
      await service.addPayment('inv-1', { amount: 500, payment_method: 'cash' } as never, 'user-1');

      const entryCall = clientQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO journal_entries'),
      );
      expect(entryCall).toBeTruthy();
      expect(entryCall![1][4]).toBe('tahsil');
      expect(entryCall![1][7]).toBe(500);

      const lineCalls = clientQuery.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO journal_lines'),
      );
      expect(lineCalls).toHaveLength(2);
    });

    it('tediye (alış) → entry_type tediye', async () => {
      routePayment('purchase');
      await service.addPayment(
        'inv-1',
        { amount: 300, payment_method: 'bank_transfer' } as never,
        'user-1',
      );

      const entryCall = clientQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO journal_entries'),
      );
      expect(entryCall![1][4]).toBe('tediye');
      expect(entryCall![1][7]).toBe(300);
    });
  });

  it('hesap planı yoksa (COUNT=0) TDHP otomatik bootstrap edilir ve fiş üretilir', async () => {
    clientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim())) return Promise.resolve({ rows: [] });
      if (s.includes('FROM tenant_entitlements'))
        return Promise.resolve({ rows: [{ one: 1 }], rowCount: 1 }); // accounting aktif
      if (s.includes('FROM invoices') && s.includes('FOR UPDATE'))
        return Promise.resolve({ rows: [salesInvoice], rowCount: 1 });
      if (s.includes('period_locks')) return Promise.resolve({ rows: [{ lock_date: null }] });
      if (s.includes('FROM fiscal_periods')) return Promise.resolve({ rows: [{ id: 'period-1', status: 'open' }] });
      if (s.includes('COUNT(*)') && s.includes('FROM accounting_accounts'))
        return Promise.resolve({ rows: [{ total: '0' }] });
      if (s.includes('FROM accounting_accounts'))
        return Promise.resolve({ rows: [{ id: 'acc-1' }] });
      if (s.includes('FROM account_mappings')) return Promise.resolve({ rows: [] });
      if (s.includes('pg_advisory_xact_lock')) return Promise.resolve({ rows: [] });
      if (s.includes('COALESCE(MAX(entry_no)'))
        return Promise.resolve({ rows: [{ next_no: '1' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = (await service.postInvoice('inv-1', 'user-1')) as PostResult;
    expect(res.alreadyPosted).toBe(false);
    const accountInserts = clientQuery.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO accounting_accounts'),
    );
    expect(accountInserts.length).toBeGreaterThan(100); // TDHP şablonu (~260 hesap)
  });
});
