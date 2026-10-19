import { describe, expect, it, vi, beforeEach } from 'vitest';
import { accountingService } from '../src/modules/accounting/service';
import { getPool } from '@kuleplus/db';

const sharedMockQuery = vi.fn();
const sharedMockClient = { query: sharedMockQuery, release: vi.fn() };
const sharedMockPool = {
  query: sharedMockQuery,
  connect: vi.fn().mockResolvedValue(sharedMockClient),
};

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
  })),
}));

/**
 * Muhasebe Fişleri servis testleri — GOVERNANCE §2 `accounting`.
 *
 * Servis metotları `withTenantClient` → `pool.connect()` → `client.query`
 * (BEGIN/COMMIT/ROLLBACK) akışını kullanır. Transaction/oturum sorguları
 * otomatik `{ rows: [] }` ile geçirilir; veri sorguları her testte kurulur.
 */
function useSharedPool() {
  vi.mocked(getPool).mockReturnValue(sharedMockPool as never);
  const route = (sql: unknown) => {
    const s = String(sql).trim();
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK' || s.includes('set_config')) {
      return Promise.resolve({ rows: [] });
    }
    return undefined;
  };
  sharedMockQuery.mockImplementation(route);
  return { mockQuery: sharedMockQuery, mockClient: sharedMockClient };
}

