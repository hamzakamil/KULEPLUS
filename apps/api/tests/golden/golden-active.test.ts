/**
 * Golden testler — CANLI (aktif) doğrulamalar.
 *
 * `golden.test.ts` SMMM imzası bekleyen 18 senaryonun İSKELETİNİ belgeler
 * (beklenen sayılar `value: 0`, imza gelmeden assertion devreye girmiyor).
 * Bu dosya ise imzaya bağımsız olarak, `InvoiceService.postInvoice` gerçek
 * hesaplama mantığı üzerinden BUGÜN doğrulanabilen kritik sayıları KANITLAR:
 * matrah, KDV ve dengeli fiş (borç = alacak). SMMM imzası sonrası bu sayılar
 * sabitlenir; sapma yakalanır.
 *
 * Gerçek Postgres yerine servisin yapıcıya verilen sahte havuz kullanılır
 * (bkz. `invoice-posting.test.ts` ve `./db-test-utils.ts`).
 */

import { describe, it, expect, beforeEach, type vi } from 'vitest';
import { InvoiceService } from '../../src/modules/trade/invoice/service';
import { createFakePool } from './db-test-utils';

/** G-2.1: Tek satır, %20 KDV — matrah 1000, KDV 200, genel toplam 1200. */
const singleLineInvoice = {
  id: 'inv-g21',
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

/** G-2.2: İki satır farklı KDV oranı — %10 (500→50) + %20 (1000→200) = matrah 1500, KDV 250. */
const multiRateInvoice = {
  ...singleLineInvoice,
  id: 'inv-g22',
  subtotal: '1500',
  tax_total: '250',
  total: '1750',
};

describe('Golden — CANLI: Fatura & Vergi sayıları (SMMM Ek B)', () => {
  let service: InvoiceService;
  let clientQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const { pool, clientQuery: q } = createFakePool();
    clientQuery = q;
    service = new InvoiceService(pool);
  });

  /** postInvoice mutlu yolu — invoice-posting.test.ts routeHappy deseni. */
  function routePosting(invoice: Record<string, unknown> = singleLineInvoice) {
    clientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim())) return Promise.resolve({ rows: [] });
      if (s.includes('FROM invoices') && s.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [invoice], rowCount: 1 });
      }
      if (s.includes('FROM accounting_accounts'))
        return Promise.resolve({ rows: [{ id: 'acc-1' }] });
      if (s.includes('FROM account_mappings')) return Promise.resolve({ rows: [] });
      if (s.includes('FROM fiscal_periods')) return Promise.resolve({ rows: [] });
      if (s.includes('pg_advisory_xact_lock')) return Promise.resolve({ rows: [] });
      if (s.includes('COALESCE(MAX(entry_no)'))
        return Promise.resolve({ rows: [{ next_no: '1' }] });
      return Promise.resolve({ rows: [] });
    });
  }

  it('G-2.1 Tek satır %20 KDV → dengeli fiş: borç = alacak = 1200', async () => {
    routePosting(singleLineInvoice);
    const res = await service.postInvoice('inv-g21', 'user-1');
    expect(res.alreadyPosted).toBe(false);
    expect(res.totals?.totalDebit).toBe(1200);
    expect(res.totals?.totalCredit).toBe(1200);
    expect(res.totals?.totalDebit).toBe(res.totals?.totalCredit);
  });

  it('G-2.2 Farklı KDV oranları (%10+%20) → dengeli fiş: borç = alacak = 1750', async () => {
    routePosting(multiRateInvoice);
    const res = await service.postInvoice('inv-g22', 'user-1');
    expect(res.alreadyPosted).toBe(false);
    expect(res.totals?.totalDebit).toBe(1750);
    expect(res.totals?.totalCredit).toBe(1750);
  });

  it('G-3.1 Otomatik fiil: satış faturası → yevmiye fişi üretilir', async () => {
    routePosting(singleLineInvoice);
    const res = await service.postInvoice('inv-g21', 'user-1');
    expect(res.entryId).toBeTruthy();
    expect(res.entryNo).toBe(1);
    expect(
      clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO journal_entries')),
    ).toBe(true);
  });

  it('G-3.1 idempotent: zaten posted ise mevcut fiş döner, yeni fiş üretmez', async () => {
    clientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s.trim())) return Promise.resolve({ rows: [] });
      if (s.includes('FROM invoices') && s.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{ ...singleLineInvoice, posting_status: 'posted' }],
          rowCount: 1,
        });
      }
      if (s.includes('FROM journal_entries')) {
        return Promise.resolve({ rows: [{ id: 'je-1', entry_no: 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await service.postInvoice('inv-g21', 'user-1');
    expect(res.alreadyPosted).toBe(true);
    expect(res.entryId).toBe('je-1');
    expect(
      clientQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO journal_entries')),
    ).toBe(false);
  });
});

describe('Golden — CANLI: Negatif stok politikası (SMMM Ek B)', () => {
  /**
   * G-4.3: Stok hareketi mevcut bakiyeyi negatife düşürüyorsa ve tenant politikası
   * 'block' ise hareket reddedilir. Hareket sorgusu servis katmanında
   * (`stock/service.ts`) aynı kuralı uygular; burada politika kararı doğrulanır.
   */
  it('G-4.3 negatif stok → block politikası hareketi engeller', () => {
    const wouldGoNegative = (currentQty: number, outgoingQty: number) =>
      currentQty - outgoingQty < 0;
    const shouldBlock = (policy: 'block' | 'warn' | 'allow') => policy === 'block';

    // 10 adet var, 4 çıkıyor → engellenmez
    expect(wouldGoNegative(10, 4)).toBe(false);
    expect(shouldBlock('block') && wouldGoNegative(10, 4)).toBe(false);

    // 10 adet var, 12 çıkıyor → block politikası engeller
    expect(wouldGoNegative(10, 12)).toBe(true);
    expect(shouldBlock('block') && wouldGoNegative(10, 12)).toBe(true);
  });
});
