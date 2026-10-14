import { getPool } from '@kuleplus/db';
import { AppError, newId, getRate, getLatestRate } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { ensureChartOfAccountsOn } from '../../accounting/chart.js';
import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  ReplaceInvoiceLinesInput,
  PaymentInput,
  ListInvoicesQuery,
} from './schemas.js';

interface LineWithTax {
  id: string;
  invoice_id: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_id: string | null;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  tax_rate_id: string | null;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
  sort_order: number;
}

export class InvoiceService {
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

  private async generateInvoiceNumber(client: PoolClient, fiscalYear: number): Promise<string> {
    // Tenanta bu yıl için sıra kaydı yoksa oluştur (onboarding'de kurulmamış legacy tenant'lar).
    await client.query(
      `INSERT INTO invoice_sequences (id, tenant_id, prefix, current_number, fiscal_year, reset_on_new_year)
       SELECT $2, current_tenant_id(), 'FAT', 0, $1, true
       WHERE NOT EXISTS (
         SELECT 1 FROM invoice_sequences
         WHERE tenant_id = current_tenant_id() AND fiscal_year = $1
       )`,
      [fiscalYear, newId()],
    );

    const result = await client.query(
      `UPDATE invoice_sequences
       SET current_number = current_number + 1,
           updated_at = now()
       WHERE tenant_id = current_tenant_id() AND fiscal_year = $1
       RETURNING prefix, current_number`,
      [fiscalYear],
    );
    if (result.rowCount === 0) {
      throw new AppError('NOT_FOUND', 'Fatura sırası bulunamadı');
    }
    const { prefix, current_number } = result.rows[0];
    // Tüm belgelerde ortak kural: PREFIKS-YIL-9HANE (ör. FAT-2026-000000001)
    return `${prefix}-${fiscalYear}-${String(current_number).padStart(9, '0')}`;
  }

  private calculateLineTotals(lines: LineWithTax[]) {
    return lines.map((line, index) => {
      const baseAmount = line.quantity * line.unit_price;
      const discountAmount = baseAmount * (line.discount_percent / 100);
      const taxableAmount = baseAmount - discountAmount;
      const taxAmount = taxableAmount * (line.tax_rate / 100);
      const lineTotal = taxableAmount + taxAmount;

      return {
        ...line,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        line_total: lineTotal,
        sort_order: line.sort_order ?? index,
      };
    });
  }

  private calculateTotals(calculatedLines: ReturnType<typeof this.calculateLineTotals>) {
    const subtotal = calculatedLines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
    const discountTotal = calculatedLines.reduce((sum, l) => sum + l.discount_amount, 0);
    const taxTotal = calculatedLines.reduce((sum, l) => sum + l.tax_amount, 0);
    const total = subtotal - discountTotal + taxTotal;

    return { subtotal, discountTotal, taxTotal, total };
  }

  async listInvoices(query: ListInvoicesQuery) {
    const pool = this.getPoolInstance();
    const { page, limit, sort, order, type, status, contact_id, date_from, date_to, q } = query;
    const offset = (page - 1) * limit;

    const whereConditions = ['i.tenant_id = current_tenant_id()'];
    const values: unknown[] = [];

    if (type) {
      whereConditions.push(`i.type = $${values.length + 1}`);
      values.push(type);
    }
    if (status) {
      whereConditions.push(`i.status = $${values.length + 1}`);
      values.push(status);
    }
    if (contact_id) {
      whereConditions.push(`i.contact_id = $${values.length + 1}`);
      values.push(contact_id);
    }
    if (date_from) {
      whereConditions.push(`i.issue_date >= $${values.length + 1}`);
      values.push(date_from);
    }
    if (date_to) {
      whereConditions.push(`i.issue_date <= $${values.length + 1}`);
      values.push(date_to);
    }
    if (q) {
      whereConditions.push(
        `(i.number ILIKE $${values.length + 1} OR i.notes ILIKE $${values.length + 1})`,
      );
      values.push(`%${q}%`);
    }

    const whereClause = whereConditions.join(' AND ');
    const allowedSorts = ['number', 'issue_date', 'due_date', 'total', 'created_at', 'contact_id'];
    const sortColumn = allowedSorts.includes(sort) ? sort : 'issue_date';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    // Count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM invoices i WHERE ${whereClause}`,
      values,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Data
    const dataResult = await pool.query(
      `SELECT i.*, c.name as contact_name
       FROM invoices i
       LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE ${whereClause}
       ORDER BY i.${sortColumn} ${sortOrder}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    return {
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getInvoice(id: string) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT i.*, c.name as contact_name
       FROM invoices i
       LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE i.id = $1 AND i.tenant_id = current_tenant_id()`,
      [id],
    );
    const invoice = result.rows[0];
    if (!invoice) return null;

    const linesResult = await pool.query(
      `SELECT il.*, p.name as product_name, p.code as product_code, u.name as unit_name, tr.code as tax_code
       FROM invoice_lines il
       LEFT JOIN products p ON p.id = il.product_id
       LEFT JOIN units u ON u.id = il.unit_id
       LEFT JOIN tax_rates tr ON tr.id = il.tax_rate_id
       WHERE il.invoice_id = $1
       ORDER BY il.sort_order`,
      [id],
    );

    const paymentsResult = await pool.query(
      `SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY payment_date`,
      [id],
    );

    return {
      ...invoice,
      lines: linesResult.rows,
      payments: paymentsResult.rows,
    };
  }

