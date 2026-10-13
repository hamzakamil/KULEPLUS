import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ContactService } from '../src/modules/contacts/service';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
  })),
}));

describe('ContactService - Unit Tests', () => {
  let service: ContactService;
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    mockClient = { query: vi.fn(), release: vi.fn() };
    mockPool = { query: mockQuery, connect: vi.fn().mockResolvedValue(mockClient) };
    vi.mocked(getPool).mockReturnValue(mockPool as never);
    service = new ContactService();
  });

  describe('listContacts', () => {
    it('should return paginated contacts list', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] }).mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            code: 'C001',
            name: 'Test Müşteri',
            type: 'customer',
            trade_name: null,
            tax_number: null,
            tax_office: null,
            is_active: true,
            settings: {},
            created_at: new Date(),
            updated_at: new Date(),
            version: 1,
            addresses: [],
            phones: [],
            emails: [],
            relations: [],
          },
        ],
      });

      const result = await service.listContacts({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].code).toBe('C001');
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.pages).toBe(1);
    });

    it('should filter by type', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.listContacts({ type: 'supplier' });

      const call = mockQuery.mock.calls[0][0];
      expect(call).toContain('type = $');
    });

    it('should search by query', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.listContacts({ q: 'Ali' });

      const call = mockQuery.mock.calls[0][0];
      expect(call).toContain('ILIKE');
    });
  });

  describe('getContact', () => {
    it('should return contact with details', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: '1',
            code: 'C001',
            name: 'Test',
            type: 'customer',
            trade_name: null,
            tax_number: null,
            tax_office: null,
            is_active: true,
            settings: {},
            created_at: new Date(),
            updated_at: new Date(),
            version: 1,
            addresses: [],
            phones: [],
            emails: [],
            relations: [],
          },
        ],
      });

      const result = await service.getContact('1');

      expect(result).not.toBeNull();
      expect(result!.code).toBe('C001');
      expect(result!.addresses).toEqual([]);
    });

    it('should return null for non-existent contact', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const result = await service.getContact('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('createContact', () => {
    it('should create contact with all related data', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }) // code check - no conflict
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'new-id',
              code: 'C002',
              name: 'Yeni',
              type: 'customer',
              trade_name: null,
              tax_number: null,
              tax_office: null,
              is_active: true,
              settings: {},
              created_at: new Date(),
              updated_at: new Date(),
              version: 1,
            },
          ],
        })
        .mockResolvedValueOnce({}) // address insert
        .mockResolvedValueOnce({}) // phone insert
        .mockResolvedValueOnce({}) // email insert
        .mockResolvedValueOnce({}); // COMMIT

      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'new-id',
            code: 'C002',
            name: 'Yeni',
            type: 'customer',
            trade_name: null,
            tax_number: null,
            tax_office: null,
            is_active: true,
            settings: {},
            created_at: new Date(),
            updated_at: new Date(),
            version: 1,
            addresses: [],
            phones: [],
            emails: [],
            relations: [],
          },
        ],
      }); // getContact

      const result = await service.createContact({
        code: 'C002',
        name: 'Yeni Müşteri',
        type: 'customer',
        settings: {},
        addresses: [
          {
            is_primary: true,
            type: 'default',
            province: 'İstanbul',
            district: 'Kadıköy',
            street: 'Test Sk.',
            zip_code: '34000',
            parsed: {},
          },
        ],
        phones: [{ is_primary: true, type: 'mobile', number: '+905551234567', parsed: {} }],
        emails: [
          { is_primary: true, type: 'default', email: 'test@example.com', validated: false },
        ],
        relations: [],
      });

      expect(result).not.toBeNull();
      expect(result!.code).toBe('C002');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw CONFLICT if code already exists', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }); // code check - exists

      await expect(
        service.createContact({
          code: 'C001',
          name: 'Test',
          type: 'customer',
          settings: {},
          addresses: [],
          phones: [],
          emails: [],
          relations: [],
        }),
      ).rejects.toThrow(AppError);

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('updateContact', () => {
    it('should update contact fields', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // existing check
        .mockResolvedValueOnce({ rowCount: 0 }) // code check - no conflict (no code change)
        .mockResolvedValueOnce({}) // UPDATE
        .mockResolvedValueOnce({}); // COMMIT

      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: '1',
            code: 'C001',
            name: 'Güncellenmiş',
            type: 'customer',
            trade_name: null,
            tax_number: null,
            tax_office: null,
            is_active: true,
            settings: {},
            created_at: new Date(),
            updated_at: new Date(),
            version: 2,
            addresses: [],
            phones: [],
            emails: [],
            relations: [],
          },
        ],
      }); // getContact

      const result = await service.updateContact('1', { name: 'Güncellenmiş' });

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Güncellenmiş');
    });

    it('should throw CONFLICT if new code exists', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // existing check
        .mockResolvedValueOnce({ rowCount: 1 }); // code check - conflict

      await expect(service.updateContact('1', { code: 'EXISTING' })).rejects.toThrow(AppError);

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should return null if contact not found', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }); // existing check - not found

      const result = await service.updateContact('non-existent', { name: 'Test' });

      expect(result).toBeNull();
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('deleteContact', () => {
    it('should delete contact and return true', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.deleteContact('1');

      expect(result).toBe(true);
    });

    it('should return false if contact not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const result = await service.deleteContact('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('setContactType', () => {
    it('should update contact type', async () => {
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '1', type: 'supplier' }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: '1',
              code: 'C001',
              name: 'Test',
              type: 'supplier',
              trade_name: null,
              tax_number: null,
              tax_office: null,
              is_active: true,
              settings: {},
              created_at: new Date(),
              updated_at: new Date(),
              version: 1,
              addresses: [],
              phones: [],
              emails: [],
              relations: [],
            },
          ],
        });

      const result = await service.setContactType('1', 'supplier');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('supplier');
    });

    it('should return null if contact not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const result = await service.setContactType('non-existent', 'supplier');

      expect(result).toBeNull();
    });
  });

  describe('listContactLedger', () => {
    // Servis sırası: 1) toplamlar (debit/credit/total) 2) devir bakiyesi (opening)
    // 3) sayfa hareketleri. Mock'lar bu üç adıma göre kurulur.
    it('should return paginated ledger entries', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ debit: '1000', credit: '0', total: '3' }] })
        .mockResolvedValueOnce({ rows: [{ opening: '250' }] })
        .mockResolvedValueOnce({
          rows: [
            { id: '1', contact_id: '1', type: 'receivable', amount: '1000', currency: 'TRY' },
          ],
        });

      const result = await service.listContactLedger('1', { page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(3);
      expect(result.summary.openingBalance).toBe(250);
    });

    it('should filter by type', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ debit: '0', credit: '0', total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ opening: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.listContactLedger('1', { type: 'payable' });

      // Filtre üç sorgunun da WHERE'ine girer; ilk çağrı toplamlar sorgusudur.
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ple.type = $');
      expect(params).toContain('payable');
    });
  });
});
