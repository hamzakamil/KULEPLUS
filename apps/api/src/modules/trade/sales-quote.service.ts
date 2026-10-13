import { getPool } from '@kuleplus/db';
import { AppError } from '@kuleplus/shared';
import type { Pool } from 'pg';
import { newId } from '@kuleplus/shared';
import { z } from 'zod';

export const createSalesQuoteSchema = z.object({
  contactId: z.string().uuid().optional(),
  issueDate: z.string().date(),
  validUntil: z.string().date().optional(),
  currency: z.string().length(3).default('TRY'),
  exchangeRate: z.number().default(1),
  seriesId: z.string().uuid().optional(),
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

export const updateSalesQuoteSchema = createSalesQuoteSchema.partial();

export const SalesQuoteListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted']).optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['number', 'issueDate', 'total', 'status']).default('issueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateSalesQuoteInput = z.infer<typeof createSalesQuoteSchema>;
export type UpdateSalesQuoteInput = z.infer<typeof updateSalesQuoteSchema>;
export type SalesQuoteListQuery = z.infer<typeof SalesQuoteListQuerySchema>;

class SalesQuoteService {
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
       VALUES ($1, current_tenant_id(), 'sales_quote', 'DEFAULT', $2, 1)
       ON CONFLICT (tenant_id, doc_type, series, fiscal_year)
       DO UPDATE SET current_number = document_number_sequences.current_number + 1
       RETURNING current_number`,
      [newId(), fiscalYear],
    );
    // Sabit önek: doc_type kısaltması çakışıyordu (sales_quote/sales_order → SAL).
    // Görünen belge numarası için belgeye özgü, okunabilir önek kullanılır.
    const { current_number } = result.rows[0];
    return `TKL-${fiscalYear}-${String(current_number).padStart(9, '0')}`;
  }

  async listQuotes(query: SalesQuoteListQuery) {
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

    const [quotesResult, countResult] = await Promise.all([
      pool.query(
        `SELECT t.*, c.name as contact_name FROM sales_quotes t LEFT JOIN contacts c ON c.id = t.contact_id WHERE ${conditions.join(' AND ')} ORDER BY ${col} ${order} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...values, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM sales_quotes t WHERE ${conditions.join(' AND ')}`,
        values,
      ),
    ]);

    return {
      items: quotesResult.rows,
      page,
      limit,
      total: Number(countResult.rows[0].total),
      totalPages: Math.ceil(Number(countResult.rows[0].total) / limit),
    };
  }

  async getQuoteById(id: string) {
    const pool = this.getPoolInstance();
    const quoteResult = await pool.query(
      `SELECT t.*, c.name as contact_name FROM sales_quotes t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = $1 AND t.tenant_id = current_tenant_id()`,
      [id],
    );
    if (quoteResult.rows.length === 0) return null;
    const linesResult = await pool.query(
      `SELECT il.*, p.name as product_name, p.code as product_code
       FROM sales_quote_lines il
       LEFT JOIN products p ON p.id = il.product_id
       WHERE il.quote_id = $1 AND il.tenant_id = current_tenant_id()
       ORDER BY il.sort_order`,
      [id],
    );
    return { ...quoteResult.rows[0], lines: linesResult.rows };
  }

  async createQuote(userId: string, input: CreateSalesQuoteInput) {
    const pool = this.getPoolInstance();
    const fiscalYear = new Date(input.issueDate).getFullYear();
    const number = await this.generateNumber(fiscalYear);

    const quoteId = newId();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sales_quotes (id, tenant_id, number, series_id, contact_id, issue_date, valid_until, currency, exchange_rate, subtotal, discount_total, tax_total, total, status, notes, created_by, updated_by)
         VALUES ($1,current_tenant_id(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          quoteId,
          number,
          input.seriesId || null,
          input.contactId || null,
          input.issueDate,
          input.validUntil || null,
          input.currency,
          input.exchangeRate,
          0,
          0,
          0,
          0,
          'draft',
          input.notes,
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
          `INSERT INTO sales_quote_lines (id, tenant_id, quote_id, product_id, description, quantity, unit_id, unit_price, discount_percent, discount_amount, tax_rate_id, tax_rate, tax_amount, line_total, sort_order) VALUES ($1,current_tenant_id(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            newId(),
            quoteId,
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
            line.sortOrder,
          ],
        );
      }
      await client.query(
        `UPDATE sales_quotes SET subtotal=$1, discount_total=$2, tax_total=$3, total=$4, updated_by=$5, updated_at=now() WHERE id=$6`,
        [
          subtotal.toFixed(4),
          discountTotal.toFixed(4),
          taxTotal.toFixed(4),
          total.toFixed(4),
          userId,
          quoteId,
        ],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getQuoteById(quoteId);
  }

  async updateQuote(id: string, userId: string, input: UpdateSalesQuoteInput) {
    const pool = this.getPoolInstance();
    const quote = await pool.query(
      `SELECT * FROM sales_quotes WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    const existing = quote.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', 'Sales quote not found');
    if (existing.status !== 'draft')
      throw new AppError('FORBIDDEN', 'Only draft quotes can be updated');

    const lines = input.lines ?? [];
    await pool.query(
      `UPDATE sales_quotes SET contact_id=COALESCE($1,contact_id), issue_date=COALESCE($2,issue_date), valid_until=COALESCE($3,valid_until), currency=COALESCE($4,currency), exchange_rate=COALESCE($5,exchange_rate), notes=COALESCE($6,notes), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$8 AND tenant_id=current_tenant_id()`,
      [
        input.contactId || null,
        input.issueDate || null,
        input.validUntil || null,
        input.currency || null,
        input.exchangeRate?.toString() || null,
        input.notes || null,
        userId,
        id,
      ],
    );
    await pool.query(
      `DELETE FROM sales_quote_lines WHERE quote_id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    for (const line of lines) {
      const taxRate = Number(line.taxRateId || '0');
      const discountAmount = (line.unitPrice * line.quantity * line.discountPercent) / 100;
      const lineSubtotal = line.unitPrice * line.quantity - discountAmount;
      const taxAmount = (lineSubtotal * taxRate) / 100;
      const lineTotal = lineSubtotal + taxAmount;
      await pool.query(
        `INSERT INTO sales_quote_lines (id, tenant_id, quote_id, product_id, description, quantity, unit_id, unit_price, discount_percent, discount_amount, tax_rate_id, tax_rate, tax_amount, line_total, sort_order) VALUES ($1,current_tenant_id(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
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
          line.sortOrder,
        ],
      );
    }
    return this.getQuoteById(id);
  }

  async updateQuoteStatus(id: string, status: string, userId: string) {
    const pool = this.getPoolInstance();
    const quote = await pool.query(
      `SELECT * FROM sales_quotes WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    const existing = quote.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', 'Sales quote not found');
    const validTransitions: Record<string, string[]> = {
      draft: ['sent', 'cancelled'],
      sent: ['accepted', 'rejected', 'expired', 'cancelled'],
      accepted: ['converted'],
    };
    const allowed = validTransitions[existing.status] || [];
    if (!allowed.includes(status))
      throw new AppError(
        'FORBIDDEN',
        `Invalid status transition from ${existing.status} to ${status}`,
      );
    await pool.query(
      `UPDATE sales_quotes SET status=$1, updated_by=$2, updated_at=now() WHERE id=$3 AND tenant_id=current_tenant_id()`,
      [status, userId, id],
    );
    return this.getQuoteById(id);
  }

  async deleteQuote(id: string) {
    const pool = this.getPoolInstance();
    const quote = await pool.query(
      `SELECT * FROM sales_quotes WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    const existing = quote.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', 'Sales quote not found');
    if (existing.status !== 'draft')
      throw new AppError('FORBIDDEN', 'Only draft quotes can be deleted');
    await pool.query(
      `UPDATE sales_quotes SET deleted_at=now() WHERE id=$1 AND tenant_id=current_tenant_id()`,
      [id],
    );
    return { success: true };
  }
}

export const salesQuoteService = new SalesQuoteService();

export async function createSalesQuote(userId: string, input: CreateSalesQuoteInput) {
  return salesQuoteService.createQuote(userId, input);
}
export async function getSalesQuoteById(id: string) {
  return salesQuoteService.getQuoteById(id);
}
export async function listSalesQuotes(query?: SalesQuoteListQuery) {
  return salesQuoteService.listQuotes(query || ({} as SalesQuoteListQuery));
}
export async function updateSalesQuote(id: string, userId: string, input: UpdateSalesQuoteInput) {
  return salesQuoteService.updateQuote(id, userId, input);
}
export async function updateSalesQuoteStatus(id: string, userId: string, status: string) {
  return salesQuoteService.updateQuoteStatus(id, status, userId);
}
export async function deleteSalesQuote(id: string) {
  return salesQuoteService.deleteQuote(id);
}
