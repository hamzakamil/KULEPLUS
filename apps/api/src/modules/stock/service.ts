import { getPool, getTenantScope } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';

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
  async listProducts(options: { page?: number; limit?: number; is_active?: boolean }) {
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
              COALESCE(sb.qty, 0) as quantity,
              COALESCE(sb.qty, 0) * p.sale_price as stock_value
       FROM products p
       JOIN units u ON u.id = p.unit_id
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
  async createProduct(data: {
    code: string;
    name: string;
    unit_id: string;
    barcode?: string;
    cost_price?: number;
    sale_price?: number;
    list_price?: number;
    description?: string;
    track_inventory?: boolean;
  }) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `INSERT INTO products (id, tenant_id, code, name, unit_id, barcode, cost_price, sale_price, list_price, description, track_inventory, is_active, created_at, updated_at)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, true, now(), now())
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
      ],
    );
    return result.rows[0];
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

  /** Birim oluştur */
  async createUnit(data: { code: string; name: string; abbreviation?: string; is_base?: boolean }) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `INSERT INTO units (id, tenant_id, code, name, abbreviation, is_base, conversion_factor, is_active, created_at, updated_at)
       VALUES ($5, current_tenant_id(), $1, $2, $3, $4, 1, true, now(), now())
       RETURNING *`,
      [data.code, data.name, data.abbreviation ?? null, data.is_base ?? false, newId()],
    );
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

  /** Ürün ID'ye göre getir */
  async getProduct(id: string) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT p.*, u.name as unit_name, u.abbreviation as unit_abbr
       FROM products p
       JOIN units u ON u.id = p.unit_id
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
    }>,
  ) {
    const pool = this.getPoolInstance();
    const fields: string[] = [];
    const values: unknown[] = [id];
    let paramIndex = 2;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        const column = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${column} = $${paramIndex}`);
        values.push(value);
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