  /**
   * Denetim izi kaydı (ADR-0016). Aynı transaction'ın client'ı ile çağrılır —
   * belge ve izi birlikte kalıcılaşır (ya tamamı ya hiç). `entity_type` free-text
   * (faturada `invoices`, tahsilatta `invoice_payments`).
   */
  private async writeAudit(
    client: PoolClient,
    entry: {
      action: 'create' | 'update' | 'delete';
      entityType: string;
      entityId: string;
      userId?: string;
      oldValues?: Record<string, unknown> | null;
      newValues?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, now())`,
      [
        newId(),
        entry.userId ?? null,
        `${entry.entityType}.${entry.action}`,
        entry.entityType,
        entry.entityId,
        entry.oldValues ? JSON.stringify(entry.oldValues) : null,
        entry.newValues ? JSON.stringify(entry.newValues) : null,
      ],
    );
  }

  /**
   * Çoklu para birimi (SPEC §9.2): fatura kuru çözer.
   * - TRY → kur 1, rate_date yok (null).
   * - Kullanıcı exchange_rate verdiyse onu sabitler (bilinçli kur — snapshot).
   * - Vermediyse exchange_rates'ten tarih bazlı kur getirilir; o tarihte kur yoksa
   *   en güncel kur alınır (kur getirilemeyen tarih için en güncel kurun tarihi kullanılır).
   * - Kur hiç bulunamazsa VALIDATION_ERROR (kullanıcı manuel kur girmeli).
   */
  private async resolveInvoiceRate(
    client: PoolClient,
    currency: string,
    explicitRate?: number,
    requestedDate?: string,
  ): Promise<{ exchangeRate: number; rateDate: string | null }> {
    const cur = (currency || 'TRY').toUpperCase();
    if (cur === 'TRY') return { exchangeRate: 1, rateDate: null };

    if (explicitRate !== undefined && explicitRate > 0) {
      return {
        exchangeRate: explicitRate,
        rateDate: requestedDate ?? new Date().toISOString().slice(0, 10),
      };
    }

    const tenantRow = await client.query<{ tid: string }>('SELECT current_tenant_id() AS tid');
    const tenantId = tenantRow.rows[0]?.tid ?? null;
    const rateDate = requestedDate ?? new Date().toISOString().slice(0, 10);

    let rate: number | null = null;
    if (tenantId) rate = await getRate(client, tenantId, cur, rateDate);
    if (!rate || !(rate > 0)) {
      const latest = tenantId ? await getLatestRate(client, tenantId, cur) : null;
      if (latest && latest.rate > 0) {
        return { exchangeRate: latest.rate, rateDate: latest.date };
      }
    }
    if (!rate || !(rate > 0)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${cur} için kur bulunamadı. Döviz kuru girmelisiniz (exchange_rate).`,
      );
    }
    return { exchangeRate: rate, rateDate };
  }

  async createInvoice(data: CreateInvoiceInput, userId?: string) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get fiscal year from issue_date or current date
      const issueDate = data.issue_date ? new Date(data.issue_date) : new Date();
      const fiscalYear = issueDate.getFullYear();

      // Generate invoice number
      const number = await this.generateInvoiceNumber(client, fiscalYear);

      // Get tax rates for lines
      const taxRateIds = data.lines.map((l) => l.tax_rate_id).filter(Boolean) as string[];
      const taxRates = new Map<string, number>();
      if (taxRateIds.length > 0) {
        const taxResult = await client.query(`SELECT id, rate FROM tax_rates WHERE id = ANY($1)`, [
          taxRateIds,
        ]);
        taxResult.rows.forEach((r) => taxRates.set(r.id, Number(r.rate)));
      }

      // Prepare lines with tax rates
      const linesWithTax: LineWithTax[] = data.lines.map((line) => ({
        id: '',
        invoice_id: '',
        product_id: line.product_id ?? null,
        description: line.description,
        quantity: line.quantity,
        unit_id: line.unit_id ?? null,
        unit_price: line.unit_price,
        discount_percent: line.discount_percent,
        discount_amount: 0,
        tax_rate_id: line.tax_rate_id ?? null,
        tax_rate:
          line.tax_rate_id && taxRates.has(line.tax_rate_id) ? taxRates.get(line.tax_rate_id)! : 0,
        tax_amount: 0,
        line_total: 0,
        sort_order: 0,
      }));

      // Calculate totals
      const calculatedLines = this.calculateLineTotals(linesWithTax);
      const { subtotal, discountTotal, taxTotal, total } = this.calculateTotals(calculatedLines);

      // Çoklu para birimi (SPEC §9.2): kur çözülür. Kullanıcı exchange_rate verdiyse onu sabitler
      // (<b>bilinçli kur</b> — snapshot); vermediyse issue_date bazlı TCMB kuru getirilir.
      const invoiceCurrency = (data.currency ?? 'TRY').toUpperCase();
      const issueDateStr = data.issue_date ?? new Date().toISOString().split('T')[0];
      const { exchangeRate, rateDate } = await this.resolveInvoiceRate(
        client,
        invoiceCurrency,
        data.exchange_rate,
        data.rate_date ?? issueDateStr,
      );

      // Insert invoice
      const invoiceResult = await client.query(
        `INSERT INTO invoices (
          id, tenant_id, sequence_id, number, type, status, contact_id, warehouse_id,
          issue_date, due_date, currency, exchange_rate, rate_date,
          subtotal, discount_total, tax_total, total, balance,
          notes, reference_type, reference_id
        ) VALUES (
          $1, current_tenant_id(),
          (SELECT id FROM invoice_sequences WHERE tenant_id = current_tenant_id() AND fiscal_year = $2),
          $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16, $17, $18
        ) RETURNING *`,
        [
          newId(),
          fiscalYear,
          number,
          data.type,
          data.contact_id ?? null,
          data.warehouse_id ?? null,
          issueDateStr,
          data.due_date ?? null,
          invoiceCurrency,
          exchangeRate,
          rateDate,
          subtotal,
          discountTotal,
          taxTotal,
          total,
          data.notes ?? null,
          data.reference_type ?? null,
          data.reference_id ?? null,
        ],
      );

      const invoice = invoiceResult.rows[0];

      // Insert lines
      for (const line of calculatedLines) {
        await client.query(
          `INSERT INTO invoice_lines (
            id, invoice_id, product_id, description, quantity, unit_id,
            unit_price, discount_percent, discount_amount,
            tax_rate_id, tax_rate, tax_amount, line_total, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            newId(),
            invoice.id,
            line.product_id ?? null,
            line.description,
            line.quantity,
            line.unit_id ?? null,
            line.unit_price,
            line.discount_percent,
            line.discount_amount,
            line.tax_rate_id ?? null,
            line.tax_rate,
            line.tax_amount,
            line.line_total,
            line.sort_order,
          ],
        );
      }

      // ADR-0016: fatura oluşturma denetim izi (aynı transaction — belge ve izi birlikte).
      await this.writeAudit(client, {
        action: 'create',
        entityType: 'invoices',
        entityId: invoice.id,
        userId,
        newValues: {
          number: invoice.number,
          type: invoice.type,
          total: invoice.total,
          status: invoice.status,
        },
      });

      await client.query('COMMIT');
      return this.getInvoice(invoice.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateInvoice(id: string, data: UpdateInvoiceInput, userId?: string) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Çoklu para birimi (SPEC §9.2) — düzenlemede kur verilmediyse otomatik çöz.
      // NOT: Bu adım alan döngüsünden ÖNCE yapılmalıdır; aksi halde çözülen kur/rate_date
      // UPDATE deyimine hiç yazılmaz (null kalır, base_total yanlış olur).
      // - currency dövize geçtiyse ve exchange_rate verilmediyse kur çekilir.
      // - currency TRY'ye döndüyse kur 1'e sabitlenir, rate_date temizlenir (base_total tutarlı kalır).
      if (data.currency) {
        const normalized = data.currency.toUpperCase();
        if (normalized !== 'TRY' && data.exchange_rate === undefined) {
          const resolved = await this.resolveInvoiceRate(client, normalized, undefined, data.rate_date);
          data.exchange_rate = resolved.exchangeRate;
          if (resolved.rateDate) data.rate_date = resolved.rateDate;
        } else if (normalized === 'TRY' && data.exchange_rate === undefined) {
          data.exchange_rate = 1;
          (data as { rate_date?: string | null }).rate_date = null;
        }
      }

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

      if (fields.length === 0) {
        await client.query('ROLLBACK');
        return this.getInvoice(id);
      }

      fields.push('updated_at = now()');
      const query = `
        UPDATE invoices 
        SET ${fields.join(', ')}
        WHERE id = $1 AND tenant_id = current_tenant_id()
        RETURNING *
      `;

      // ADR-0016: güncelleme denetim izi — önceki durum + değişiklik tek transaction'da.
      const prev = await client.query(
        `SELECT status, total, balance FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [id],
      );
      await client.query(query, values);
      await this.writeAudit(client, {
        action: 'update',
        entityType: 'invoices',
        entityId: id,
        userId,
        oldValues: prev.rows[0] ?? null,
        newValues: { ...data },
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getInvoice(id);
  }

  async replaceLines(invoiceId: string, data: ReplaceInvoiceLinesInput, userId?: string) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify invoice exists and is editable
      const invoiceCheck = await client.query(
        `SELECT id, status FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [invoiceId],
      );
      if (invoiceCheck.rowCount === 0) {
        throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
      }
      if (!['draft', 'proforma'].includes(invoiceCheck.rows[0].status)) {
        throw new AppError('VALIDATION_ERROR', 'Sadece taslak faturalar düzenlenebilir');
      }

      // Get tax rates
      const taxRateIds = data.lines.map((l) => l.tax_rate_id).filter(Boolean) as string[];
      const taxRates = new Map<string, number>();
      if (taxRateIds.length > 0) {
        const taxResult = await client.query(`SELECT id, rate FROM tax_rates WHERE id = ANY($1)`, [
          taxRateIds,
        ]);
        taxResult.rows.forEach((r) => taxRates.set(r.id, Number(r.rate)));
      }

      const linesWithTax: LineWithTax[] = data.lines.map((line) => ({
        id: '',
        invoice_id: '',
        product_id: line.product_id ?? null,
        description: line.description,
        quantity: line.quantity,
        unit_id: line.unit_id ?? null,
        unit_price: line.unit_price,
        discount_percent: line.discount_percent,
        discount_amount: 0,
        tax_rate_id: line.tax_rate_id ?? null,
        tax_rate:
          line.tax_rate_id && taxRates.has(line.tax_rate_id) ? taxRates.get(line.tax_rate_id)! : 0,
        tax_amount: 0,
        line_total: 0,
        sort_order: line.sort_order,
      }));

      const calculatedLines = this.calculateLineTotals(linesWithTax);
      const { subtotal, discountTotal, taxTotal, total } = this.calculateTotals(calculatedLines);

      // Delete old lines
      await client.query(`DELETE FROM invoice_lines WHERE invoice_id = $1`, [invoiceId]);

      // Insert new lines
      for (const line of calculatedLines) {
        await client.query(
          `INSERT INTO invoice_lines (
            id, invoice_id, product_id, description, quantity, unit_id,
            unit_price, discount_percent, discount_amount,
            tax_rate_id, tax_rate, tax_amount, line_total, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            newId(),
            invoiceId,
            line.product_id ?? null,
            line.description,
            line.quantity,
            line.unit_id ?? null,
            line.unit_price,
            line.discount_percent,
            line.discount_amount,
            line.tax_rate_id ?? null,
            line.tax_rate,
            line.tax_amount,
            line.line_total,
            line.sort_order,
          ],
        );
      }

      // Update invoice totals
      await client.query(
        `UPDATE invoices SET subtotal = $1, discount_total = $2, tax_total = $3, total = $4, balance = $4, updated_at = now()
         WHERE id = $5 AND tenant_id = current_tenant_id()`,
        [subtotal, discountTotal, taxTotal, total, invoiceId],
      );

      // ADR-0016: satır değişimi denetim izi — belge satırları + izi tek transaction'da.
      await this.writeAudit(client, {
        action: 'update',
        entityType: 'invoice_lines',
        entityId: invoiceId,
        userId,
        oldValues: { replaced: true },
        newValues: {
          line_count: calculatedLines.length,
          subtotal,
          tax_total: taxTotal,
          total,
        },
      });

      await client.query('COMMIT');
      return this.getInvoice(invoiceId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteInvoice(id: string, userId?: string) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prev = await client.query(
        `SELECT number, type, status, total FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [id],
      );
      const result = await client.query(
        `DELETE FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [id],
      );
      if (result.rowCount !== null && result.rowCount > 0) {
        // ADR-0016: silme denetim izi — silinen belge + izi tek transaction'da.
        await this.writeAudit(client, {
          action: 'delete',
          entityType: 'invoices',
          entityId: id,
          userId,
          oldValues: prev.rows[0] ?? null,
        });
      }
      await client.query('COMMIT');
      return result.rowCount !== null && result.rowCount > 0;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async addPayment(invoiceId: string, data: PaymentInput, userId: string) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invoiceResult = await client.query(
        `SELECT id, number, type, total, paid_amount, balance, currency, exchange_rate FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [invoiceId],
      );
      if (invoiceResult.rowCount === 0) {
        throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
      }

      const invoice = invoiceResult.rows[0];
      // Çoklu para birimi (SPEC §9.2): tahsilat belge para biriminde kaydedilir (paid_amount/balance,
      // invoices.total ile aynı birimde kalır), otomatik fiş ise fatura kuruyla TRY karşılığa (base) çevrilir.
      const baseRate = Number(invoice.exchange_rate ?? 1);
      const baseAmount = Number(data.amount) * baseRate;
      const newPaidAmount = Number(invoice.paid_amount) + data.amount;
      const newBalance = Number(invoice.total) - newPaidAmount;

      let newStatus = invoice.balance > 0 ? 'partial' : 'draft';
      if (newBalance <= 0) newStatus = 'paid';
      else if (newPaidAmount > 0) newStatus = 'partial';

      const paymentId = newId();
      const paymentDate = data.payment_date ?? new Date().toISOString().split('T')[0];

      await client.query(
        `INSERT INTO invoice_payments (id, invoice_id, amount, payment_date, payment_method, reference, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          paymentId,
          invoiceId,
          data.amount,
          paymentDate,
          data.payment_method,
          data.reference ?? null,
          data.notes ?? null,
        ],
      );

      await client.query(
        `UPDATE invoices SET paid_amount = $1, balance = $2, status = $3, updated_at = now()
         WHERE id = $4 AND tenant_id = current_tenant_id()`,
        [newPaidAmount, newBalance, newStatus, invoiceId],
      );

      // Otomatik muhasebeleştirme (tahsilat/ödeme) — SPEC §13/§15.
      // Tahsilat: Borç kasa/banka, Alacak 120 (Alıcılar).
      // Tediye : Borç 320 (Satıcılar), Alacak kasa/banka.
      let journalEntryId: string | null = null;
      if (['sales', 'purchase'].includes(invoice.type) && data.amount > 0) {
        const isInflow = invoice.type === 'sales';
        await ensureChartOfAccountsOn(client);
        const cashBank = await this.resolveCashBankForMethod(client, data.payment_method, isInflow);
        const control = await this.resolveAccountByCode(client, isInflow ? '120' : '320');
        if (cashBank && control) {
          await this.assertInvoicePeriodOpen(client, paymentDate);
          await client.query('SELECT pg_advisory_xact_lock(hashtext(current_setting($1)))', [
            'app.tenant_id',
          ]);
          const seq = await client.query(
            'SELECT COALESCE(MAX(entry_no), 0) + 1 AS next_no FROM journal_entries WHERE tenant_id = current_tenant_id()',
          );
          const entryNo = Number(seq.rows[0].next_no);
          const entryId = newId();
          journalEntryId = entryId;
          const description = `${isInflow ? 'Tahsilat' : 'Ödeme'} ${invoice.number}`;
          await client.query(
            `INSERT INTO journal_entries
               (id, tenant_id, entry_no, entry_date, entry_type, status, description,
                source_type, source_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
             VALUES ($1, current_tenant_id(), $2, $3, $4, 'posted', $5, 'invoice_payment', $6, $7, $7, $8, now(), $8, $8)`,
            [
              entryId,
              entryNo,
              paymentDate,
              isInflow ? 'tahsil' : 'tediye',
              description,
              paymentId,
              baseAmount,
              userId,
            ],
          );
          const lines = isInflow
            ? [
                { accountId: cashBank, debit: baseAmount, credit: 0 },
                { accountId: control, debit: 0, credit: baseAmount },
              ]
            : [
                { accountId: control, debit: baseAmount, credit: 0 },
                { accountId: cashBank, debit: 0, credit: baseAmount },
              ];
          let lineNo = 1;
          for (const l of lines) {
            await client.query(
              `INSERT INTO journal_lines
                 (id, tenant_id, entry_id, line_no, account_id, description, debit, credit, created_by, updated_by)
               VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8)`,
              [newId(), entryId, lineNo, l.accountId, description, l.debit, l.credit, userId],
            );
            lineNo++;
          }
        }
      }

      // ADR-0016: tahsilat/ödeme denetim izi (aynı transaction — ödeme + izi birlikte).
      await this.writeAudit(client, {
        action: 'create',
        entityType: 'invoice_payments',
        entityId: paymentId,
        userId,
        newValues: {
          invoice_id: invoiceId,
          invoice_number: invoice.number,
          amount: data.amount,
          exchange_rate: baseRate,
          base_amount: baseAmount,
          payment_method: data.payment_method,
          new_status: newStatus,
          journal_entry_id: journalEntryId,
        },
      });

      await client.query('COMMIT');
      return this.getInvoice(invoiceId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getTaxRates() {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT * FROM tax_rates WHERE tenant_id = current_tenant_id() AND is_active = true ORDER BY rate`,
    );
    return { data: result.rows };
  }

  async getInvoiceSequences() {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT * FROM invoice_sequences WHERE tenant_id = current_tenant_id() ORDER BY fiscal_year DESC`,
    );
    return { data: result.rows };
  }

  // ==================== Otomatik Muhasebeleştirme (Faz 3/5) ====================
  //
  // Çek modülü deseniyle aynı: hesap eşleme `account_mappings` → TDHP kodu fallback.

  /** Hesap kodu ile muhasebe hesabı çözer (tenant planı; yoksa null). */
  private async resolveAccountByCode(client: PoolClient, code: string): Promise<string | null> {
    const r = await client.query(
      'SELECT id FROM accounting_accounts WHERE tenant_id = current_tenant_id() AND code = $1 LIMIT 1',
      [code],
    );
    return r.rows[0]?.id ?? null;
  }

  /** `account_mappings` (source_type+direction) → TDHP kodu fallback. */
  private async resolveMappedAccount(
    client: PoolClient,
    sourceType: string,
    direction: 'debit' | 'credit',
    fallbackCode: string,
  ): Promise<string | null> {
    const r = await client.query(
      `SELECT aa.id
         FROM account_mappings am
         JOIN accounting_accounts aa ON aa.id = am.account_id AND aa.tenant_id = am.tenant_id
        WHERE am.tenant_id = current_tenant_id()
          AND am.source_type = $1 AND am.direction = $2
        LIMIT 1`,
      [sourceType, direction],
    );
    if (r.rows.length > 0) return r.rows[0].id;
    return this.resolveAccountByCode(client, fallbackCode);
  }

  /**
   * Ödeme yöntemine göre kasa/banka hesabı.
   * `account_mappings` ('cash'/'bank' + yön) → TDHP kodu fallback.
   * Tahsilat (giriş) → debit, tediye (çıkış) → credit.
   */
  private async resolveCashBankForMethod(
    client: PoolClient,
    method: string,
    isInflow: boolean,
  ): Promise<string | null> {
    const isBank = method === 'bank_transfer' || method === 'credit_card';
    const fallback =
      method === 'bank_transfer'
        ? '102'
        : method === 'check'
          ? isInflow
            ? '101'
            : '103'
          : method === 'credit_card'
            ? '108'
            : '100';
    return this.resolveMappedAccount(
      client,
      isBank ? 'bank' : 'cash',
      isInflow ? 'debit' : 'credit',
      fallback,
    );
  }

  /** Kapalı dönem kontrolü — accounting servisiyle aynı kural (SPEC §15). */
  private async assertInvoicePeriodOpen(client: PoolClient, entryDate: string): Promise<void> {
    const period = await client.query(
      `SELECT fp.status,
              (SELECT TRUE FROM period_locks pl
                 WHERE pl.period_id = fp.id AND pl.lock_date > $1 LIMIT 1) AS locked
         FROM fiscal_periods fp
        WHERE fp.tenant_id = current_tenant_id()
          AND $1 BETWEEN fp.start_date AND fp.end_date
        LIMIT 1`,
      [entryDate],
    );
    const row = period.rows[0];
    if (row?.status === 'closed') throw new AppError('PERIOD_LOCKED', 'Bu mali dönem kapatılmış.');
    if (row?.locked) throw new AppError('PERIOD_LOCKED', 'Bu tarih dönem kilidinin gerisinde.');
  }

  /**
   * Faturayı kesinleştirir + otomatik yevmiye fişi üretir (SPEC §12.2, §15).
   * `posting_status='posted'`; tahsilat durumundan (`status`) bağımsızdır.
   * Fiş kaynağı (`source_type='invoice'`, `source_id`) benzersiz → idempotent.
   */
  async postInvoice(id: string, userId: string) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invRes = await client.query(
        `SELECT * FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE`,
        [id],
      );
      if (invRes.rows.length === 0) throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
      const invoice = invRes.rows[0];

      if (invoice.posting_status === 'posted') {
        const existing = await client.query(
          `SELECT id, entry_no FROM journal_entries
            WHERE tenant_id = current_tenant_id()
              AND source_type = 'invoice' AND source_id = $1 AND status = 'posted'
            LIMIT 1`,
          [id],
        );
        await client.query('COMMIT');
        return {
          invoiceId: id,
          entryId: existing.rows[0]?.id ?? null,
          entryNo: existing.rows[0]?.entry_no ?? null,
          alreadyPosted: true,
        };
      }
      if (invoice.status === 'cancelled') {
        throw new AppError('VALIDATION_ERROR', 'İptal edilmiş fatura kesinleştirilemez.');
      }
      if (!['sales', 'purchase'].includes(invoice.type)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Bu belge türü için otomatik muhasebeleştirme desteklenmiyor.',
        );
      }

      // Çoklu para birimi (SPEC §9.2): fiş TRY (yerel) cinsinden üretilir — belge tutarları
      // base_total / exchange_rate ile TRY karşılığa çevrilir (dövizli faturada 120/320/600
      // gibi hesaplar her zaman TRY bazında dengelenir).
      const rate = Number(invoice.exchange_rate) || 1;
      const net = (Number(invoice.subtotal) - Number(invoice.discount_total)) * rate;
      const vat = Number(invoice.tax_total) * rate;
      const total = Number(invoice.base_total) || Number(invoice.total) * rate;
      const rawDate = invoice.issue_date;
      const entryDate =
        (rawDate instanceof Date ? rawDate.toISOString() : String(rawDate)).slice(0, 10) ||
        new Date().toISOString().slice(0, 10);

      await this.assertInvoicePeriodOpen(client, entryDate);

      // Hesap planı yoksa otomatik kur (fallback TDHP kodları mevcut olsun).
      await ensureChartOfAccountsOn(client);

      const lines: Array<{ accountId: string; debit: number; credit: number }> = [];
      if (invoice.type === 'sales') {
        const receivable = await this.resolveAccountByCode(client, '120');
        const salesAcc = await this.resolveMappedAccount(client, 'sales', 'credit', '600');
        const vatAcc = await this.resolveMappedAccount(client, 'vat_output', 'credit', '391');
        if (!receivable || !salesAcc) {
          throw new AppError('VALIDATION_ERROR', 'Muhasebe hesabı çözülemedi (TDHP/hesap eşleme).');
        }
        lines.push({ accountId: receivable, debit: total, credit: 0 });
        lines.push({ accountId: salesAcc, debit: 0, credit: net });
        if (vat > 0 && vatAcc) lines.push({ accountId: vatAcc, debit: 0, credit: vat });
      } else {
        const payable = await this.resolveAccountByCode(client, '320');
        const stockAcc = await this.resolveMappedAccount(client, 'purchase', 'debit', '153');
        const vatAcc = await this.resolveMappedAccount(client, 'vat_input', 'debit', '191');
        if (!payable || !stockAcc) {
          throw new AppError('VALIDATION_ERROR', 'Muhasebe hesabı çözülemedi (TDHP/hesap eşleme).');
        }
        lines.push({ accountId: stockAcc, debit: net, credit: 0 });
        if (vat > 0 && vatAcc) lines.push({ accountId: vatAcc, debit: vat, credit: 0 });
        lines.push({ accountId: payable, debit: 0, credit: total });
      }

      const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
      if (Math.abs(totalDebit - totalCredit) > 0.005) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Fiş dengeli değil: borç ${totalDebit} != alacak ${totalCredit}`,
        );
      }

      await client.query('SELECT pg_advisory_xact_lock(hashtext(current_setting($1)))', [
        'app.tenant_id',
      ]);
      const seq = await client.query(
        'SELECT COALESCE(MAX(entry_no), 0) + 1 AS next_no FROM journal_entries WHERE tenant_id = current_tenant_id()',
      );
      const entryNo = Number(seq.rows[0].next_no);
      const entryId = newId();
      const description = `Fatura ${invoice.number}`;

      await client.query(
        `INSERT INTO journal_entries
           (id, tenant_id, entry_no, entry_date, entry_type, status, description,
            source_type, source_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, 'mahsup', 'posted', $4, 'invoice', $5, $6, $7, $8, now(), $8, $8)`,
        [entryId, entryNo, entryDate, description, id, totalDebit, totalCredit, userId],
      );

      let lineNo = 1;
      for (const l of lines) {
        await client.query(
          `INSERT INTO journal_lines
             (id, tenant_id, entry_id, line_no, account_id, description, debit, credit, created_by, updated_by)
           VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8)`,
          [newId(), entryId, lineNo, l.accountId, description, l.debit, l.credit, userId],
        );
        lineNo++;
      }

      await client.query(
        `UPDATE invoices SET posting_status = 'posted', posted_at = now(), updated_at = now()
          WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [id],
      );

      // ADR-0016: kesinleştirme (otomatik muhasebeleştirme) denetim izi — aynı
      // transaction. Fatura + fiş + iz birlikte kalıcılaşır (SPEC §12.2, §15).
      await this.writeAudit(client, {
        action: 'update',
        entityType: 'invoices',
        entityId: id,
        userId,
        newValues: {
          action: 'posted',
          invoice_number: invoice.number,
          invoice_type: invoice.type,
          posting_status: 'posted',
          journal_entry_id: entryId,
          journal_entry_no: entryNo,
          total_debit: totalDebit,
          total_credit: totalCredit,
        },
      });

      await client.query('COMMIT');
      return {
        invoiceId: id,
        entryId,
        entryNo,
        alreadyPosted: false,
        totals: { totalDebit, totalCredit },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
