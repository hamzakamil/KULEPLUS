import { getPool, getTenantScope } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';

/** `updateProduct` ile güncellenebilen ürün alanları (beyaz liste). */
const UPDATABLE_PRODUCT_FIELDS = new Set([
  'code',
  'name',
  'unit_id',
  'barcode',
  'cost_price',
  'sale_price',
  'list_price',
  'description',
  'track_inventory',
  'is_active',
  'default_expense_category_id',
  'category_id',
  'brand',
  'supplier_code',
  'shelf_location',
  'min_stock',
  'sale_tax_rate_id',
  'purchase_tax_rate_id',
]);

/** Ürün kartına eklenen ayrıntı alanları (migration 202610620000, 202610630000). */
interface ProductDetailFields {
  /** Ürün kategorisi (product_categories.id); null = kategorisiz. */
  category_id?: string | null;
  brand?: string | null;
  supplier_code?: string | null;
  shelf_location?: string | null;
  /** Kritik stok seviyesi; 0 = uyarı yok. */
  min_stock?: number;
  /** Ürünün varsayılan satış / alış KDV oranı (tax_rates.id). */
  sale_tax_rate_id?: string | null;
  purchase_tax_rate_id?: string | null;
}

/** Boş/boşluk metni null'a çevirir; serbest metin alanları için. */
function cleanText(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

const PRODUCT_TEXT_FIELDS = new Set(['brand', 'supplier_code', 'shelf_location']);
const PRODUCT_NULLABLE_ID_FIELDS = new Set([
  'category_id',
  'sale_tax_rate_id',
  'purchase_tax_rate_id',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres tekillik ihlali (unique_violation). */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

/** Birim adından kod türetir: Türkçe harfler sadeleşir (Çuval → CUVAL), en çok 10 karakter. */
function unitCodeBase(name: string): string {
  return (
    name
      .toLocaleUpperCase('tr')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10) || 'BRM'
  );
}

/** Türetilen kod doluysa sonuna 2, 3… ekleyerek ilk boş kodu bulur. */
function nextFreeUnitCode(name: string, taken: Set<string>): string {
  const base = unitCodeBase(name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 10 - String(n).length)}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 6)}${Date.now() % 10000}`;
}

/** Güncellemede serbest metni temizler, boş KDV kimliğini null yapar; diğerleri aynen geçer. */
function normalizeProductValue(key: string, value: unknown): unknown {
  if (PRODUCT_TEXT_FIELDS.has(key)) return cleanText(value as string | null);
  if (PRODUCT_NULLABLE_ID_FIELDS.has(key)) return value || null;
  return value;
}

export class StockService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;

  constructor(pool?: Pool) {
    this.providedPool = pool ?? null;
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  /**
   * Transaction bağlantısı: aktif istek kapsamı (tenant scope) varsa o bağlantıya
   * katıl — kapsamın kendi transaction'ı isteğin sonunda kapanır, bu yüzden
   * burada BEGIN/COMMIT verilmez. Kapsam yoksa (worker/script/test) ayrı
   * bağlantı üzerinde kendi transaction'ını açar.
   *
   * Gerekçe: içe aktarımda ürün aynı istek transaction'ında oluşturulur; ayrı
   * bağlantı o satırı görmediği için açılış stoğu "Ürün bulunamadı" veriyordu.
   */
  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const scope = getTenantScope();
    if (scope) return fn(scope.client);

    const client = await this.getPoolInstance().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Ürün stok bakiyelerini listele */
  async listBalances(filters: { product_id?: string; warehouse_id?: string }) {
    const pool = this.getPoolInstance();

    const whereConditions = ['sb.tenant_id = current_tenant_id()'];
    const values: unknown[] = [];

    if (filters.product_id) {
      whereConditions.push(`sb.product_id = $${values.length + 1}`);
      values.push(filters.product_id);
    }
    if (filters.warehouse_id) {
      whereConditions.push(`sb.warehouse_id = $${values.length + 1}`);
      values.push(filters.warehouse_id);
    }

    const whereClause = whereConditions.join(' AND ');

    const result = await pool.query(
      `SELECT sb.*, p.name as product_name, p.code as product_code, w.name as warehouse_name
       FROM stock_balances sb
       JOIN products p ON p.id = sb.product_id
       LEFT JOIN warehouses w ON w.id = sb.warehouse_id
       WHERE ${whereClause}
       ORDER BY sb.quantity ASC`,
      values,
    );

    return { data: result.rows };
  }

  /** Ürün stok hareketlerini listele */
  async listMovements(
    productId: string,
    options: {
      page?: number;
      limit?: number;
      warehouse_id?: string;
      type?: string;
    },
  ) {
    const pool = this.getPoolInstance();
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;

    const whereConditions = ['sm.tenant_id = current_tenant_id()', 'sm.product_id = $1'];
    const values: unknown[] = [productId];

    if (options.warehouse_id) {
      whereConditions.push(`sm.warehouse_id = $${values.length + 1}`);
      values.push(options.warehouse_id);
    }
    if (options.type) {
      whereConditions.push(`sm.type = $${values.length + 1}`);
      values.push(options.type);
    }

    const whereClause = whereConditions.join(' AND ');

    // Count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM stock_movements sm WHERE ${whereClause}`,
      values,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Data
    const dataResult = await pool.query(
      `SELECT sm.*, w.name as warehouse_name
       FROM stock_movements sm
       LEFT JOIN warehouses w ON w.id = sm.warehouse_id
       WHERE ${whereClause}
       ORDER BY sm.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    return {
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /** Stok girişi oluştur */
  async stockIn(data: {
    product_id: string;
    warehouse_id: string;
    quantity: number;
    cost_price?: number;
    notes?: string;
  }) {
    return this.withTransaction(async (client) => {
      // Ürün ve depo doğrulama
      const productCheck = await client.query(
        'SELECT id, cost_price FROM products WHERE id = $1 AND tenant_id = current_tenant_id()',
        [data.product_id],
      );
      if (productCheck.rowCount === 0) throw new AppError('NOT_FOUND', 'Ürün bulunamadı');

      const warehouseCheck = await client.query(
        'SELECT id FROM warehouses WHERE id = $1 AND tenant_id = current_tenant_id()',
        [data.warehouse_id],
      );
      if (warehouseCheck.rowCount === 0) throw new AppError('NOT_FOUND', 'Depo bulunamadı');

      const costPrice = data.cost_price ?? productCheck.rows[0].cost_price ?? 0;
      const totalValue = costPrice * data.quantity;

      // Stok hareketi kaydet
      const movementResult = await client.query(
        `INSERT INTO stock_movements (
          id, tenant_id, product_id, warehouse_id, type, quantity,
          previous_balance, new_balance, cost_price, total_value, notes, created_at
        ) VALUES (
          $7, current_tenant_id(), $1, $2, 'in', $3, 0, 0, $4, $5, $6, now()
        ) RETURNING *`,
        [
          data.product_id,
          data.warehouse_id,
          data.quantity,
          costPrice,
          totalValue,
          data.notes ?? null,
          newId(),
        ],
      );

      // Stok bakiyesini güncelle (upsert)
      await client.query(
        `INSERT INTO stock_balances (id, tenant_id, product_id, warehouse_id, quantity, cost_price, total_value, last_movement_at, version)
         VALUES ($6, current_tenant_id(), $1, $2, $3, $4, $5, now(), 1)
         ON CONFLICT (tenant_id, product_id, warehouse_id) DO UPDATE SET
           quantity = stock_balances.quantity + EXCLUDED.quantity,
           cost_price = EXCLUDED.cost_price,
           total_value = stock_balances.total_value + EXCLUDED.total_value,
           last_movement_at = EXCLUDED.last_movement_at,
           version = stock_balances.version + 1`,
        [data.product_id, data.warehouse_id, data.quantity, costPrice, totalValue, newId()],
      );

      return movementResult.rows[0];
    });
  }

  /** Stok çıkışı oluştur */
  async stockOut(data: {
    product_id: string;
    warehouse_id: string;
    quantity: number;
    reason?: string;
  }) {
    return this.withTransaction(async (client) => {
      // Mevcut bakiyeyi kontrol et
      const balanceResult = await client.query(
        `SELECT quantity FROM stock_balances 
         WHERE tenant_id = current_tenant_id() AND product_id = $1 AND warehouse_id = $2`,
        [data.product_id, data.warehouse_id],
      );

      if (balanceResult.rowCount === 0 || Number(balanceResult.rows[0].quantity) < data.quantity) {
        throw new AppError('LIMIT_EXCEEDED', 'Yetersiz stok');
      }

      const previousBalance = Number(balanceResult.rows[0].quantity);
      const newBalance = previousBalance - data.quantity;

      // Stok hareketi kaydet
      const movementResult = await client.query(
        `INSERT INTO stock_movements (
          id, tenant_id, product_id, warehouse_id, type, quantity,
          previous_balance, new_balance, cost_price, total_value, notes, created_at
        ) VALUES (
          $7, current_tenant_id(), $1, $2, 'out', $3, $4, $5, 0, 0, $6, now()
        ) RETURNING *`,
        [
          data.product_id,
          data.warehouse_id,
          data.quantity,
          previousBalance,
          newBalance,
          data.reason ?? null,
          newId(),
        ],
      );

      // Stok bakiyesini güncelle
      await client.query(
        `UPDATE stock_balances 
         SET quantity = $1, last_movement_at = now(), version = version + 1
         WHERE tenant_id = current_tenant_id() AND product_id = $2 AND warehouse_id = $3`,
        [newBalance, data.product_id, data.warehouse_id],
      );

      return movementResult.rows[0];
    });
  }

  /**
   * Açılış stoğu girişi (içe aktarma) — SPEC §14.1: hareketli ortalama maliyet ve
   * bakiye tek transaction içinde güncellenir. `stock_movements.type` CHECK
   * kısıtı 'opening' değerine izin vermediği için hareket `in` tipi +
   * reference_type='opening_stock' ile yazılır (docs/product/import-templates/opening-stock.md).
   */
  async openingStock(data: {
    product_id: string;
    warehouse_id: string;
    quantity: number;
    cost_price?: number;
    transaction_date?: Date;
    notes?: string;
  }) {
    return this.withTransaction(async (client) => {
      const productCheck = await client.query(
        `SELECT id FROM products
         WHERE id = $1 AND tenant_id = current_tenant_id() AND is_active = true`,
        [data.product_id],
      );
      if (productCheck.rowCount === 0) throw new AppError('NOT_FOUND', 'Ürün bulunamadı');

      const warehouseCheck = await client.query(
        `SELECT id FROM warehouses
         WHERE id = $1 AND tenant_id = current_tenant_id() AND is_active = true`,
        [data.warehouse_id],
      );
      if (warehouseCheck.rowCount === 0) throw new AppError('NOT_FOUND', 'Depo bulunamadı');

      const unitCost = data.cost_price ?? 0;
      const transactionDate = data.transaction_date ?? new Date();

      // Bakiye satırını kilitle: aynı ürün+depoya eşzamanlı açılış girdileri yanlış ortalama üretmesin
      const balanceResult = await client.query(
        `SELECT quantity, cost_price FROM stock_balances
         WHERE tenant_id = current_tenant_id() AND product_id = $1 AND warehouse_id = $2
         FOR UPDATE`,
        [data.product_id, data.warehouse_id],
      );
      const previousBalance = balanceResult.rowCount ? Number(balanceResult.rows[0].quantity) : 0;
      const previousCost = balanceResult.rowCount ? Number(balanceResult.rows[0].cost_price) : 0;
      const newBalance = previousBalance + data.quantity;
      const previousValue = previousBalance * previousCost;
      const averageCost =
        newBalance > 0 ? (previousValue + unitCost * data.quantity) / newBalance : previousCost;

      const movementResult = await client.query(
        `INSERT INTO stock_movements (
          id, tenant_id, product_id, warehouse_id, type, quantity,
          previous_balance, new_balance, cost_price, total_value,
          reference_type, notes, created_at
        ) VALUES (
          $10, current_tenant_id(), $1, $2, 'in', $3, $4, $5, $6, $7, 'opening_stock', $8, $9
        ) RETURNING *`,
        [
          data.product_id,
          data.warehouse_id,
          data.quantity,
          previousBalance,
          newBalance,
          unitCost,
          unitCost * data.quantity,
          data.notes ?? 'Açılış stoğu',
          transactionDate,
          newId(),
        ],
      );

      await client.query(
        `INSERT INTO stock_balances (id, tenant_id, product_id, warehouse_id, quantity, cost_price, total_value, last_movement_at, version)
         VALUES ($7, current_tenant_id(), $1, $2, $3, $4, $5, $6, 1)
         ON CONFLICT (tenant_id, product_id, warehouse_id) DO UPDATE SET
           quantity = EXCLUDED.quantity,
           cost_price = EXCLUDED.cost_price,
           total_value = EXCLUDED.total_value,
           last_movement_at = GREATEST(
             COALESCE(stock_balances.last_movement_at, EXCLUDED.last_movement_at),
             EXCLUDED.last_movement_at
           ),
           version = stock_balances.version + 1`,
        [
          data.product_id,
          data.warehouse_id,
          newBalance,
          averageCost,
          newBalance * averageCost,
          transactionDate,
          newId(),
        ],
      );

      return movementResult.rows[0];
    });
  }

  /** Depoları listele */
  async listWarehouses() {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT * FROM warehouses WHERE tenant_id = current_tenant_id() AND is_active = true ORDER BY code`,
    );
    return { data: result.rows };
  }

  /** Depo oluştur */
  async createWarehouse(data: { code: string; name: string; address?: string; is_base?: boolean }) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `INSERT INTO warehouses (id, tenant_id, code, name, address, is_base, is_active, created_at, updated_at)
       VALUES ($5, current_tenant_id(), $1, $2, $3, $4, true, now(), now())
       RETURNING *`,
      [data.code, data.name, data.address ?? null, data.is_base ?? false, newId()],
    );
    return result.rows[0];
  }

  /** Ürünleri listele */
  async listProducts(options: {
    page?: number;
    limit?: number;
    is_active?: boolean;
    /** Kategori kimliği; 'none' = kategorisiz ürünler. */
    category_id?: string;
  }) {
    const pool = this.getPoolInstance();
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;

    const whereConditions = ['p.tenant_id = current_tenant_id()'];
    const values: unknown[] = [];

    if (options.is_active !== undefined) {
      whereConditions.push(`p.is_active = $${values.length + 1}`);
      values.push(options.is_active);
    }
    if (options.category_id) {
      if (options.category_id === 'none') {
        whereConditions.push('p.category_id IS NULL');
      } else if (UUID_PATTERN.test(options.category_id)) {
        whereConditions.push(`p.category_id = $${values.length + 1}`);
        values.push(options.category_id);
      } else {
        throw new AppError('VALIDATION_ERROR', 'Geçersiz kategori');
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM products p WHERE ${whereClause}`,
      values,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Data — stok bakiyesi toplamı (tüm depolar) ile birlikte
    const dataResult = await pool.query(
      `SELECT p.*, u.name as unit_name, u.abbreviation as unit_abbr,
              pc.name as category,
              COALESCE(sb.qty, 0) as quantity,
              COALESCE(sb.qty, 0) * p.sale_price as stock_value
       FROM products p
       JOIN units u ON u.id = p.unit_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS qty
         FROM stock_balances
         WHERE tenant_id = current_tenant_id()
         GROUP BY product_id
       ) sb ON sb.product_id = p.id
       WHERE ${whereClause}
       ORDER BY p.code
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    return {
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * Ürün listesini CSV olarak dışa aktarır (UTF-8 BOM — SPEC §3, §23.2).
   * Stok bakiyesi tüm depoların toplamıdır; liste ekranıyla aynı sırayı kullanır.
   */
  async exportCsv(): Promise<string> {
    const pool = this.getPoolInstance();
    const result = await pool.query<{
      code: string;
      name: string;
      unit: string;
      quantity: string;
      sale_price: string;
      cost_price: string | null;
      is_active: boolean;
    }>(
      `SELECT p.code, p.name, u.name AS unit,
              COALESCE(sb.qty, 0)::text AS quantity,
              p.sale_price::text AS sale_price,
              p.cost_price::text AS cost_price,
              p.is_active
       FROM products p
       JOIN units u ON u.id = p.unit_id
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS qty
         FROM stock_balances
         WHERE tenant_id = current_tenant_id()
         GROUP BY product_id
       ) sb ON sb.product_id = p.id
       WHERE p.tenant_id = current_tenant_id()
       ORDER BY p.code`,
    );

    const esc = (value: unknown): string => {
      const s = value === null || value === undefined ? '' : String(value);
      return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [
      ['Kod', 'Ürün Adı', 'Birim', 'Stok', 'Satış Fiyatı', 'Maliyet Fiyatı', 'Aktif'].join(','),
    ];
    for (const row of result.rows) {
      lines.push(
        [
          row.code,
          row.name,
          row.unit,
          row.quantity,
          row.sale_price,
          row.cost_price ?? '',
          row.is_active ? 'Evet' : 'Hayır',
        ]
          .map(esc)
          .join(','),
      );
    }
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  /** Ürün oluştur */
  async createProduct(
    data: {
      code: string;
      name: string;
      unit_id: string;
      barcode?: string;
      cost_price?: number;
      sale_price?: number;
      list_price?: number;
      description?: string;
      track_inventory?: boolean;
      /** Stok takipsiz (hizmet/sarf) ürün: alışta yazılacak gider kategorisi (Faz 7-2). */
      default_expense_category_id?: string | null;
    } & ProductDetailFields,
  ) {
    const pool = this.getPoolInstance();
    await this.assertExpenseCategory(data.default_expense_category_id);
    await this.assertProductCategory(data.category_id);
    this.assertMinStock(data.min_stock);
    await this.assertTaxRate(data.sale_tax_rate_id);
    await this.assertTaxRate(data.purchase_tax_rate_id);
    const result = await pool.query(
      `INSERT INTO products (id, tenant_id, code, name, unit_id, barcode, cost_price, sale_price, list_price, description, track_inventory, is_active, created_at, updated_at, default_expense_category_id,
                             category_id, brand, supplier_code, shelf_location, min_stock, sale_tax_rate_id, purchase_tax_rate_id)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, true, now(), now(), $11,
               $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        newId(),
        data.code,
        data.name,
        data.unit_id,
        data.barcode ?? null,
        data.cost_price ?? 0,
        data.sale_price ?? 0,
        data.list_price ?? 0,
        data.description ?? null,
        data.track_inventory ?? true,
        data.default_expense_category_id ?? null,
        data.category_id || null,
        cleanText(data.brand),
        cleanText(data.supplier_code),
        cleanText(data.shelf_location),
        data.min_stock ?? 0,
        data.sale_tax_rate_id || null,
        data.purchase_tax_rate_id || null,
      ],
    );
    return result.rows[0];
  }

  /** Kritik stok seviyesi sıfır veya pozitif bir sayı olmalı. */
  private assertMinStock(minStock: number | undefined) {
    if (minStock === undefined) return;
    if (!Number.isFinite(Number(minStock)) || Number(minStock) < 0) {
      throw new AppError('VALIDATION_ERROR', 'Kritik stok seviyesi 0 veya daha büyük olmalıdır');
    }
  }

  /** KDV oranı bu tenant'a ait mi? (FK, RLS'i baypas ettiğinden ayrıca doğrulanır) */
  private async assertTaxRate(taxRateId: string | null | undefined) {
    if (!taxRateId) return;
    const r = await this.getPoolInstance().query(
      'SELECT 1 FROM tax_rates WHERE id = $1 AND tenant_id = current_tenant_id()',
      [taxRateId],
    );
    if ((r.rowCount ?? 0) === 0) throw new AppError('NOT_FOUND', 'KDV oranı bulunamadı');
  }

  /** Gider kategorisi bu tenant'a ait mi? (FK, RLS'i baypas ettiğinden ayrıca doğrulanır) */
  private async assertExpenseCategory(categoryId: string | null | undefined) {
    if (!categoryId) return;
    const r = await this.getPoolInstance().query(
      'SELECT 1 FROM expense_categories WHERE id = $1 AND tenant_id = current_tenant_id()',
      [categoryId],
    );
    if ((r.rowCount ?? 0) === 0) throw new AppError('NOT_FOUND', 'Gider kategorisi bulunamadı');
  }

  /** Ürün kategorisi bu tenant'a ait mi? (FK, RLS'i baypas ettiğinden ayrıca doğrulanır) */
  private async assertProductCategory(categoryId: string | null | undefined) {
    if (!categoryId) return;
    const r = await this.getPoolInstance().query(
      'SELECT 1 FROM product_categories WHERE id = $1 AND tenant_id = current_tenant_id()',
      [categoryId],
    );
    if ((r.rowCount ?? 0) === 0) throw new AppError('NOT_FOUND', 'Ürün kategorisi bulunamadı');
  }

  /** Barkod ekle */
  async addBarcode(data: { product_id: string; barcode: string; type: string }) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `INSERT INTO product_barcodes (id, product_id, barcode, type, is_primary, created_at)
       SELECT $4, $1, $2, $3, false, now()
       WHERE EXISTS (SELECT 1 FROM products WHERE id = $1 AND tenant_id = current_tenant_id())
       RETURNING *`,
      [data.product_id, data.barcode, data.type, newId()],
    );
    if (result.rowCount === 0) throw new AppError('NOT_FOUND', 'Ürün bulunamadı');
    return result.rows[0];
  }

  /**
   * Birim oluştur. Kod verilmezse addan türetilir (Türkçe harfler sadeleşir, çakışırsa
   * sayı eklenir); aynı adlı birim ikinci kez açılmaz.
   */
  async createUnit(data: {
    code?: string;
    name: string;
    abbreviation?: string;
    is_base?: boolean;
  }) {
    const pool = this.getPoolInstance();
    const name = cleanText(data.name);
    if (!name) throw new AppError('VALIDATION_ERROR', 'Birim adı zorunludur');

    const sameName = await pool.query(
      `SELECT 1 FROM units
       WHERE tenant_id = current_tenant_id() AND is_active = true AND lower(name) = lower($1) LIMIT 1`,
      [name],
    );
    if ((sameName.rowCount ?? 0) > 0) throw new AppError('CONFLICT', 'Bu birim zaten var');

    let code = cleanText(data.code)?.toLocaleUpperCase('tr') ?? null;
    if (!code) {
      const taken = await pool.query<{ code: string }>(
        'SELECT code FROM units WHERE tenant_id = current_tenant_id()',
      );
      code = nextFreeUnitCode(name, new Set(taken.rows.map((r) => r.code)));
    }

    const result = await pool.query(
      `INSERT INTO units (id, tenant_id, code, name, abbreviation, is_base, conversion_factor, is_active, created_at, updated_at)
       VALUES ($5, current_tenant_id(), $1, $2, $3, $4, 1, true, now(), now())
       ON CONFLICT (tenant_id, code) DO NOTHING
       RETURNING *`,
      [code, name, cleanText(data.abbreviation), data.is_base ?? false, newId()],
    );
    if (result.rows.length === 0) {
      throw new AppError('CONFLICT', 'Bu birim kodu zaten kullanılıyor');
    }
    return result.rows[0];
  }

  /** Birimleri listele */
  async listUnits() {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT * FROM units WHERE tenant_id = current_tenant_id() AND is_active = true ORDER BY code`,
    );
    return { data: result.rows };
  }

  // ===== Ürün kategorileri =====

  /** Kategorileri ürün sayılarıyla listele (ada göre). */
  async listCategories() {
    const result = await this.getPoolInstance().query(
      `SELECT c.id, c.name, c.created_at, COUNT(p.id)::int AS product_count
       FROM product_categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.tenant_id = c.tenant_id
       WHERE c.tenant_id = current_tenant_id()
       GROUP BY c.id
       ORDER BY lower(c.name)`,
    );
    return { data: result.rows };
  }

  /** Kategori oluştur (ad, büyük/küçük harf duyarsız tekil). */
  async createCategory(data: { name: string }) {
    const name = cleanText(data.name);
    if (!name) throw new AppError('VALIDATION_ERROR', 'Kategori adı zorunludur');
    const result = await this.getPoolInstance().query(
      `INSERT INTO product_categories (id, tenant_id, name)
       VALUES ($1, current_tenant_id(), $2)
       ON CONFLICT (tenant_id, lower(name)) DO NOTHING
       RETURNING id, name, created_at, 0 AS product_count`,
      [newId(), name],
    );
    if (result.rows.length === 0) {
      throw new AppError('CONFLICT', 'Bu isimde bir kategori zaten var');
    }
    return result.rows[0];
  }

  /** Kategoriyi yeniden adlandır; başka bir kategoriyle aynı ada izin verilmez. */
  async renameCategory(id: string, data: { name: string }) {
    const name = cleanText(data.name);
    if (!name) throw new AppError('VALIDATION_ERROR', 'Kategori adı zorunludur');
    const pool = this.getPoolInstance();
    const sameName = await pool.query(
      `SELECT 1 FROM product_categories
       WHERE tenant_id = current_tenant_id() AND lower(name) = lower($1) AND id <> $2`,
      [name, id],
    );
    if ((sameName.rowCount ?? 0) > 0) {
      throw new AppError('CONFLICT', 'Bu isimde bir kategori zaten var');
    }
    try {
      const result = await pool.query(
        `UPDATE product_categories SET name = $2, updated_at = now()
         WHERE id = $1 AND tenant_id = current_tenant_id()
         RETURNING id, name, created_at`,
        [id, name],
      );
      if (result.rows.length === 0) throw new AppError('NOT_FOUND', 'Kategori bulunamadı');
      return result.rows[0];
    } catch (err) {
      // Eşzamanlı iki istek aynı adı alırsa ikincisi burada yakalanır.
      if (isUniqueViolation(err))
        throw new AppError('CONFLICT', 'Bu isimde bir kategori zaten var');
      throw err;
    }
  }

  /** Kategoriyi sil; ürünler silinmez, "kategorisiz" kalır (FK ON DELETE SET NULL). */
  async deleteCategory(id: string) {
    const result = await this.getPoolInstance().query(
      'DELETE FROM product_categories WHERE id = $1 AND tenant_id = current_tenant_id() RETURNING id',
      [id],
    );
    if (result.rows.length === 0) throw new AppError('NOT_FOUND', 'Kategori bulunamadı');
  }

  /** `sourceId` kategorisindeki ürünleri `targetId`'ye taşır ve kaynağı siler. */
  async mergeCategories(sourceId: string, targetId: string) {
    if (sourceId === targetId) {
      throw new AppError('VALIDATION_ERROR', 'Bir kategori kendisiyle birleştirilemez');
    }
    return this.withTransaction(async (client) => {
      const found = await client.query(
        `SELECT id FROM product_categories
         WHERE tenant_id = current_tenant_id() AND id = ANY($1::uuid[]) FOR UPDATE`,
        [[sourceId, targetId]],
      );
      if (found.rows.length !== 2) throw new AppError('NOT_FOUND', 'Kategori bulunamadı');
      const moved = await client.query(
        `UPDATE products SET category_id = $2, updated_at = now()
         WHERE tenant_id = current_tenant_id() AND category_id = $1`,
        [sourceId, targetId],
      );
      await client.query(
        'DELETE FROM product_categories WHERE id = $1 AND tenant_id = current_tenant_id()',
        [sourceId],
      );
      return { moved: moved.rowCount ?? 0 };
    });
  }

  /** Ürün ID'ye göre getir */
  async getProduct(id: string) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT p.*, u.name as unit_name, u.abbreviation as unit_abbr, pc.name as category
       FROM products p
       JOIN units u ON u.id = p.unit_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       WHERE p.id = $1 AND p.tenant_id = current_tenant_id()`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Ürün güncelle */
  async updateProduct(
    id: string,
    data: Partial<{
      code: string;
      name: string;
      unit_id: string;
      barcode: string | null;
      cost_price: number;
      sale_price: number;
      list_price: number;
      description: string | null;
      track_inventory: boolean;
      is_active: boolean;
      default_expense_category_id: string | null;
    }> &
      ProductDetailFields,
  ) {
    const pool = this.getPoolInstance();
    const fields: string[] = [];
    const values: unknown[] = [id];
    let paramIndex = 2;
    await this.assertExpenseCategory(data.default_expense_category_id);
    await this.assertProductCategory(data.category_id);
    this.assertMinStock(data.min_stock);
    await this.assertTaxRate(data.sale_tax_rate_id);
    await this.assertTaxRate(data.purchase_tax_rate_id);

    for (const [key, value] of Object.entries(data)) {
      // GÜVENLİK: kolon adı istek gövdesinden türetildiği için yalnızca izinli alanlar
      // SQL'e girer (aksi halde anahtar adı üzerinden SQL enjeksiyonu mümkündü).
      if (!UPDATABLE_PRODUCT_FIELDS.has(key)) continue;
      if (value !== undefined) {
        const column = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${column} = $${paramIndex}`);
        values.push(normalizeProductValue(key, value));
        paramIndex++;
      }
    }

    if (fields.length === 0) return null;

    fields.push('updated_at = now()');
    const query = `
      UPDATE products 
      SET ${fields.join(', ')}
      WHERE id = $1 AND tenant_id = current_tenant_id()
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] ?? null;
  }

  /** Ürün sil */
  async deleteProduct(id: string) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `DELETE FROM products WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    return result.rowCount !== null && result.rowCount > 0;
  }
}
