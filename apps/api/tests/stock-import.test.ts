import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ProductImportService, IMPORT_LIMIT_KEY } from '../src/modules/stock/import.service';
import { OpeningStockImportService } from '../src/modules/stock/opening-stock.import.service';
import { getPool } from '@kuleplus/db';
import { checkLimit, incrementUsage } from '../src/modules/entitlement/service';
import { AppError } from '@kuleplus/shared';

/** StockService DB'ye gider — modül mock'u ile kontrol edilir (import service onu delege eder). */
const { stockMock } = vi.hoisted(() => ({
  stockMock: {
    createUnit: vi.fn(),
    createWarehouse: vi.fn(),
    createProduct: vi.fn(),
    openingStock: vi.fn(),
  },
}));

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn() })),
}));

vi.mock('../src/modules/entitlement/service', () => ({
  checkLimit: vi.fn(),
  incrementUsage: vi.fn(),
}));

vi.mock('../src/modules/stock/service.js', () => ({
  StockService: vi.fn(() => stockMock),
}));

function limitResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tenantId: 'tenant-1',
    limitKey: IMPORT_LIMIT_KEY,
    allowed: true,
    current: 0,
    limit: 100,
    remaining: 100,
    resetAt: new Date('2026-11-01'),
    ...overrides,
  };
}

