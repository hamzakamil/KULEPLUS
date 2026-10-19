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
      // updateInvoice kilidi (lockInvoice): FOR UPDATE'li fatura sorgusu, diğer dallardan ÖNCE yakalanır.
      if (s.includes('FROM invoices') && s.includes('FOR UPDATE') && s.includes('posting_status')) {
        return Promise.resolve({
          rows: [{ id: 'inv-1', number: 'INV-1', type: 'sales', status: 'draft', posting_status: 'draft', paid_amount: '0' }],
          rowCount: 1,
        });
      }
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
      if (s.includes('current_tenant_id() AS tid'))
        return Promise.resolve({ rows: [{ tid: 'tenant-1' }] });
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
        if (s.includes('FROM tenant_entitlements'))
          return Promise.resolve({ rows: [{ one: 1 }], rowCount: 1 }); // accounting aktif
        if (s.includes('FROM invoices') && s.includes('FOR UPDATE')) {
          return Promise.resolve({ rows: [invoice], rowCount: 1 });
        }
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

  describe('updateInvoice — dövize geçişte otomatik kur / TRY dönüşünde kur 1', () => {
    it('dövize geçiş + kur verilmedi → çözülen kur ve rate_date UPDATE e yazılmalı', async () => {
      routeCreate();
      await service.updateInvoice('inv-1', { currency: 'USD', rate_date: '2026-10-01' }, 'user-1');

      const upCall = clientQuery.mock.calls.find((c) => {
        const t = String(c[0]).trim().toUpperCase();
        return t.startsWith('UPDATE INVOICES ');
      });
      expect(upCall).toBeTruthy();
      // values içinde çözülen kur ve rate_date olmalı (sıra Object.entries sırasına bağlı, deterministik değil)
      expect(upCall![1]).toContain('USD');
      expect(upCall![1]).toContain(33.5); // çözülen kur
      expect(upCall![1]).toContain('2026-10-01'); // çözülen kur tarihi
      expect(String(upCall![0])).toContain('exchange_rate');
      expect(String(upCall![0])).toContain('rate_date');
    });

    it('dövize geçiş + kullanıcı kuru verildi → kullanıcı kuru korunur, otomatik çözülmez', async () => {
      routeCreate();
      await service.updateInvoice('inv-1', { currency: 'EUR', exchange_rate: 40.25 }, 'user-1');

      const exchangeCalls = clientQuery.mock.calls.filter((c) =>
        String(c[0]).includes('FROM exchange_rates'),
      );
      expect(exchangeCalls).toHaveLength(0); // resolveInvoiceRate tetiklenmemeli

      const upCall = clientQuery.mock.calls.find((c) => {
        const t = String(c[0]).trim().toUpperCase();
        return t.startsWith('UPDATE INVOICES ');
      });
      expect(upCall![1]).toStrictEqual(['inv-1', 'EUR', 40.25]);
    });

    it('TRYye dönüş → kur 1 e sabitlenir, rate_date null olarak yazılır', async () => {
      routeCreate();
      await service.updateInvoice('inv-1', { currency: 'TRY' }, 'user-1');

      const upCall = clientQuery.mock.calls.find((c) => {
        const t = String(c[0]).trim().toUpperCase();
        return t.startsWith('UPDATE INVOICES ');
      });
      expect(upCall![1]).toStrictEqual(['inv-1', 'TRY', 1, null]);
    });
  });

  describe('addPayment — dövizli faturada tahsilat fişi TRY karşılıkla dengelenir', () => {
    function routePayment() {
      clientQuery.mockImplementation((sql: string) => {
        const s = String(sql);
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim()))
          return Promise.resolve({ rows: [] });
        if (s.includes('FROM tenant_entitlements'))
          return Promise.resolve({ rows: [{ one: 1 }], rowCount: 1 }); // accounting aktif
        if (s.includes('FROM invoices')) {
          return Promise.resolve({
            rows: [
              {
                id: 'inv-1',
                number: 'FAT-2026-000000001',
                type: 'sales',
                status: 'draft',
                posting_status: 'posted',
                total: '1200',
                paid_amount: '0',
                balance: '1200',
                currency: 'USD',
                exchange_rate: '32.5',
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

    it('400 USD tahsilat → fiş 13000 TRY (400 × 32.5) ile dengeli, ödeme belge PB sinde kayıtlı', async () => {
      routePayment();
      await service.addPayment('inv-1', { amount: 400, payment_method: 'cash' } as never, 'user-1');

      const payCall = clientQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO invoice_payments'),
      );
      expect(payCall![1][2]).toBe(400); // invoice_payments.amount = belge para birimi (USD)

      const entryCall = clientQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO journal_entries'),
      );
      expect(entryCall![1]).toBeTruthy();
      expect(entryCall![1][7]).toBe(13000); // total_debit = TRY karşılık (satırlardan)
      expect(entryCall![1][8]).toBe(13000); // total_credit = total_debit (dengeli)
      expect(entryCall![1][9]).toBe('user-1'); // posted_by

      const lineCalls = clientQuery.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO journal_lines'),
      );
      expect(lineCalls).toHaveLength(2);
      expect(lineCalls[0][1][5]).toBe(13000); // debit kasa
      expect(lineCalls[0][1][6]).toBe(0);
      expect(lineCalls[1][1][5]).toBe(0);
      expect(lineCalls[1][1][6]).toBe(13000); // credit 120 (Alıcılar)

      const updateCall = clientQuery.mock.calls.find((c) => {
        const t = String(c[0]).trim().toUpperCase();
        return t.startsWith('UPDATE INVOICES ');
      });
      expect(updateCall![1][0]).toBe(400); // paid_amount belge PB sinde (total ile aynı birim)
      expect(updateCall![1][1]).toBe(800); // balance 1200 - 400
    });

    /** Kur farkı senaryoları: ödeme günü kuru TCMB'den çözülür (rate), fatura kuru sabit 32.5. */
    function routePaymentWithRate(rate: string, type: 'sales' | 'purchase' = 'sales') {
      clientQuery.mockImplementation((sql: string) => {
        const s = String(sql);
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim()))
          return Promise.resolve({ rows: [] });
        if (s.includes('FROM tenant_entitlements'))
          return Promise.resolve({ rows: [{ one: 1 }], rowCount: 1 }); // accounting aktif
        if (s.includes('current_tenant_id() AS tid'))
          return Promise.resolve({ rows: [{ tid: 'tenant-1' }] });
        if (s.includes('FROM invoices')) {
          return Promise.resolve({
            rows: [
              {
                id: 'inv-1',
                number: 'FAT-2026-000000001',
                type,
                status: 'draft',
                posting_status: 'posted',
                total: '1200',
                paid_amount: '0',
                balance: '1200',
                currency: 'USD',
                exchange_rate: '32.5',
              },
            ],
            rowCount: 1,
          });
        }
        if (s.includes('FROM exchange_rates'))
          return Promise.resolve({ rows: [{ rate, rate_date: '2026-10-02' }] });
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

    it('tahsilatta ödeme günü kuru daha yüksekse kur farkı kambiyo kârı olarak 646 hesabına yazılır', async () => {
      routePaymentWithRate('33');
      await service.addPayment('inv-1', { amount: 400, payment_method: 'cash' } as never, 'user-1');

      // Ödeme TRY karşılığı ödeme günü kuruyla: 400 × 33 = 13200; cari kapanışı fatura kuruyla:
      // 400 × 32.5 = 13000; fark 200 → kambiyo kârı (646 credit).
      const payCall = clientQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO invoice_payments'),
      );
      expect(payCall![1][2]).toBe(400); // belge PB
      expect(payCall![1][7]).toBe(33); // ödeme kuru kalıcı
      expect(payCall![1][8]).toBe(13200); // TRY karşılık kalıcı

      const entryCall = clientQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO journal_entries'),
      );
      expect(entryCall![1][7]).toBe(13200); // dengeli fiş (borç = alacak)

      const lineCalls = clientQuery.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO journal_lines'),
      );
      expect(lineCalls).toHaveLength(3);
      expect(lineCalls[0][1][5]).toBe(13200); // kasa borç
      expect(lineCalls[0][1][6]).toBe(0);
      expect(lineCalls[1][1][5]).toBe(0);
      expect(lineCalls[1][1][6]).toBe(13000); // 120 kapanış (fatura kuru)
      expect(lineCalls[2][1][5]).toBe(0);
      expect(lineCalls[2][1][6]).toBe(200); // 646 kambiyo kârı
    });

    it('tahsilatta ödeme günü kuru daha düşükse kur farkı kambiyo zararı olarak 656 e yazılır', async () => {
      routePaymentWithRate('32');
      await service.addPayment('inv-1', { amount: 400, payment_method: 'cash' } as never, 'user-1');

      const lineCalls = clientQuery.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO journal_lines'),
      );
      expect(lineCalls).toHaveLength(3);
      expect(lineCalls[0][1][5]).toBe(12800); // kasa borç (400 × 32)
      expect(lineCalls[0][1][6]).toBe(0);
      expect(lineCalls[1][1][5]).toBe(0);
      expect(lineCalls[1][1][6]).toBe(13000); // 120 kapanış
      expect(lineCalls[2][1][5]).toBe(200); // 656 kambiyo zararı borç
      expect(lineCalls[2][1][6]).toBe(0);
    });

    it('tediyede kur arttıysa ödenen fazla TL kambiyo zararı (656) olur', async () => {
      routePaymentWithRate('33', 'purchase');
      await service.addPayment(
        'inv-1',
        { amount: 400, payment_method: 'bank_transfer' } as never,
        'user-1',
      );

      const lineCalls = clientQuery.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO journal_lines'),
      );
      expect(lineCalls).toHaveLength(3);
      expect(lineCalls[0][1][5]).toBe(13000); // 320 borç (fatura kuru kapanışı)
      expect(lineCalls[0][1][6]).toBe(0);
      expect(lineCalls[1][1][5]).toBe(0);
      expect(lineCalls[1][1][6]).toBe(13200); // banka alacak (ödeme günü kuru)
      expect(lineCalls[2][1][5]).toBe(200); // 656 kambiyo zararı
      expect(lineCalls[2][1][6]).toBe(0);
    });
  });
});
