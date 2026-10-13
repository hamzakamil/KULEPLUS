import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';
import { newId } from '@kuleplus/shared';
import { z } from 'zod';

export const createDeliverySchema = z.object({
  orderId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  issueDate: z.string().date(),
  deliveryDate: z.string().date().optional(),
  currency: z.string().length(3).default('TRY'),
  exchangeRate: z.number().default(1),
  seriesId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        orderLineId: z.string().uuid().optional(),
        productId: z.string().uuid().optional(),
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitId: z.string().uuid().optional(),
        sortOrder: z.number().int().default(0),
      }),
    )
    .min(1),
});

export const updateDeliverySchema = createDeliverySchema.partial();

export const DeliveryListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['draft', 'prepared', 'shipped', 'delivered', 'returned', 'cancelled']).optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['number', 'issueDate', 'status']).default('issueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryInput = z.infer<typeof updateDeliverySchema>;
export type DeliveryListQuery = z.infer<typeof DeliveryListQuerySchema>;

class DeliveryService {
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

  private async generateNumber(fiscalYear: number): Promise<string> {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `INSERT INTO document_number_sequences (id, tenant_id, doc_type, series, fiscal_year, current_number)
       VALUES ($1, current_tenant_id(), 'delivery', 'DEFAULT', $2, 1)
       ON CONFLICT (tenant_id, doc_type, series, fiscal_year)
       DO UPDATE SET current_number = document_number_sequences.current_number + 1
       RETURNING current_number`,
      [newId(), fiscalYear],
    );
    // Sabit önek: doc_type kısaltması 'del' olup DEL vermeden okunabilir olsun.
    const { current_number } = result.rows[0];
    return `IRS-${fiscalYear}-${String(current_number).padStart(9, '0')}`;
  }

  async listDeliveries(query: DeliveryListQuery) {
    const pool = this.getPoolInstance();
    const { page, limit, status, contactId, search, sortBy, sortOrder } = query;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['t.tenant_id = current_tenant_id()'];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`t.status = $${paramIdx}`);
      values.push(status);
      paramIdx++;
    }
    if (contactId) {
      conditions.push(`t.contact_id = $${paramIdx}`);
      values.push(contactId);
      paramIdx++;
    }
    if (search) {
      conditions.push(`(t.number ILIKE $${paramIdx} OR t.notes ILIKE $${paramIdx})`);
      values.push(`%${search}%`);
      paramIdx++;
    }

    const col =
      { number: 't.number', issueDate: 't.issue_date', status: 't.status' }[sortBy] ||
      't.issue_date';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [deliveriesResult, countResult] = await Promise.all([
      pool.query(
        `SELECT t.*, c.name as contact_name FROM deliveries t LEFT JOIN contacts c ON c.id = t.contact_id WHERE ${conditions.join(' AND ')} ORDER BY ${col} ${order} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...values, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM deliveries t WHERE ${conditions.join(' AND ')}`,
        values,
      ),
    ]);

    return {
      items: deliveriesResult.rows,
      page,
      limit,
      total: Number(countResult.rows[0].total),
      totalPages: Math.ceil(Number(countResult.rows[0].total) / limit),
    };
  }

  async getDeliveryById(id: string) {
    const pool = this.getPoolInstance();
    const deliveryResult = await pool.query(
      `SELECT t.*, c.name as contact_name FROM deliveries t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = $1 AND t.tenant_id = current_tenant_id()`,
      [id],
    );
    if (deliveryResult.rows.length === 0) return null;
    const linesResult = await pool.query(
      `SELECT il.*, p.name as product_name, p.code as product_code
       FROM delivery_lines il
       LEFT JOIN products p ON p.id = il.product_id
       WHERE il.delivery_id = $1 AND il.tenant_id = current_tenant_id()
       ORDER BY il.sort_order`,
      [id],
    );
    return { ...deliveryResult.rows[0], lines: linesResult.rows };
  }

  async createDelivery(userId: string, input: CreateDeliveryInput) {
    const pool = this.getPoolInstance();
    const fiscalYear = new Date(input.issueDate).getFullYear();
    const number = await this.generateNumber(fiscalYear);

    let contactId = input.contactId;
    const orderId = input.orderId;
    if (!contactId && orderId) {
      const orderResult = await pool.query(
        `SELECT contact_id FROM sales_orders WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [orderId],
      );
      contactId = orderResult.rows[0]?.contact_id;
    }

    const deliveryId = newId();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO deliveries (id, tenant_id, number, series_id, order_id, contact_id, issue_date, delivery_date, currency, exchange_rate, status, notes, warehouse_id, created_by, updated_by)
         VALUES ($1,current_tenant_id(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          deliveryId,
          number,
          input.seriesId || null,
          orderId || null,
          contactId || null,
          input.issueDate,
          input.deliveryDate || null,
          input.currency,
          input.exchangeRate,
          'draft',
          input.notes,
          input.warehouseId || null,
          userId,
          userId,
        ],
      );

      for (const line of input.lines) {
        await client.query(
          `INSERT INTO delivery_lines (id, tenant_id, delivery_id, order_line_id, product_id, description, quantity, unit_id, sort_order)
           VALUES ($1,current_tenant_id(),$2,$3,$4,$5,$6,$7,$8)`,
          [
            newId(),
            deliveryId,
            line.orderLineId || null,
            line.productId || null,
            line.description,
            line.quantity,
            line.unitId || null,
            line.sortOrder,
          ],
        );
      }

      if (orderId) {
        await client.query(
          `INSERT INTO document_links (id, tenant_id, source_type, source_id, target_type, target_id, link_type) VALUES ($1,current_tenant_id(),'sales_order',$2,'delivery',$3,'generated')`,
          [newId(), orderId, deliveryId],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.getDeliveryById(deliveryId);
  }

  async updateDelivery(id: string, userId: string, input: UpdateDeliveryInput) {
    const pool = this.getPoolInstance();
    const delivery = await pool.query(
      `SELECT * FROM deliveries WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    const existing = delivery.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', 'Delivery not found');
    if (existing.status !== 'draft')
      throw new AppError('FORBIDDEN', 'Only draft deliveries can be updated');

    const lines = input.lines ?? [];
    await pool.query(
      `UPDATE deliveries SET order_id=COALESCE($1,order_id), contact_id=COALESCE($2,contact_id), issue_date=COALESCE($3,issue_date), delivery_date=COALESCE($4,delivery_date), currency=COALESCE($5,currency), exchange_rate=COALESCE($6,exchange_rate), notes=COALESCE($7,notes), warehouse_id=COALESCE($8,warehouse_id), updated_by=$9, updated_at=now(), version=version+1 WHERE id=$10 AND tenant_id=current_tenant_id()`,
      [
        input.orderId || null,
        input.contactId || null,
        input.issueDate || null,
        input.deliveryDate || null,
        input.currency || null,
        input.exchangeRate?.toString() || null,
        input.notes || null,
        input.warehouseId || null,
        userId,
        id,
      ],
    );
    await pool.query(
      `DELETE FROM delivery_lines WHERE delivery_id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    for (const line of lines) {
      await pool.query(
        `INSERT INTO delivery_lines (id, tenant_id, delivery_id, order_line_id, product_id, description, quantity, unit_id, sort_order) VALUES ($1,current_tenant_id(),$2,$3,$4,$5,$6,$7,$8)`,
        [
          newId(),
          id,
          line.orderLineId || null,
          line.productId || null,
          line.description,
          line.quantity,
          line.unitId || null,
          line.sortOrder,
        ],
      );
    }
    return this.getDeliveryById(id);
  }

  async updateDeliveryStatus(id: string, status: string, userId: string) {
    const pool = this.getPoolInstance();
    const delivery = await pool.query(
      `SELECT * FROM deliveries WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    const existing = delivery.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', 'Delivery not found');
    const validTransitions: Record<string, string[]> = {
      draft: ['prepared', 'cancelled'],
      prepared: ['shipped', 'cancelled'],
      shipped: ['delivered', 'returned', 'cancelled'],
      delivered: ['returned'],
      returned: [],
    };
    const allowed = validTransitions[existing.status] || [];
    if (!allowed.includes(status))
      throw new AppError(
        'FORBIDDEN',
        `Invalid status transition from ${existing.status} to ${status}`,
      );
    await pool.query(
      `UPDATE deliveries SET status=$1, updated_by=$2, updated_at=now() WHERE id=$3 AND tenant_id=current_tenant_id()`,
      [status, userId, id],
    );
    return this.getDeliveryById(id);
  }

  async deleteDelivery(id: string) {
    const pool = this.getPoolInstance();
    const delivery = await pool.query(
      `SELECT * FROM deliveries WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    const existing = delivery.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', 'Delivery not found');
    if (existing.status !== 'draft')
      throw new AppError('FORBIDDEN', 'Only draft deliveries can be deleted');
    await pool.query(
      `UPDATE deliveries SET deleted_at=now() WHERE id=$1 AND tenant_id=current_tenant_id()`,
      [id],
    );
    return { success: true };
  }
}

export const deliveryService = new DeliveryService();

export async function createDelivery(userId: string, input: CreateDeliveryInput) {
  return deliveryService.createDelivery(userId, input);
}
export async function getDeliveryById(id: string) {
  return deliveryService.getDeliveryById(id);
}
export async function listDeliveries(query?: DeliveryListQuery) {
  return deliveryService.listDeliveries(query || ({} as DeliveryListQuery));
}
export async function updateDelivery(id: string, userId: string, input: UpdateDeliveryInput) {
  return deliveryService.updateDelivery(id, userId, input);
}
export async function updateDeliveryStatus(id: string, userId: string, status: string) {
  return deliveryService.updateDeliveryStatus(id, status, userId);
}
export async function deleteDelivery(id: string) {
  return deliveryService.deleteDelivery(id);
}