describe('ProductImportService', () => {
  let service: ProductImportService;
  let mockQuery: ReturnType<typeof vi.fn>;

  const CSV_VALID = 'name,code,unit\nVida M4,VIDA-M4,ADET\nSomun M4,SOMUN-M4,ADET\n';

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(getPool).mockReturnValue({ query: mockQuery, connect: vi.fn() } as never);
    vi.mocked(checkLimit).mockResolvedValue(limitResult() as never);
    vi.mocked(incrementUsage).mockResolvedValue(undefined);
    stockMock.createUnit.mockResolvedValue({ id: 'unit-1' });
    stockMock.createWarehouse.mockResolvedValue({ id: 'wh-1' });
    stockMock.createProduct.mockResolvedValue({ id: 'prod-1', code: 'VIDA-M4' });
    stockMock.openingStock.mockResolvedValue(undefined);
    service = new ProductImportService();
  });

  /** Tenant + mevcut ürün/birim/kod sorgularını karşıla (SQL içeriğine göre). */
  function primeQueries(opts?: {
    products?: { code: string; name: string; barcode: string | null }[];
    units?: string[];
    codes?: string[];
  }) {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('current_tenant_id() AS tenant_id')) {
        return Promise.resolve({ rows: [{ tenant_id: 'tenant-1' }] });
      }
      if (sql.includes('SELECT code, name, barcode FROM products')) {
        return Promise.resolve({ rows: opts?.products ?? [] });
      }
      if (sql.includes('SELECT name FROM units')) {
        return Promise.resolve({ rows: (opts?.units ?? []).map((name) => ({ name })) });
      }
      if (sql.includes('SELECT id FROM units')) return Promise.resolve({ rows: [] });
      if (sql.includes('SELECT id FROM warehouses')) return Promise.resolve({ rows: [] });
      if (sql.includes('SELECT code FROM products')) {
        return Promise.resolve({ rows: (opts?.codes ?? []).map((code) => ({ code })) });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  describe('dryRun', () => {
    it('geçerli satırları raporlar, DB yazımı yapmaz', async () => {
      primeQueries();
      const report = await service.dryRun(CSV_VALID);

      expect(report.summary).toMatchObject({ total: 2, valid: 2, duplicates: 0, invalid: 0 });
      expect(report.rows.every((r) => r.status === 'valid')).toBe(true);
      expect(stockMock.createProduct).not.toHaveBeenCalled();
      expect(incrementUsage).not.toHaveBeenCalled();
      // Birim kataloğu boş → "katalogda yok" uyarısı (aktarımda otomatik oluşturulur)
      expect(report.rows[0].warnings?.[0]?.field).toBe('unit');
    });

    it('negatif satış fiyatı ve negatif açılış stoğunu reddeder', async () => {
      primeQueries();
      const csv = 'name,code,unit,sale_price,initial_stock\nHatalı,HAT-1,ADET,-5,-10\n';
      const report = await service.dryRun(csv);

      expect(report.summary.invalid).toBe(1);
      const fields = report.rows[0].issues.map((i) => i.field);
      expect(fields).toContain('sale_price');
      expect(fields).toContain('initial_stock');
    });

    it("DB'de aynı kod varsa mükerrer işaretler", async () => {
      primeQueries({ products: [{ code: 'VIDA-M4', name: 'Başka Ürün', barcode: null }] });
      const report = await service.dryRun(CSV_VALID);

      const dup = report.rows.find((r) => r.status === 'duplicate');
      expect(dup?.duplicateOf).toContain('mevcut ürün');
      expect(report.summary.duplicates).toBe(1);
      expect(report.summary.valid).toBe(1);
    });

    it('dosya içi mükerrer adı yakalar', async () => {
      primeQueries();
      const csv = 'name,code,unit\nAynı Ürün,A1,ADET\nAynı Ürün,A2,ADET\n';
      const report = await service.dryRun(csv);

      expect(report.summary.duplicates).toBe(1);
      expect(report.rows[1].duplicateOf).toContain('dosya içi');
    });

    it('bilinmeyen hedef alan eşleştirmesinde VALIDATION_ERROR fırlatır', async () => {
      primeQueries();
      await expect(service.dryRun(CSV_VALID, { name: 'olmayan_alan' })).rejects.toThrow(AppError);
    });

    it('boş CSV içeriğini reddeder', async () => {
      primeQueries();
      await expect(service.dryRun('   ')).rejects.toThrow('CSV dosyası boş');
    });
  });

  describe('commit', () => {
    it('geçerli satırları oluşturur ve kotayı başarılı sayısı kadar artırır', async () => {
      primeQueries();
      const report = await service.commit(CSV_VALID);

      expect(report.summary).toMatchObject({ total: 2, created: 2, duplicates: 0, failed: 0 });
      expect(stockMock.createProduct).toHaveBeenCalledTimes(2);
      expect(incrementUsage).toHaveBeenCalledWith('tenant-1', IMPORT_LIMIT_KEY, undefined, 2);
    });

    it('kodsuz satıra URN seri kodu üretir', async () => {
      primeQueries({ codes: ['URN-000001'] });
      stockMock.createProduct.mockResolvedValue({ id: 'prod-9', code: 'URN-000002' });
      const report = await service.commit('name,code,unit\nKodsuz Ürün,,ADET\n');

      expect(stockMock.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'URN-000002' }),
      );
      expect(report.summary.created).toBe(1);
    });

    it('initial_stock > 0 ise temel depoyu açar ve açılış stoğu hareketi yazar', async () => {
      primeQueries();
      const report = await service.commit(
        'name,code,unit,cost_price,initial_stock\nVida,VIDA,ADET,"8,00",100\n',
      );

      expect(stockMock.createWarehouse).toHaveBeenCalledTimes(1);
      expect(stockMock.openingStock).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 100, cost_price: 8 }),
      );
      expect(report.rows[0].status).toBe('created');
    });

    it('kota yetersizse yazmadan LIMIT_EXCEEDED fırlatır', async () => {
      primeQueries();
      vi.mocked(checkLimit).mockResolvedValue(limitResult({ current: 99, remaining: 1 }) as never);

      await expect(service.commit(CSV_VALID)).rejects.toThrow('Aylık içe aktarma kotası aşılıyor');
      expect(stockMock.createProduct).not.toHaveBeenCalled();
    });

    it('1000 satır üstünde kuyruk mesajı verir', async () => {
      primeQueries();
      const rows = Array.from({ length: 1001 }, (_, i) => `Ürün ${i},KOD-${i},ADET`);
      await expect(service.commit(['name,code,unit', ...rows].join('\n'))).rejects.toThrow(
        'kuyruğa alınır',
      );
    });

    it('kayıt hatasında satırı failed sayar, kotayı artırmaz', async () => {
      primeQueries();
      stockMock.createProduct.mockRejectedValue(
        new AppError('CONFLICT', 'Bu kod zaten kullanımda'),
      );
      const report = await service.commit(CSV_VALID);

      expect(report.summary).toMatchObject({ created: 0, failed: 2 });
      expect(report.rows.every((r) => r.status === 'failed')).toBe(true);
      expect(incrementUsage).not.toHaveBeenCalled();
    });

    it('ürün oluşup açılış stoğu yazılamazsa failed + açıklayıcı issue üretir', async () => {
      primeQueries();
      stockMock.openingStock.mockRejectedValue(new AppError('LIMIT_EXCEEDED', 'Yetersiz stok'));
      const report = await service.commit('name,code,unit,initial_stock\nVida,VIDA,ADET,10\n');

      expect(report.rows[0].status).toBe('failed');
      expect(report.rows[0].issues[0].message).toContain('açılış stoğu yazılamadı');
    });

    it('templateCsv BOM + hedef başlıkları döner', () => {
      const csv = service.templateCsv();
      expect(csv.startsWith('\ufeff')).toBe(true);
      expect(csv).toContain('code');
      expect(csv).toContain('initial_stock');
    });
  });
});

