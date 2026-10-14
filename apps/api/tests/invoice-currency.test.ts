import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InvoiceService } from '../src/modules/trade/invoice/service';
import { getPool } from '@kuleplus/db';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn() })),
  getTenantScope: vi.fn(() => null),
}));

describe('InvoiceService — dövizli fatura / çoklu para birimi (SPEC §9.2)', () => {
  let service: InvoiceService;
  let clientQuery: ReturnType<typeof vi.fn>;
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let poolQuery: ReturnType<typeof vi.fn>;

  const baseInvoiceRow = {
    id: 'inv-1',
    number: 'FAT-2026-000000001',
    type: 'sales',
    status: 'draft',
    currency: 'TRY',
    exchange_rate: 1,
    rate_date: null,
    subtotal: '100',
    discount_total: '0',
    tax_total: '0',
    total: '100',
    balance: '100',
    base_total: '100',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clientQuery = vi.fn();
    client = { query: clientQuery, release: vi.fn() };
    poolQuery = vi.fn((sql: string) => {
      const s = String(sql);
      if (s.includes('FROM invoices')) return Promise.resolve({ rows: [baseInvoiceRow] });
      if (s.includes('FROM invoice_lines')) return Promise.resolve({ rows: [] });
      if (s.includes('FROM invoice_payments')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    vi.mocked(getPool).mockReturnValue({
      query: poolQuery,
      connect: vi.fn().mockResolvedValue(client),
    } as never);
    service = new InvoiceService();
  });

  /** createInvoice akışını mocklar; döviz kuru davranışını `rateRoutes` ile özelleştir. */
  function routeCreate(invoiceRow: Record<string, unknown> = baseInvoiceRow, rateRoutes = true) {
    clientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      const t = s.trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(t)) return Promise.resolve({ rows: [] });
      // INSERT'ten önce yakala: INSERT sorgusunun içinde FROM invoice_sequences alt sorgusu vardır.
      if (s.includes('INSERT INTO invoices')) {
        return Promise.resolve({ rows: [{ ...invoiceRow, id: 'inv-1' }] });
      }
      // sequence seed (INSERT ... WHERE NOT EXISTS) ve takip (UPDATE ... RETURNING)
      if (s.includes('FROM invoice_sequences')) return Promise.resolve({ rows: [] });
      if (s.toUpperCase().includes('UPDATE INVOICE_SEQUENCES')) {
        return Promise.resolve({ rows: [{ prefix: 'FAT', current_number: 1 }], rowCount: 1 });
      }
      // otomatik kur çözme (resolveInvoiceRate)
      if (s.includes('current_tenant_id() AS tid')) return Promise.resolve({ rows: [{ tid: 'tenant-1' }] });
      if (s.includes('FROM exchange_rates')) {
        return rateRoutes
          ? Promise.resolve({ rows: [{ rate: '33.5', rate_date: '2026-10-01' }] })
          : Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  function insertInvoiceParams(): unknown[] {
    const call = clientQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO invoices'));
    if (!call) throw new Error('INSERT INTO invoices çağrısı bulunamadı');
    return call[1] as unknown[];
  }

  it('TRY fatura → exchange_rate 1, rate_date NULL yazılır', async () => {
    routeCreate();
    await service.createInvoice({
      type: 'sales',
      currency: 'TRY',
      lines: [{ description: 'Test', quantity: 1, unit_price: 100, discount_percent: 0 }],
    });

    const p = insertInvoiceParams();
    expect(p[8]).toBe('TRY'); // invoiceCurrency
    expect(p[9]).toBe(1); // exchangeRate
    expect(p[10]).toBeNull(); // rateDate (TRY → anlamsız)
  });
  it('dövizli fatura + kullanıcı kuru verdi → kur sabitlenir, rate_date = issue_date', async () => {
    routeCreate();
    await service.createInvoice({
      type: 'sales',
      currency: 'USD',
      exchange_rate: 34.2,
      issue_date: '2026-10-01',
      lines: [{ description: 'Test', quantity: 1, unit_price: 100, discount_percent: 0 }],
    });

    const p = insertInvoiceParams();
    expect(p[8]).toBe('USD');
    expect(p[9]).toBe(34.2);
    expect(p[10]).toBe('2026-10-01');
  });

  it('dövizli fatura + kur verilmedi → TCMB kuru otomatik çözülür', async () => {
    routeCreate();
    await service.createInvoice({
      type: 'sales',
      currency: 'USD',
      issue_date: '2026-10-01',
      lines: [{ description: 'Test', quantity: 1, unit_price: 100, discount_percent: 0 }],
    });

    const p = insertInvoiceParams();
    expect(p[8]).toBe('USD');
    expect(p[9]).toBe(33.5); // getRate'ten gelen kur
    expect(p[10]).toBe('2026-10-01');
  });

  it('dövizli fatura + kur hiç yok → VALIDATION_ERROR', async () => {
    routeCreate(baseInvoiceRow, false); // exchange_rates boş
    await expect(
      service.createInvoice({
        type: 'sales',
        currency: 'USD',
        issue_date: '2026-10-01',
        lines: [{ description: 'Test', quantity: 1, unit_price: 100, discount_percent: 0 }],
      }),
    ).rejects.toThrow('kur bulunamadı');
  });

  describe('postInvoice — dövizli faturanın TRY karşılıkla muhasebeleştirilmesi', () => {
    it('USD fatura → fiş tutarları TRY karşılık (base) ile dengelenir', async () => {
      const invoice = {
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
        currency: 'USD',
        exchange_rate: '32.5',
        base_total: '39000',
      };

      clientQuery.mockImplementation((sql: string) => {
        const s = String(sql);
        const t = s.trim();
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(t)) return Promise.resolve({ rows: [] });
        if (s.includes('FROM invoices') && s.includes('FOR UPDATE')) {
          return Promise.resolve({ rows: [invoice], rowCount: 1 });
        }
        if (s.includes('FROM fiscal_periods')) return Promise.resolve({ rows: [] });
        if (s.includes('COUNT(*)') && s.includes('FROM accounting_accounts'))
          return Promise.resolve({ rows: [{ total: '1' }] });
        if (s.includes('FROM accounting_accounts')) return Promise.resolve({ rows: [{ id: 'acc-1' }] });
        if (s.includes('FROM account_mappings')) return Promise.resolve({ rows: [] });
        if (s.includes('pg_advisory_xact_lock')) return Promise.resolve({ rows: [] });
        if (s.includes('COALESCE(MAX(entry_no)')) return Promise.resolve({ rows: [{ next_no: '5' }] });
        return Promise.resolve({ rows: [] });
      });

      const res = (await service.postInvoice('inv-1', 'user-1')) as {
        totals?: { totalDebit: number; totalCredit: number };
      };

      // 1200 USD × 32.5 = 39000 TRY — fiş TRY karşılıkla dengeli olmalı
      expect(res.totals?.totalDebit).toBe(39000);
      expect(res.totals?.totalCredit).toBe(39000);

      const inserted = clientQuery.mock.calls.some((c) =>
        String(c[0]).includes('INSERT INTO journal_entries'),
      );
      expect(inserted).toBe(true);
    });
  });
});

