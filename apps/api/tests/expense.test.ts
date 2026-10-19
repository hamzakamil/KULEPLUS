import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ExpenseService } from '../src/modules/expense/expense.service';
import {
  createExpenseCategory,
  listExpenseCategories,
} from '../src/modules/expense/expense.service';
import { getPool } from '@kuleplus/db';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
  })),
}));

/**
 * Expense servis testleri — `modules/expense/expense.service.ts`
 * Gider trade.expense.* altındadır (ADR-0008).
 *
 * Not: Sınıf metotları instance pool'unu cache'ler; bu yüzden her testte
 * YENİ bir `ExpenseService` kurulur (aksi halde eski/boş mock kullanılır).
 */
describe('ExpenseService - Unit Tests', () => {
  let service: ExpenseService;
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    mockClient = { query: vi.fn(), release: vi.fn() };
    mockPool = { query: mockQuery, connect: vi.fn().mockResolvedValue(mockClient) };
    vi.mocked(getPool).mockReturnValue(mockPool as never);
    service = new ExpenseService();
  });

  describe('listExpenses', () => {
    it('sayfalı gider listesi döner', async () => {
      // Servis Promise.all ile iki sorguyu PARALEL atar; sıra garanti değildir.
      // Bu yüzden SQL metnine göre yanıt verilir (COUNT vs SELECT).
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '2' }] });
        return Promise.resolve({
          rows: [
            {
              id: 'e1',
              expense_date: new Date('2026-10-01'),
              category_id: 'c1',
              description: 'Kira',
              amount: '1000.00',
              base_amount: '1000.00',
              exchange_rate: '1',
              currency: 'TRY',
              payment_status: 'unpaid',
              status: 'draft',
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        });
      });

      const result = await service.listExpenses({ page: 1, limit: 20 } as never);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].amount).toBe(1000);
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
    });

    it("kategori filtresi SQL'e eklenir", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '0' }] });
        return Promise.resolve({ rows: [] });
      });

      await service.listExpenses({ category_id: 'cat-1' } as never);

      const selectCall = mockQuery.mock.calls.find((c) => !String(c[0]).includes('COUNT(*)'));
      expect(String(selectCall?.[0])).toContain('category_id = $');
    });
  });

  describe('getExpenseById', () => {
    it('gideri döner', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'e1',
            amount: '500.00',
            base_amount: '500.00',
            exchange_rate: '1',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await service.getExpenseById('e1');

      expect(result).not.toBeNull();
      expect(result!.amount).toBe(500);
      expect(result!.base_amount).toBe(500);
    });

    it('bulunamazsa null döner', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      expect(await service.getExpenseById('yok')).toBeNull();
    });
  });

  describe('createExpense', () => {
    it('transaction içinde gider oluşturur', async () => {
      mockClient.query.mockResolvedValueOnce({}); // BEGIN

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-e',
            amount: '250.00',
            base_amount: '250.00',
            exchange_rate: '1',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await service.createExpense(
        {
          category_id: 'c1',
          description: 'Ofis malzemesi',
          amount: 250,
          currency: 'TRY',
          exchange_rate: 1,
          payment_status: 'unpaid',
          status: 'draft',
        } as never,
        'user-1',
      );

      expect(result).not.toBeNull();
      expect(result!.amount).toBe(250);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });
  });

  describe('deleteExpense', () => {
    it('bulunmayan giderde NOT_FOUND fırlatır', async () => {
      // Silme artık tek transaction'da kilitli okumayla yapılır (FOR UPDATE).
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }); // SELECT ... FOR UPDATE

      await expect(service.deleteExpense('yok', 'user-1')).rejects.toThrow('Gider bulunamadı');
    });

    it('mevcut gideri iptal eder (soft-delete) + denetim izi yazar', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'e1', amount: '10.00', status: 'draft' }] }) // FOR UPDATE
        .mockResolvedValueOnce({}) // UPDATE status = cancelled
        .mockResolvedValueOnce({}) // writeAudit (INSERT audit_logs)
        .mockResolvedValueOnce({}); // COMMIT

      const result = await service.deleteExpense('e1', 'user-1');

      expect(result).toEqual({ success: true });
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      // Denetim izi aynı transaction'da (ADR-0016): audit INSERT sorgusu audit_logs tablosuna yazılır.
      const auditCall = mockClient.query.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO audit_logs'),
      );
      expect(auditCall).toBeDefined();
    });
  });

  describe('expense kategorileri (serbest fonksiyonlar)', () => {
    it('kategori oluşturur ve girdiyi döner', async () => {
      // Sıra: client'da BEGIN → INSERT → COMMIT; sonra getExpenseCategoryById
      // pool.query ile SELECT eder ve oluşturulan satırı döner.
      mockClient.query.mockResolvedValue({} as never);
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'cat-1', code: 'KIRA', name: 'Kira', status: 'active' }],
      });

      const result = await createExpenseCategory({
        code: 'KIRA',
        name: 'Kira',
        status: 'active',
      } as never);

      expect(result?.code).toBe('KIRA');
      expect(result?.name).toBe('Kira');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('kategorileri listeler', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cat-1', name: 'Kira' }] });

      const result = await listExpenseCategories();

      expect(result).toHaveLength(1);
    });
  });
});