describe('OpeningStockImportService', () => {
  let service: OpeningStockImportService;
  let mockQuery: ReturnType<typeof vi.fn>;

  const CSV_VALID =
    'sku,warehouse,quantity,unit_cost,date\nVIDA-M4,Merkez Depo,50,"8,00",01.01.2026\n';

  const PRODUCTS = [{ id: 'p1', code: 'VIDA-M4', name: 'Vida M4', barcode: null }];
  const WAREHOUSES = [{ id: 'w1', code: 'MERKEZ', name: 'Merkez Depo' }];

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(getPool).mockReturnValue({ query: mockQuery, connect: vi.fn() } as never);
    vi.mocked(checkLimit).mockResolvedValue(limitResult() as never);
    vi.mocked(incrementUsage).mockResolvedValue(undefined);
    stockMock.openingStock.mockResolvedValue(undefined);
    service = new OpeningStockImportService();
  });

  function primeQueries(opts?: {
    products?: { id: string; code: string; name: string; barcode: string | null }[];
    warehouses?: { id: string; code: string; name: string }[];
    balances?: { product_id: string; warehouse_id: string | null; quantity: string }[];
  }) {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('current_tenant_id() AS tenant_id')) {
        return Promise.resolve({ rows: [{ tenant_id: 'tenant-1' }] });
      }
      if (sql.includes('SELECT id, code, name, barcode FROM products')) {
        return Promise.resolve({ rows: opts?.products ?? [] });
      }
      if (sql.includes('SELECT id, code, name FROM warehouses')) {
        return Promise.resolve({ rows: opts?.warehouses ?? [] });
      }
      if (sql.includes('SELECT product_id, warehouse_id, quantity FROM stock_balances')) {
        return Promise.resolve({ rows: opts?.balances ?? [] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  it('mevcut bakiye varsa "üzerine eklenir" uyarısı verir (dry-run yazmaz)', async () => {
    primeQueries({
      products: PRODUCTS,
      warehouses: WAREHOUSES,
      balances: [{ product_id: 'p1', warehouse_id: 'w1', quantity: '100.00000000' }],
    });
    const report = await service.dryRun(CSV_VALID);

    expect(report.summary).toMatchObject({ total: 1, valid: 1, invalid: 0 });
    expect(report.rows[0].warnings.some((w) => w.message.includes('üzerine eklenir'))).toBe(true);
    expect(stockMock.openingStock).not.toHaveBeenCalled();
  });

  it('bilinmeyen ürün ve depoyu reddeder', async () => {
    primeQueries({ products: PRODUCTS, warehouses: WAREHOUSES });
    const report = await service.dryRun(
      'sku,warehouse,quantity,unit_cost,date\nYOK-1,Yok Depo,5,"1,00",01.01.2026\n',
    );

    expect(report.summary.invalid).toBe(1);
    const fields = report.rows[0].issues.map((i) => i.field);
    expect(fields).toContain('sku');
    expect(fields).toContain('warehouse');
  });

  it('sıfır/negatif miktarı ve gelecek tarihi reddeder', async () => {
    primeQueries({ products: PRODUCTS, warehouses: WAREHOUSES });
    const future = new Date(Date.now() + 86_400_000 * 30);
    const futureTr = [
      String(future.getDate()).padStart(2, '0'),
      String(future.getMonth() + 1).padStart(2, '0'),
      future.getFullYear(),
    ].join('.');
    const report = await service.dryRun(
      `sku,warehouse,quantity,unit_cost,date\nVIDA-M4,Merkez Depo,0,"8,00",${futureTr}\n`,
    );

    const fields = report.rows[0].issues.map((i) => i.field);
    expect(fields).toContain('quantity');
    expect(fields).toContain('date');
  });

  it('dosya içi aynı ürün+depo tekrarını mükerrer sayar', async () => {
    primeQueries({ products: PRODUCTS, warehouses: WAREHOUSES });
    const report = await service.dryRun(
      'sku,warehouse,quantity,unit_cost,date\n' +
        'VIDA-M4,Merkez Depo,10,"8,00",01.01.2026\n' +
        'VIDA-M4,Merkez Depo,20,"8,00",02.01.2026\n',
    );

    expect(report.summary.duplicates).toBe(1);
    expect(report.rows[1].duplicateOf).toContain('dosya içi');
  });

  it('commit: açılış stoğu hareketini yazar ve kotayı artırır', async () => {
    primeQueries({ products: PRODUCTS, warehouses: WAREHOUSES });
    const report = await service.commit(CSV_VALID);

    expect(stockMock.openingStock).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 50, product_id: 'p1', warehouse_id: 'w1' }),
    );
    expect(report.summary).toMatchObject({ total: 1, created: 1, failed: 0 });
    expect(incrementUsage).toHaveBeenCalled();
  });

  it('openingStock hatasında satırı failed yapar ve mesajı taşır', async () => {
    primeQueries({ products: PRODUCTS, warehouses: WAREHOUSES });
    stockMock.openingStock.mockRejectedValue(
      new AppError('LIMIT_EXCEEDED', 'Negatif stok engellendi'),
    );
    const report = await service.commit(CSV_VALID);

    expect(report.rows[0].status).toBe('failed');
    expect(report.rows[0].issues[0].message).toContain('Negatif stok engellendi');
  });

  it('templateCsv BOM + hedef başlıkları döner', () => {
    const csv = service.templateCsv();
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('sku');
    expect(csv).toContain('warehouse');
  });
});
