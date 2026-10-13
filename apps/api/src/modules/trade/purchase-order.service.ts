import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';
import { newId } from '@kuleplus/shared';
import { z } from 'zod';

export const createPurchaseOrderSchema = z.object({
  contactId: z.string().uuid().optional(),
  issueDate: z.string().date(),
  expectedDate: z.string().date().optional(),
  currency: z.string().length(3).default('TRY'),
  exchangeRate: z.number().default(1),
  seriesId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid().optional(),
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitId: z.string().uuid().optional(),
        unitPrice: z.number().nonnegative(),
        discountPercent: z.number().min(0).max(100).default(0),
        taxRateId: z.string().uuid().optional(),
        sortOrder: z.number().int().default(0),
      }),
    )
    .min(1),
});

export const updatePurchaseOrderSchema = createPurchaseOrderSchema.partial();

export const PurchaseOrderListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(['draft', 'sent', 'confirmed', 'partial_received', 'received', 'invoiced', 'cancelled'])
    .optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['number', 'issueDate', 'total', 'status']).default('issueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type PurchaseOrderListQuery = z.infer<typeof PurchaseOrderListQuerySchema>;

class PurchaseOrderService {
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
       VALUES ($1, current_tenant_id(), 'purchase_order', 'DEFAULT', $2, 1)
       ON CONFLICT (tenant_id, doc_type, series, fiscal_year)
       DO UPDATE SET current_number = document_number_sequences.current_number + 1
       RETURNING current_number`,
      [newId(), fiscalYear],
    );
    // Sabit önek: belgeye özgü, okunabilir (PUR yerine SAT).
    const { current_number } = result.rows[0];
    return `SAT-${fiscalYear}-${String(current_number).padStart(9, '0')}`;
  }

  async listOrders(query: PurchaseOrderListQuery) {
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
      { number: 't.number', issueDate: 't.issue_date', total: 't.total', status: 't.status' }[
        sortBy
      ] || 't.issue_date';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [ordersResult, countResult] = await Promise.all([
      pool.query(
        `SELECT t.*, c.name as contact_name FROM purchase_orders t LEFT JOIN contacts c ON c.id = t.contact_id WHERE ${conditions.join(' AND ')} ORDER BY ${col} ${order} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...values, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM purchase_orders t WHERE ${conditions.join(' AND ')}`,
        values,
      ),
    ]);

    return {
      items: ordersResult.rows,
      page,
      limit,
      total: Number(countResult.rows[0].total),
      totalPages: Math.ceil(Number(countResult.rows[0].total) / limit),
    };
  }

  async getOrderById(id: string) {
    const pool = this.getPoolInstance();
    const orderResult = await pool.query(
      `SELECT t.*, c.name as contact_name FROM purchase_orders t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = $1 AND t.tenant_id = current_tenant_id()`,
      [id],
    );
    if (orderResult.rows.length === 0) return null;
    const linesResult = await pool.query(
      `SELECT il.*, p.name as product_name, p.code as product_code
       FROM purchase_order_lines il
       LEFT JOIN products p ON p.id = il.product_id
       WHERE il.order_id = $1 AND il.tenant_id = current_tenant_id()
       ORDER BY il.sort_order`,
      [id],
    );
    return { ...orderResult.rows[0], lines: linesResult.rows };
  }

  async createOrder(userId: string, input: CreatePurchaseOrderInput) {
    const pool = this.getPoolInstance();
    const fiscalYear = new Date(input.issueDate).getFullYear();
    const number = await this.generateNumber(fiscalYear);

    const orderId = newId();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO purchase_orders (id, tenant_id, number, series_id, contact_id, issue_date, expected_date, currency, exchange_rate, subtotal, discount_total, tax_total, total, status, notes, warehouse_id, created_by, updated_by)
         VALUES ($1,current_tenant_id(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          orderId,
          number,
          input.seriesId || null,
          input.contactId || null,
          input.issueDate,
          input.expectedDate || null,
          input.currency,
          input.exchangeRate,
          0,
          0,
          0,
          0,
          'draft',
          input.notes,
          input.warehouseId || null,
          userId,
          userId,
        ],
      );

      let subtotal = 0,
        discountTotal = 0,
        taxTotal = 0,
        total = 0;
      for (const line of input.lines) {
        const taxRate = Number(line.taxRateId || '0');
        const discountAmount = (line.unitPrice * line.quantity * line.discountPercent) / 100;
        const lineSubtotal = line.unitPrice * line.quantity - discountAmount;
        const taxAmount = (lineSubtotal * taxRate) / 100;
        const lineTotal = lineSubtotal + taxAmount;
        subtotal += line.unitPrice * line.quantity;
        discountTotal += discountAmount;
        taxTotal += taxAmount;
        total += lineTotal;
        await client.query(
          `INSERT INTO purchase_order_lines (id, tenant_id, order_id, product_id, description, quantity, unit_id, unit_price, discount_percent, discount_amount, tax_rate_id, tax_rate, tax_amount, line_total, received_quantity, invoiced_quantity, sort_order)
           VALUES ($1,current_tenant_id(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            newId(),
            orderId,
            line.productId || null,
            line.description,
            line.quantity,
            line.unitId || null,
            line.unitPrice,
            line.discountPercent,
            discountAmount,
            line.taxRateId || null,
            taxRate,
            taxAmount,
            lineTotal,
            0,
            0,
            line.sortOrder,
          ],
        );
      }
      await client.query(
        `UPDATE purchase_orders SET subtotal=$1, discount_total=$2, tax_total=$3, total=$4, updated_by=$5, updated_at=now() WHERE id=$6`,
        [
          subtotal.toFixed(4),
          discountTotal.toFixed(4),
          taxTotal.toFixed(4),
          total.toFixed(4),
          userId,
          orderId,
        ],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getOrderById(orderId);
  }

  async updateOrder(id: string, userId: string, input: UpdatePurchaseOrderInput) {
    const pool = this.getPoolInstance();
    const order = await pool.query(
      `SELECT * FROM purchase_orders WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    const existing = order.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', 'Purchase order not found');
    if (existing.status !== 'draft')
      throw new AppError('FORBIDDEN', 'Only draft orders can be updated');

    const lines = input.lines ?? [];
    await pool.query(
      `UPDATE purchase_orders SET contact_id=COALESCE($1,contact_id), issue_date=COALESCE($2,issue_date), expected_date=COALESCE($3,expected_date), currency=COALESCE($4,currency), exchange_rate=COALESCE($5,exchange_rate), notes=COALESCE($6,notes), warehouse_id=COALESCE($7,warehouse_id), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$9 AND tenant_id=current_tenant_id()`,
      [
        input.contactId || null,
        input.issueDate || null,
        input.expectedDate || null,
        input.currency || null,
        input.exchangeRate?.toString() || null,
        input.notes || null,
        input.warehouseId || null,
        userId,
        id,
      ],
    );
    await pool.query(
      `DELETE FROM purchase_order_lines WHERE order_id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    for (const line of lines) {
      const taxRate = Number(line.taxRateId || '0');
      const discountAmount = (line.unitPrice * line.quantity * line.discountPercent) / 100;
      const lineSubtotal = line.unitPrice * line.quantity - discountAmount;
      const taxAmount = (lineSubtotal * taxRate) / 100;
      const lineTotal = lineSubtotal + taxAmount;
      await pool.query(
        `INSERT INTO purchase_order_lines (id, tenant_id, order_id, product_id, description, quantity, unit_id, unit_price, discount_percent, discount_amount, tax_rate_id, tax_rate, tax_amount, line_total, received_quantity, invoiced_quantity, sort_order) VALUES ($1,current_tenant_id(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          newId(),
          id,
          line.productId || null,
          line.description,
          line.quantity,
          line.unitId || null,
          line.unitPrice,
          line.discountPercent,
          discountAmount,
          line.taxRateId || null,
          taxRate,
          taxAmount,
          lineTotal,
          0,
          0,
          line.sortOrder,
        ],
      );
    }
    return this.getOrderById(id);
  }

  async updateOrderStatus(id: string, status: string, userId: string) {
    const pool = this.getPoolInstance();
    const order = await pool.query(
      `SELECT * FROM purchase_orders WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    const existing = order.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', 'Purchase order not found');
    const validTransitions: Record<string, string[]> = {
      draft: ['sent', 'cancelled'],
      sent: ['confirmed', 'cancelled'],
      confirmed: ['partial_received', 'received', 'cancelled'],
      partial_received: ['received', 'cancelled'],
      received: ['invoiced'],
    };
    const allowed = validTransitions[existing.status] || [];
    if (!allowed.includes(status))
      throw new AppError(
        'FORBIDDEN',
        `Invalid status transition from ${existing.status} to ${status}`,
      );
    await pool.query(
      `UPDATE purchase_orders SET status=$1, updated_by=$2, updated_at=now() WHERE id=$3 AND tenant_id=current_tenant_id()`,
      [status, userId, id],
    );
    return this.getOrderById(id);
  }

  async deleteOrder(id: string) {
    const pool = this.getPoolInstance();
    const order = await pool.query(
      `SELECT * FROM purchase_orders WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    const existing = order.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', 'Purchase order not found');
    if (existing.status !== 'draft')
      throw new AppError('FORBIDDEN', 'Only draft orders can be deleted');
    await pool.query(
      `UPDATE purchase_orders SET deleted_at=now() WHERE id=$1 AND tenant_id=current_tenant_id()`,
      [id],
    );
    return { success: true };
  }
}

export const purchaseOrderService = new PurchaseOrderService();

export async function createPurchaseOrder(userId: string, input: CreatePurchaseOrderInput) {
  return purchaseOrderService.createOrder(userId, input);
}
export async function getPurchaseOrderById(id: string) {
  return purchaseOrderService.getOrderById(id);
}
export async function listPurchaseOrders(query?: PurchaseOrderListQuery) {
  return purchaseOrderService.listOrders(query || ({} as PurchaseOrderListQuery));
}
export async function updatePurchaseOrder(
  id: string,
  userId: string,
  input: UpdatePurchaseOrderInput,
) {
  return purchaseOrderService.updateOrder(id, userId, input);
}
export async function updatePurchaseOrderStatus(id: string, userId: string, status: string) {
  return purchaseOrderService.updateOrderStatus(id, status, userId);
}
export async function deletePurchaseOrder(id: string) {
  return purchaseOrderService.deleteOrder(id);
}