describe('AccountingService - Unit Tests', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sharedMockQuery.mockReset();
    sharedMockClient.query.mockReset();
    sharedMockClient.release.mockReset();
    sharedMockPool.connect.mockReset().mockResolvedValue(sharedMockClient);
    mockQuery = useSharedPool().mockQuery;
  });

  describe('listAccountingAccounts', () => {
    it('sayfalı hesap listesi döner (opening/balance Number’a çevrilir)', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '1' }] });
        return Promise.resolve({
          rows: [
            {
              id: 'a1',
              code: '100',
              name: 'Kasa',
              type: 'detail',
              is_tdphp: true,
              is_active: true,
              opening_debit: '150.50',
              opening_credit: '50.25',
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        });
      });

      const result = await accountingService.listAccountingAccounts({ page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].openingDebit).toBe(150.5);
      expect(result.items[0].openingBalance).toBe(100.25);
      expect(result.total).toBe(1);
    });

    it('hesap tipi filtresi SQL’e eklenir', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '0' }] });
        return Promise.resolve({ rows: [] });
      });

      await accountingService.listAccountingAccounts({ type: 'group' });

      const selectCall = mockQuery.mock.calls.find((c) =>
        String(c[0]).includes('accounting_accounts'),
      );
      expect(String(selectCall?.[0])).toContain('a.type = $');
    });
  });

  describe('getAccountById', () => {
    it('bulunamazsa null döner', async () => {
      mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
      expect(await accountingService.getAccountById('yok')).toBeNull();
    });
  });

  describe('createEntry', () => {
    const balancedInput = {
      entry_date: '2026-01-15',
      entry_type: 'mahsup',
      status: 'draft',
      description: 'Test fisi',
      lines: [
        { account_id: 'acc1', debit: 100, credit: 0 },
        { account_id: 'acc2', debit: 0, credit: 100 },
      ],
    } as const;

    it('draft fis olusturur (fis numarasi atanmaz)', async () => {
      mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
      const result = await accountingService.createEntry(balancedInput as never, 'user1');

      expect(result.id).toBeDefined();
      expect(result.status).toBe('draft');
      expect(result.entryNo).toBeNull();
    });

    it('onayli ve dengeli fisiye gap-free numara verir', async () => {
      mockQuery.mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('fiscal_periods')) {
          return Promise.resolve({ rows: [{ status: 'open', locked: null }] });
        }
        if (s.includes('COALESCE(MAX(entry_no)')) {
          return Promise.resolve({ rows: [{ next_no: '42' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await accountingService.createEntry(
        { ...balancedInput, status: 'posted' } as never,
        'user1',
      );

      expect(result.entryNo).toBe(42);
      expect(result.status).toBe('posted');
    });

    it('onayli ve dengesiz fisi reddeder (SPEC 10.5)', async () => {
      const bad = {
        ...balancedInput,
        status: 'posted',
        lines: [
          { account_id: 'acc1', debit: 100, credit: 0 },
          { account_id: 'acc2', debit: 0, credit: 50 },
        ],
      };

      await expect(accountingService.createEntry(bad as never, 'user1')).rejects.toThrow(
        'Fis dengeli degil',
      );
    });

    it('kapali doneme onayli fis yazamaz (PERIOD_LOCKED)', async () => {
      mockQuery.mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('period_locks')) {
          return Promise.resolve({ rows: [{ lock_date: null }] });
        }
        if (s.includes('fiscal_periods')) {
          return Promise.resolve({ rows: [{ id: 'period-1', status: 'closed', locked: null }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        accountingService.createEntry({ ...balancedInput, status: 'posted' } as never, 'user1'),
      ).rejects.toThrow('Bu mali dönem kapatılmış.');
    });
  });

  describe('Hesap / Fis guard’lari', () => {
    it('TDHP hesabi silinemez', async () => {
      mockQuery.mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('accounting_accounts')) {
          return Promise.resolve({ rows: [{ id: 'a1', is_tdphp: true }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(accountingService.deleteAccount('a1')).rejects.toThrow('TDHP hesabi silinemez');
    });

    it('onayli fisi silinemez', async () => {
      mockQuery.mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('journal_entries')) {
          return Promise.resolve({ rows: [{ id: 'e1', status: 'posted' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(accountingService.deleteEntry('e1')).rejects.toThrow(
        'Onayli fis silinemez; iptal edilir',
      );
    });

    it('ters kayit sadece onayli fise uygulanabilir', async () => {
      mockQuery.mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('journal_entries')) {
          return Promise.resolve({ rows: [{ id: 'e1', status: 'draft' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(accountingService.reverseEntry('e1', 'user1')).rejects.toThrow(
        'Yalnizca onayli fis ters kaydedilir',
      );
    });
  });

  describe('getNextEntryNo', () => {
    it('siradaki fisi numarasini dondurur', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COALESCE(MAX(entry_no)')) {
          return Promise.resolve({ rows: [{ next_no: '7' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      expect(await accountingService.getNextEntryNo()).toBe(7);
    });
  });

  describe('ensureChartOfAccounts', () => {
    it('hesap plani varsa 0 doner (idempotent)', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '30' }] });
        return Promise.resolve({ rows: [] });
      });

      expect(await accountingService.ensureChartOfAccounts()).toBe(0);
    });
  });
  describe('Muhasebe Raporları (Faz 5)', () => {
    it('trialBalance: borç/alacak toplamları ve denge', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('FROM accounting_accounts aa')) {
          return Promise.resolve({
            rows: [
              { code: '100', name: 'KASA', type: 'detail', debit: '1000', credit: '0' },
              { code: '600', name: 'YURTİÇİ SATIŞLAR', type: 'detail', debit: '0', credit: '1000' },
              { code: '999', name: 'HAREKETSİZ', type: 'detail', debit: '0', credit: '0' },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await accountingService.trialBalance({ from: '2026-01-01', to: '2026-12-31' });
      expect(result.totalDebit).toBe(1000);
      expect(result.totalCredit).toBe(1000);
      expect(result.balanced).toBe(true);
      // sıfır hareketli hesap listeye girmez
      expect(result.accounts.map((a) => a.code)).toEqual(['100', '600']);
      expect(result.accounts[0].balance).toBe(1000);
    });

    it('balanceSheet: aktif = pasif (dönem kârı dahil)', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('FROM accounting_accounts aa')) {
          return Promise.resolve({
            rows: [
              { code: '100', name: 'KASA', type: 'detail', debit: '1000', credit: '0' },
              { code: '600', name: 'YURTİÇİ SATIŞLAR', type: 'detail', debit: '0', credit: '1000' },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await accountingService.balanceSheet({ as_of: '2026-12-31' });
      expect(result.aktif.donenVarliklar).toBe(1000);
      expect(result.aktif.toplam).toBe(1000);
      expect(result.pasif.donemNetKar).toBe(1000);
      expect(result.pasif.toplam).toBe(1000);
      expect(result.balanced).toBe(true);
    });

    it('incomeStatement: brüt/faaliyet kârı ve net kâr', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('FROM accounting_accounts aa')) {
          return Promise.resolve({
            rows: [
              {
                code: '600',
                name: 'YURTİÇİ SATIŞLAR',
                type: 'detail',
                debit: '0',
                credit: '10000',
              },
              { code: '621', name: 'SMM', type: 'detail', debit: '4000', credit: '0' },
              { code: '632', name: 'GENEL YÖNETİM', type: 'detail', debit: '1000', credit: '0' },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await accountingService.incomeStatement({
        from: '2026-01-01',
        to: '2026-12-31',
      });
      expect(result.brutSatislar).toBe(10000);
      expect(result.satislarinMaliyeti).toBe(4000);
      expect(result.brutKar).toBe(6000);
      expect(result.faaliyetGiderleri).toBe(1000);
      expect(result.faaliyetKari).toBe(5000);
      expect(result.donemNetKari).toBe(5000);
    });
  });
});
