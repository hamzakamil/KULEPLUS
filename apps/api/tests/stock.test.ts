import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StockService } from '../src/modules/stock/service';
import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
  })),
  // Servis `withTransaction` içinde aktif istek kapsamını sorar; testte kapsam
  // yok (null) → servis kendi bağlantısını açıp BEGIN/COMMIT çalıştırır.
  getTenantScope: vi.fn(() => null),
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

  describe('listProducts — kategori süzgeci', () => {
    const CAT = '0b1d4a52-6c7e-4f0a-9a3e-2f1c5d8e7a90';

    it('kategori kimliğiyle süzer', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await service.listProducts({ category_id: CAT });
      expect(mockQuery.mock.calls[0][0]).toContain('p.category_id = $1');
      expect(mockQuery.mock.calls[0][1]).toEqual([CAT]);
    });

    it("'none' kategorisiz ürünleri getirir", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await service.listProducts({ category_id: 'none' });
      expect(mockQuery.mock.calls[0][0]).toContain('p.category_id IS NULL');
    });

    it('geçersiz kimliği SQL’e vermeden reddeder', async () => {
      await expect(service.listProducts({ category_id: 'x; DROP' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(mockQuery).not.toHaveBeenCalled();
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

    it('ürün ayrıntı alanlarını temizleyip kaydeder', async () => {
      // 1) kategori doğrulaması, 2) satış KDV doğrulaması, 3) alış KDV doğrulaması, 4) INSERT
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'new-p' }] });

      await service.createProduct({
        code: 'P003',
        name: 'Detaylı Ürün',
        unit_id: 'u1',
        category_id: 'cat-hirdavat',
        brand: '   ',
        supplier_code: 'TED-77',
        shelf_location: 'A-3-2',
        min_stock: 12,
        sale_tax_rate_id: 'tax-20',
        purchase_tax_rate_id: 'tax-10',
      });

      const insert = mockQuery.mock.calls[3];
      expect(insert[0]).toContain('sale_tax_rate_id');
      expect(insert[0]).toContain('category_id');
      const params = insert[1] as unknown[];
      expect(params).toContain('cat-hirdavat');
      expect(params).not.toContain('   '); // boş marka null'a döndü
      expect(params).toContain('TED-77');
      expect(params).toContain('A-3-2');
      expect(params).toContain(12);
      expect(params).toContain('tax-20');
      expect(params).toContain('tax-10');
    });

    it('negatif kritik stok seviyesini reddeder', async () => {
      await expect(
        service.createProduct({ code: 'P004', name: 'Hatalı', unit_id: 'u1', min_stock: -1 }),
      ).rejects.toThrow('Kritik stok seviyesi');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('başka tenant veya olmayan kategoriyi reddeder', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      await expect(
        service.createProduct({
          code: 'P006',
          name: 'Yabancı Kategori',
          unit_id: 'u1',
          category_id: 'baska-tenant',
        }),
      ).rejects.toThrow('Ürün kategorisi bulunamadı');
      expect(mockQuery).toHaveBeenCalledTimes(1); // INSERT'e hiç gidilmedi
    });

    it('başka tenant veya olmayan KDV oranını reddeder', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      await expect(
        service.createProduct({
          code: 'P005',
          name: 'Yabancı KDV',
          unit_id: 'u1',
          sale_tax_rate_id: 'baska-tenant',
        }),
      ).rejects.toThrow('KDV oranı bulunamadı');
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
      // 1) aynı ad kontrolü, 2) INSERT
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValueOnce({
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

      const result = await service.createUnit({ code: 'pcs', name: 'Piece', abbreviation: 'pcs' });

      expect(result.id).toBe('new-u');
      expect(result.code).toBe('PCS');
      expect((mockQuery.mock.calls[1][1] as unknown[])[0]).toBe('PCS'); // kod büyütüldü
    });

    it('kod verilmezse addan türetir; Türkçe harfler sadeleşir, dolu kodlara sayı eklenir', async () => {
      // 1) aynı ad yok, 2) mevcut kodlar, 3) INSERT
      mockQuery
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rows: [{ code: 'CUVAL' }, { code: 'ADET' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'u-cuval', code: 'CUVAL2' }] });

      await service.createUnit({ name: ' Çuval ' });

      const params = mockQuery.mock.calls[2][1] as unknown[];
      expect(params[0]).toBe('CUVAL2'); // CUVAL dolu → 2 eklendi
      expect(params[1]).toBe('Çuval'); // boşluklar kırpıldı
    });

    it('aynı adlı birimi tekrar açmaz', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      await expect(service.createUnit({ name: 'adet' })).rejects.toThrow('Bu birim zaten var');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('kod çakışırsa (INSERT satır döndürmezse) CONFLICT verir', async () => {
      mockQuery
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      await expect(service.createUnit({ code: 'ADET', name: 'Tane' })).rejects.toThrow(
        'Bu birim kodu zaten kullanılıyor',
      );
    });

    it('boş adı reddeder', async () => {
      await expect(service.createUnit({ name: '   ' })).rejects.toThrow('Birim adı zorunludur');
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('ürün kategorileri', () => {
    it('listeler: ürün sayısıyla, kiracıya göre', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'c1', name: 'Hırdavat', product_count: 3 }],
      });
      const result = await service.listCategories();
      expect(result.data[0].product_count).toBe(3);
      expect(mockQuery.mock.calls[0][0]).toContain('c.tenant_id = current_tenant_id()');
    });

    it('oluşturur: adı kırpar', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', name: 'Gıda', product_count: 0 }] });
      const result = await service.createCategory({ name: '  Gıda ' });
      expect(result.name).toBe('Gıda');
      expect((mockQuery.mock.calls[0][1] as unknown[])[1]).toBe('Gıda');
    });

    it('aynı ad (büyük/küçük harf farkı dahil) varsa CONFLICT verir', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO NOTHING → satır yok
      await expect(service.createCategory({ name: 'gıda' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('boş adı reddeder', async () => {
      await expect(service.createCategory({ name: ' ' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('yeniden adlandırır; başka kategoride aynı ad varsa reddeder', async () => {
      mockQuery
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'c1', name: 'Yapı Malzemesi' }] });
      const ok = await service.renameCategory('c1', { name: 'Yapı Malzemesi' });
      expect(ok.name).toBe('Yapı Malzemesi');
      expect(mockQuery.mock.calls[0][0]).toContain('id <> $2'); // kendi adı çakışma sayılmaz

      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      await expect(service.renameCategory('c1', { name: 'Gıda' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('olmayan kategoriyi yeniden adlandırma / silme NOT_FOUND verir', async () => {
      mockQuery
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      await expect(service.renameCategory('yok', { name: 'X' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      mockQuery.mockResolvedValueOnce({ rows: [] });
      await expect(service.deleteCategory('yok')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('siler (ürünler kategorisiz kalır — FK ON DELETE SET NULL)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1' }] });
      await expect(service.deleteCategory('c1')).resolves.toBeUndefined();
      expect(mockQuery.mock.calls[0][0]).toContain('DELETE FROM product_categories');
    });

    it('birleştirir: ürünleri hedefe taşır, kaynağı siler, tek transaction', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }] }) // kilit
        .mockResolvedValueOnce({ rowCount: 4 }) // UPDATE products
        .mockResolvedValueOnce({ rows: [] }) // DELETE
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await service.mergeCategories('a', 'b');

      expect(result).toEqual({ moved: 4 });
      const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
      expect(sqls[0]).toBe('BEGIN');
      expect(sqls[2]).toContain('UPDATE products SET category_id');
      expect(sqls[3]).toContain('DELETE FROM product_categories');
      expect(sqls[4]).toBe('COMMIT');
    });

    it('birleştirmede kendisiyle birleştirmeyi ve olmayan kategoriyi reddeder', async () => {
      await expect(service.mergeCategories('a', 'a')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'a' }] }) // hedef bulunamadı
        .mockResolvedValueOnce(undefined); // ROLLBACK
      await expect(service.mergeCategories('a', 'yok')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const sqls = mockClient.query.mock.calls.map((c) => String(c[0]));
      expect(sqls).toContain('ROLLBACK');
      expect(sqls.some((s) => s.includes('UPDATE products'))).toBe(false);
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
