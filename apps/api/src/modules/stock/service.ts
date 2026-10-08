import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';

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
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

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
          tenant_id, product_id, warehouse_id, type, quantity, 
          previous_balance, new_balance, cost_price, total_value, notes, created_at
        ) VALUES (
          current_tenant_id(), $1, $2, 'in', $3, 0, 0, $4, $5, $6, now()
        ) RETURNING *`,
        [
          data.product_id,
          data.warehouse_id,
          data.quantity,
          costPrice,
          totalValue,
          data.notes ?? null,
        ],
      );

      // Stok bakiyesini güncelle (upsert)
      await client.query(
        `INSERT INTO stock_balances (tenant_id, product_id, warehouse_id, quantity, cost_price, total_value, last_movement_at, version)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5, now(), 1)
         ON CONFLICT (tenant_id, product_id, warehouse_id) DO UPDATE SET
           quantity = stock_balances.quantity + EXCLUDED.quantity,
           cost_price = EXCLUDED.cost_price,
           total_value = stock_balances.total_value + EXCLUDED.total_value,
           last_movement_at = EXCLUDED.last_movement_at,
           version = stock_balances.version + 1`,
        [data.product_id, data.warehouse_id, data.quantity, costPrice, totalValue],
      );

      await client.query('COMMIT');
      return movementResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Stok çıkışı oluştur */
  async stockOut(data: {
    product_id: string;
    warehouse_id: string;
    quantity: number;
    reason?: string;
  }) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mevcut bakiyeyi kontrol et
      const balanceResult = await client.query(
        `SELECT quantity FROM stock_balances 
         WHERE tenant_id = current_tenant_id() AND product_id = $1 AND warehouse_id = $2`,
        [data.product_id, data.warehouse_id],
      );

      if (balanceResult.rowCount === 0 || Number(balanceResult.rows[0].quantity) < data.quantity) {
        await client.query('ROLLBACK');
        throw new AppError('LIMIT_EXCEEDED', 'Yetersiz stok');
      }

      const previousBalance = Number(balanceResult.rows[0].quantity);
      const newBalance = previousBalance - data.quantity;

      // Stok hareketi kaydet
      const movementResult = await client.query(
        `INSERT INTO stock_movements (
          tenant_id, product_id, warehouse_id, type, quantity, 
          previous_balance, new_balance, cost_price, total_value, notes, created_at
        ) VALUES (
          current_tenant_id(), $1, $2, 'out', $3, $4, $5, 0, 0, $6, now()
        ) RETURNING *`,
        [
          data.product_id,
          data.warehouse_id,
          data.quantity,
          previousBalance,
          newBalance,
          data.reason ?? null,
        ],
      );

      // Stok bakiyesini güncelle
      await client.query(
        `UPDATE stock_balances 
         SET quantity = $1, last_movement_at = now(), version = version + 1
         WHERE tenant_id = current_tenant_id() AND product_id = $2 AND warehouse_id = $3`,
        [newBalance, data.product_id, data.warehouse_id],
      );

      await client.query('COMMIT');
      return movementResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
      `INSERT INTO warehouses (tenant_id, code, name, address, is_base, is_active, created_at, updated_at)
       VALUES (current_tenant_id(), $1, $2, $3, $4, true, now(), now())
       RETURNING *`,
      [data.code, data.name, data.address ?? null, data.is_base ?? false],
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

    // Data
    const dataResult = await pool.query(
      `SELECT p.*, u.name as unit_name, u.abbreviation as unit_abbr
       FROM products p
       JOIN units u ON u.id = p.unit_id
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

  /** Ürün oluştur */
  async createProduct(data: {
    code: string;
    name: string;
    unit_id: string;
    cost_price?: number;
    sale_price?: number;
    list_price?: number;
    description?: string;
    track_inventory?: boolean;
  }) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `INSERT INTO products (tenant_id, code, name, unit_id, cost_price, sale_price, list_price, description, track_inventory, is_active, created_at, updated_at)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, true, now(), now())
       RETURNING *`,
      [
        data.code,
        data.name,
        data.unit_id,
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
      `INSERT INTO product_barcodes (product_id, barcode, type, is_primary, created_at)
       SELECT $1, $2, $3, false, now()
       WHERE EXISTS (SELECT 1 FROM products WHERE id = $1 AND tenant_id = current_tenant_id())
       RETURNING *`,
      [data.product_id, data.barcode, data.type],
    );
    if (result.rowCount === 0) throw new AppError('NOT_FOUND', 'Ürün bulunamadı');
    return result.rows[0];
  }

  /** Birim oluştur */
  async createUnit(data: { code: string; name: string; abbreviation?: string; is_base?: boolean }) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `INSERT INTO units (tenant_id, code, name, abbreviation, is_base, conversion_factor, is_active, created_at, updated_at)
       VALUES (current_tenant_id(), $1, $2, $3, $4, 1, true, now(), now())
       RETURNING *`,
      [data.code, data.name, data.abbreviation ?? null, data.is_base ?? false],
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
}
