import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cashBankAccountService } from '../src/modules/cash-bank/cash-bank.service';
import { cashBankMovementService } from '../src/modules/cash-bank/movement.service';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';

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
 * Kasa/Banka servis testleri — GOVERNANCE §2 `cashbank`.
 *
 * ÖNEMLİ: Servisler `getPoolInstance()` içinde pool'u cache'ler. Bu yüzden
 * tüm testler boyunca TEK ve AYNI pool nesnesini döndürüyoruz; testler arası
 * temizliği `sharedMockQuery.mockReset()` ile yapıyoruz. Aksi halde servis
 * ilk testten kalma boş bir mock pool'u kullanmaya devam eder.
 *
 * Servisler iki farklı yol kullanır:
 *  - `withTenantClient` (listAccounts, getAccountById, deleteAccount, yazma
 *    akışları): `pool.connect()` → `client.query` (BEGIN/COMMIT/ROLLBACK dahil)
 *  - doğrudan `pool.query` (listMovements, getMovementById)
 *
 * Bu yüzden `pool.query` ile `client.query` aynı mock referansına bağlanır ve
 * BEGIN/COMMIT/ROLLBACK gibi kontrol sorguları otomatik `{ rows: [] }` ile
 * geçirilir; testler yalnızca veri sorgularını `mockImplementation` ile kurar.
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

describe('CashBankService - Unit Tests', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sharedMockQuery.mockReset();
    sharedMockClient.query.mockReset();
    sharedMockClient.release.mockReset();
    sharedMockPool.connect.mockReset().mockResolvedValue(sharedMockClient);
    mockQuery = useSharedPool().mockQuery;
  });

  describe('listAccounts', () => {
    it('sayfalı hesap listesi döner (balance Number’a çevrilir)', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '1' }] });
        return Promise.resolve({
          rows: [
            {
              id: 'a1',
              account_name: 'Merkez Kasa',
              account_type: 'cash',
              currency: 'TRY',
              balance: '1500.50',
              opening_balance: '1000.00',
              status: 'active',
            },
          ],
        });
      });

      const result = await cashBankAccountService.listAccounts({ page: 1, limit: 20 } as never);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].balance).toBe(1500.5);
      expect(result.items[0].accountName).toBe('Merkez Kasa');
      expect(result.total).toBe(1);
    });

    it('hesap tipi filtresi SQL’e eklenir', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '0' }] });
        return Promise.resolve({ rows: [] });
      });

      await cashBankAccountService.listAccounts({ accountType: 'bank' } as never);

      const selectCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('account_type'));
      expect(String(selectCall?.[0])).toContain('t.account_type = $');
    });
  });

  describe('getAccountById', () => {
    it('hesabı döner', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('cash_bank_accounts')) {
          return Promise.resolve({
            rows: [
              {
                id: 'a1',
                account_name: 'Banka',
                account_type: 'bank',
                currency: 'TRY',
                balance: '500',
                opening_balance: '0',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await cashBankAccountService.getAccountById('a1');

      expect(result).not.toBeNull();
      expect(result!.balance).toBe(500);
    });

    it('bulunamazsa null döner', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('cash_bank_accounts')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      expect(await cashBankAccountService.getAccountById('yok')).toBeNull();
    });
  });

  describe('deleteAccount', () => {
    it('hesap yoksa NOT_FOUND fırlatır', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('cash_bank_accounts')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      await expect(cashBankAccountService.deleteAccount('yok')).rejects.toThrow(AppError);
    });

    it('aktif olmayan hesap silinemez', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('cash_bank_accounts')) {
          return Promise.resolve({ rows: [{ id: 'a1', status: 'inactive' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(cashBankAccountService.deleteAccount('a1')).rejects.toThrow(
        'Only active accounts can be deleted',
      );
    });
  });
});

describe('CashBankMovementService - Unit Tests', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sharedMockQuery.mockReset();
    sharedMockClient.query.mockReset();
    sharedMockClient.release.mockReset();
    sharedMockPool.connect.mockReset().mockResolvedValue(sharedMockClient);
    mockQuery = useSharedPool().mockQuery;
  });

  describe('listMovements', () => {
    it('sayfalı hareket listesi döner', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '2' }] });
        return Promise.resolve({
          rows: [
            {
              id: 'm1',
              movement_type: 'deposit',
              transaction_date: new Date(),
              amount: '1000.00',
              currency: 'TRY',
              balance_before: '0',
              balance_after: '1000',
              account_name: 'Kasa',
            },
          ],
        });
      });

      const result = await cashBankMovementService.listMovements({ page: 1, limit: 20 } as never);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].amount).toBe(1000);
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
    });

    it('hareket tipi filtresi SQL’e eklenir', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '0' }] });
        return Promise.resolve({ rows: [] });
      });

      await cashBankMovementService.listMovements({ movementType: 'transfer' } as never);

      const selectCall = mockQuery.mock.calls.find((c) => !String(c[0]).includes('COUNT(*)'));
      expect(String(selectCall?.[0])).toContain('t.movement_type = $');
    });
  });

  describe('getMovementById', () => {
    it('bulunamazsa null döner', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      expect(await cashBankMovementService.getMovementById('yok')).toBeNull();
    });
  });

  describe('withdrawal', () => {
    it('yetersiz bakiyede INSUFFICIENT_BALANCE fırlatır ve ROLLBACK yapar', async () => {
      sharedMockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'a1', status: 'active', account_name: 'Kasa' }] }) // getAccount
        .mockResolvedValueOnce({ rows: [{ deposits: '100', withdrawals: '0' }] }); // calculateBalance

      await expect(
        cashBankMovementService.withdrawal(
          { accountId: 'a1', transactionDate: '2026-10-01', amount: 500, currency: 'TRY', exchangeRate: 1 } as never,
          'user-1',
        ),
      ).rejects.toThrow(AppError);

      expect(sharedMockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });
});
