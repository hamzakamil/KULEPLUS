import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StockService } from '../src/modules/stock/service';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
  })),
}));

describe('StockService - Unit Tests', () => {
  let service: StockService;
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    mockClient = { query: vi.fn(), release: vi.fn() };
    mockPool = { query: mockQuery, connect: vi.fn().mockResolvedValue(mockClient) };
    vi.mocked(getPool).mockReturnValue(mockPool as never);
    service = new StockService();
  });

  describe('listBalances', () => {
    it('should return stock balances with product info', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            product_id: 'p1',
            warehouse_id: 'w1',
            quantity: '50',
            cost_price: '100',
            total_value: '5000',
            product_name: 'Test Product',
            product_code: 'P001',
            warehouse_name: 'Ana Depo',
          },
        ],
      });

      const result = await service.listBalances({});

      expect(result.data).toHaveLength(1);
      expect(result.data[0].product_name).toBe('Test Product');
    });

    it('should filter by product_id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.listBalances({ product_id: 'p1' });

      const call = mockQuery.mock.calls[0][0];
      expect(call).toContain('sb.product_id = $');
    });

    it('should filter by warehouse_id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.listBalances({ warehouse_id: 'w1' });

      const call = mockQuery.mock.calls[0][0];
      expect(call).toContain('sb.warehouse_id = $');
    });
  });

  describe('listMovements', () => {
    it('should return paginated movements', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] }).mockResolvedValueOnce({
        rows: [{ id: '1', product_id: 'p1', type: 'in', quantity: '10', created_at: new Date() }],
      });

      const result = await service.listMovements('p1', { page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(2);
    });

    it('should filter by warehouse_id', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.listMovements('p1', { warehouse_id: 'w1' });

      const call = mockQuery.mock.calls[0][0];
      expect(call).toContain('sm.warehouse_id = $');
    });

    it('should filter by type', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.listMovements('p1', { type: 'out' });

      const call = mockQuery.mock.calls[0][0];
      expect(call).toContain('sm.type = $');
    });
  });

  describe('stockIn', () => {
    it('should create stock in movement and update balance', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'p1', cost_price: '50' }] }) // product check
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'w1' }] }) // warehouse check
        .mockResolvedValueOnce({ rows: [{ id: 'm1', type: 'in', quantity: '10' }] }) // movement insert
        .mockResolvedValueOnce({}); // balance upsert
      // COMMIT is implicitly called - not asserted per call, only that it happens

      const result = await service.stockIn({ product_id: 'p1', warehouse_id: 'w1', quantity: 10 });

      expect(result.id).toBe('m1');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw NOT_FOUND for non-existent product', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }); // product check

      await expect(
        service.stockIn({ product_id: 'non-existent', warehouse_id: 'w1', quantity: 10 }),
      ).rejects.toThrow(AppError);

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw NOT_FOUND for non-existent warehouse', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'p1', cost_price: '50' }] }) // product check
        .mockResolvedValueOnce({ rowCount: 0 }); // warehouse check

      await expect(
        service.stockIn({ product_id: 'p1', warehouse_id: 'non-existent', quantity: 10 }),
      ).rejects.toThrow(AppError);

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('stockOut', () => {
    it('should create stock out movement and update balance', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ quantity: '50' }] }) // balance check
        .mockResolvedValueOnce({ rows: [{ id: 'm2', type: 'out', quantity: '5' }] }) // movement insert
        .mockResolvedValueOnce({}); // balance update

      const result = await service.stockOut({ product_id: 'p1', warehouse_id: 'w1', quantity: 5 });

      expect(result.id).toBe('m2');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw LIMIT_EXCEEDED when insufficient stock', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ quantity: '2' }] }); // balance check - only 2 left

      await expect(
        service.stockOut({ product_id: 'p1', warehouse_id: 'w1', quantity: 10 }),
      ).rejects.toThrow(AppError);

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw LIMIT_EXCEEDED when no balance exists', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }); // balance check - no record

      await expect(
        service.stockOut({ product_id: 'p1', warehouse_id: 'w1', quantity: 10 }),
      ).rejects.toThrow(AppError);

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('listWarehouses', () => {
    it('should return active warehouses', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'w1',
            code: 'WH-01',
            name: 'Ana Depo',
            address: null,
            is_base: true,
            is_active: true,
          },
          {
            id: 'w2',
            code: 'WH-02',
            name: 'Dolu Depo',
            address: null,
            is_base: false,
            is_active: true,
          },
        ],
      });

      const result = await service.listWarehouses();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].code).toBe('WH-01');
    });
  });

  describe('createWarehouse', () => {
    it('should create warehouse', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-w',
            code: 'WH-03',
            name: 'Yeni Depo',
            address: null,
            is_base: false,
            is_active: true,
          },
        ],
      });

      const result = await service.createWarehouse({ code: 'WH-03', name: 'Yeni Depo' });

      expect(result.id).toBe('new-w');
      expect(result.code).toBe('WH-03');
    });
  });

  describe('listProducts', () => {
    it('should return paginated products', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] }).mockResolvedValueOnce({
        rows: [
          {
            id: 'p1',
            code: 'P001',
            name: 'Test Product',
            description: null,
            barcode: null,
            model: null,
            cost_price: '50',
            sale_price: '100',
            list_price: '120',
            unit_id: 'u1',
            track_inventory: true,
            is_active: true,
            unit_name: 'Adet',
            unit_abbr: 'ad',
          },
        ],
      });

      const result = await service.listProducts({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].unit_name).toBe('Adet');
      expect(result.pagination.total).toBe(3);
    });

    it('should filter by is_active', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.listProducts({ is_active: false });

      const call = mockQuery.mock.calls[0][0];
      expect(call).toContain('p.is_active = $');
    });
  });

  describe('createProduct', () => {
    it('should create product', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-p',
            code: 'P002',
            name: 'Yeni Ürün',
            unit_id: 'u1',
            cost_price: '0',
            sale_price: '0',
            list_price: '0',
            track_inventory: true,
            is_active: true,
          },
        ],
      });

      const result = await service.createProduct({
        code: 'P002',
        name: 'Yeni Ürün',
        unit_id: 'u1',
      });

      expect(result.id).toBe('new-p');
      expect(result.code).toBe('P002');
    });
  });

  describe('addBarcode', () => {
    it('should add barcode to product', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'b1',
            product_id: 'p1',
            barcode: '1234567890123',
            type: 'ean13',
            is_primary: false,
          },
        ],
      });

      const result = await service.addBarcode({
        product_id: 'p1',
        barcode: '1234567890123',
        type: 'ean13',
      });

      expect(result.id).toBe('b1');
    });

    it('should throw NOT_FOUND for non-existent product', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      await expect(
        service.addBarcode({ product_id: 'non-existent', barcode: '123', type: 'ean13' }),
      ).rejects.toThrow(AppError);
    });
  });

  describe('createUnit', () => {
    it('should create unit', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-u',
            code: 'PCS',
            name: 'Piece',
            abbreviation: 'pcs',
            is_base: false,
            conversion_factor: '1',
            is_active: true,
          },
        ],
      });

      const result = await service.createUnit({ code: 'PCS', name: 'Piece', abbreviation: 'pcs' });

      expect(result.id).toBe('new-u');
      expect(result.code).toBe('PCS');
    });
  });

  describe('listUnits', () => {
    it('should return active units', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'u1',
            code: 'AD',
            name: 'Adet',
            abbreviation: 'ad',
            is_base: true,
            conversion_factor: '1',
            is_active: true,
          },
          {
            id: 'u2',
            code: 'KG',
            name: 'Kilogram',
            abbreviation: 'kg',
            is_base: false,
            conversion_factor: '1',
            is_active: true,
          },
        ],
      });

      const result = await service.listUnits();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].code).toBe('AD');
    });
  });
});
