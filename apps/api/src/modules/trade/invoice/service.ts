import { getPool } from '@kuleplus/db';
import { AppError, newId, getRate, getLatestRate } from '@kuleplus/shared';
import type { Pool, PoolClient } from 'pg';
import { ensureChartOfAccountsOn } from '../../accounting/chart.js';
import { accountingService } from '../../accounting/service.js';
import { assertNoDuplicateDocument } from '../duplicate-document.js';
import {
  cashBankLedgerAccount,
  creditCardLedgerAccount,
  ensureAccountByCode,
  expenseCategoryLedgerAccount,
} from '../../accounting/subledger.js';
import {
  allocateEntryNo,
  isAccountingActive,
  openPeriodFor,
  round2,
  toIsoDate,
  toKurus,
  todayIso,
} from '../../accounting/ledger.js';
import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  ReplaceInvoiceLinesInput,
  PaymentInput,
  ListInvoicesQuery,
  WithholdingTypeInput,
} from './schemas.js';

interface LineWithTax {
  id: string;
  invoice_id: string;
  product_id: string | null;
  expense_category_id: string | null;
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
  /** KDV tevkifatı (Faz 7-3): tür + kesinleşmede kopyalanan kodlar/oran. */
  withholding_type_id: string | null;
  withholding_rate: number;
  withholding_einvoice_code: string | null;
  withholding_kdv2_code: string | null;
  withholding_amount: number;
}

/** `lockInvoice` sonucu: değişmezlik kararı için gereken alanlar. */
interface LockedInvoice {
  id: string;
  number: string;
  type: string;
  status: string;
  posting_status: string;
  paid_amount: string | number;
  returned_amount: string | number;
  total: string | number;
  reference_type: string | null;
  reference_id: string | null;
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
    lines.forEach((line, i) => {
      if (line.product_id && line.expense_category_id) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Satır ${i + 1}: aynı satırda hem ürün hem gider kategorisi seçilemez.`,
        );
      }
    });
    return lines.map((line, index) => {
      const baseAmount = line.quantity * line.unit_price;
      const discountAmount = baseAmount * (line.discount_percent / 100);
      const taxableAmount = baseAmount - discountAmount;
      const taxAmount = taxableAmount * (line.tax_rate / 100);
      const lineTotal = taxableAmount + taxAmount;
      // Tevkif edilen KDV = satır KDV'si × tevkifat oranı (ör. 4/10 → %40).
      const withholdingAmount = taxAmount * ((line.withholding_rate ?? 0) / 100);

      return {
        ...line,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        withholding_amount: withholdingAmount,
        line_total: lineTotal,
        sort_order: line.sort_order ?? index,
      };
    });
  }

  private calculateTotals(calculatedLines: ReturnType<typeof this.calculateLineTotals>) {
    const subtotal = calculatedLines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
    const discountTotal = calculatedLines.reduce((sum, l) => sum + l.discount_amount, 0);
    const taxTotal = calculatedLines.reduce((sum, l) => sum + l.tax_amount, 0);
    const withholdingTotal = calculatedLines.reduce((sum, l) => sum + (l.withholding_amount ?? 0), 0);
    // `total` = ödenecek tutar (matrah + KDV − tevkif edilen KDV); `tax_total` tam KDV.
    const total = subtotal - discountTotal + taxTotal - withholdingTotal;

    return { subtotal, discountTotal, taxTotal, withholdingTotal, total };
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
        expense_category_id: line.expense_category_id ?? null,
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
        withholding_type_id: line.withholding_type_id ?? null,
        withholding_rate: 0,
        withholding_einvoice_code: null,
        withholding_kdv2_code: null,
        withholding_amount: 0,
      }));
      await this.applyWithholdingTypes(
        client,
        linesWithTax,
        data.type,
        data.issue_date ?? todayIso(),
      );

      // Calculate totals
      const calculatedLines = this.calculateLineTotals(linesWithTax);
      const { subtotal, discountTotal, taxTotal, withholdingTotal, total } =
        this.calculateTotals(calculatedLines);

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
          notes, reference_type, reference_id, withholding_total, supplier_document_no
        ) VALUES (
          $1, current_tenant_id(),
          (SELECT id FROM invoice_sequences WHERE tenant_id = current_tenant_id() AND fiscal_year = $2),
          $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16, $17, $18, $19, $20
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
          withholdingTotal,
          data.supplier_document_no || null,
        ],
      );

      const invoice = invoiceResult.rows[0];

      // Insert lines
      for (const line of calculatedLines) {
        await client.query(
          `INSERT INTO invoice_lines (
            id, invoice_id, product_id, description, quantity, unit_id,
            unit_price, discount_percent, discount_amount,
            tax_rate_id, tax_rate, tax_amount, line_total, sort_order, expense_category_id,
            withholding_type_id, withholding_rate, withholding_einvoice_code, withholding_kdv2_code,
            withholding_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
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
            line.expense_category_id ?? null,
            line.withholding_type_id ?? null,
            line.withholding_rate ?? 0,
            line.withholding_einvoice_code ?? null,
            line.withholding_kdv2_code ?? null,
            line.withholding_amount ?? 0,
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

  /**
   * Kesinleşmiş (posting_status='posted') fatura değişmezdir (SPEC §10.1): yalnızca not ve
   * vade tarihi güncellenebilir, ya da iptal edilir (yevmiye fişi ters kayıtla birlikte
   * düzeltilir). İptal edilmiş fatura hiç değiştirilemez.
   */
  private async lockInvoice(client: PoolClient, id: string) {
    const r = await client.query(
      `SELECT id, number, type, status, posting_status, paid_amount, returned_amount, total,
              reference_type, reference_id
         FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE`,
      [id],
    );
    if (r.rows.length === 0) throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
    return r.rows[0] as LockedInvoice;
  }

  /**
   * Faturayı iptal eder. Kesinleşmişse yevmiye fişi aynı transaction'da ters kayıtla
   * düzeltilir. Ödemesi olan fatura iptal edilemez (ödeme fişleri ayrıca düzeltilmelidir).
   */
  private async cancelInvoiceOn(
    client: PoolClient,
    inv: LockedInvoice,
    userId?: string,
  ): Promise<string | null> {
    if (Number(inv.paid_amount) > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Ödemesi olan fatura iptal edilemez; önce ödeme kayıtlarını düzeltin.',
      );
    }
    if (Number(inv.returned_amount ?? 0) > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Bağlı iade faturası olan fatura iptal edilemez; önce iade faturasını iptal edin.',
      );
    }
    // Kesinleşmiş ve orijinal faturaya bağlı iade iptal edilirse orijinalin bakiyesi geri gelir.
    if (
      inv.posting_status === 'posted' &&
      ['credit_note', 'debit_note'].includes(inv.type) &&
      inv.reference_type === 'invoice' &&
      inv.reference_id
    ) {
      await client.query(
        `UPDATE invoices
            SET returned_amount = returned_amount - $1,
                balance = balance + $1,
                status = CASE WHEN status = 'paid' AND balance + $1 > 0
                              THEN (CASE WHEN paid_amount > 0 THEN 'partial' ELSE 'sent' END)
                              ELSE status END,
                updated_at = now()
          WHERE id = $2 AND tenant_id = current_tenant_id()`,
        [Number(inv.total), inv.reference_id],
      );
    }
    let reversalId: string | null = null;
    if (inv.posting_status === 'posted') {
      const entry = await client.query(
        `SELECT id FROM journal_entries
          WHERE tenant_id = current_tenant_id() AND source_type = 'invoice' AND source_id = $1
            AND status = 'posted' AND entry_type <> 'ters'
            AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = journal_entries.id)
          LIMIT 1`,
        [inv.id],
      );
      if (entry.rows[0]) {
        const rev = await accountingService.reverseEntryOn(
          client,
          entry.rows[0].id,
          userId ?? '',
          undefined,
          { allowSource: true },
        );
        reversalId = rev.id;
      }
    }
    await client.query(
      `UPDATE invoices SET status = 'cancelled', posting_status = 'cancelled', updated_at = now()
        WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [inv.id],
    );
    await this.writeAudit(client, {
      action: 'update',
      entityType: 'invoices',
      entityId: inv.id,
      userId,
      oldValues: { status: inv.status, posting_status: inv.posting_status },
      newValues: {
        action: 'cancelled',
        invoice_number: inv.number,
        reversal_entry_id: reversalId,
      },
    });
    return reversalId;
  }

  async updateInvoice(id: string, data: UpdateInvoiceInput, userId?: string) {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    let didCancel = false;
    try {
      await client.query('BEGIN');

      const inv = await this.lockInvoice(client, id);
      if (inv.posting_status === 'cancelled' || inv.status === 'cancelled') {
        throw new AppError('FORBIDDEN', 'İptal edilmiş fatura değiştirilemez.');
      }
      if (inv.posting_status === 'posted') {
        const allowed = new Set(['notes', 'due_date', 'status']);
        const illegal = Object.keys(data).filter(
          (k) => (data as Record<string, unknown>)[k] !== undefined && !allowed.has(k),
        );
        if (illegal.length > 0 || (data.status !== undefined && data.status !== 'cancelled')) {
          throw new AppError(
            'FORBIDDEN',
            'Kesinleşmiş fatura değiştirilemez; yalnızca not/vade güncellenir veya fatura iptal edilir.',
          );
        }
      }
      if (data.status === 'cancelled') {
        await this.cancelInvoiceOn(client, inv, userId);
        didCancel = true;
        delete (data as { status?: string }).status;
      }

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
        if (didCancel) {
          await client.query('COMMIT');
        } else {
          await client.query('ROLLBACK');
        }
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
      const invoiceCheck = await this.lockInvoice(client, invoiceId);
      if (invoiceCheck.posting_status !== 'draft') {
        throw new AppError(
          'FORBIDDEN',
          'Kesinleşmiş veya iptal edilmiş faturanın satırları değiştirilemez.',
        );
      }
      if (!['draft', 'proforma'].includes(invoiceCheck.status)) {
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
        expense_category_id: line.expense_category_id ?? null,
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
        withholding_type_id: line.withholding_type_id ?? null,
        withholding_rate: 0,
        withholding_einvoice_code: null,
        withholding_kdv2_code: null,
        withholding_amount: 0,
      }));
      const head = await client.query(
        'SELECT type, issue_date FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id()',
        [invoiceId],
      );
      await this.applyWithholdingTypes(
        client,
        linesWithTax,
        String(head.rows[0].type),
        toIsoDate(head.rows[0].issue_date),
      );

      const calculatedLines = this.calculateLineTotals(linesWithTax);
      const { subtotal, discountTotal, taxTotal, withholdingTotal, total } =
        this.calculateTotals(calculatedLines);

      // Delete old lines
      await client.query(`DELETE FROM invoice_lines WHERE invoice_id = $1`, [invoiceId]);

      // Insert new lines
      for (const line of calculatedLines) {
        await client.query(
          `INSERT INTO invoice_lines (
            id, invoice_id, product_id, description, quantity, unit_id,
            unit_price, discount_percent, discount_amount,
            tax_rate_id, tax_rate, tax_amount, line_total, sort_order, expense_category_id,
            withholding_type_id, withholding_rate, withholding_einvoice_code, withholding_kdv2_code,
            withholding_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
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
            line.expense_category_id ?? null,
            line.withholding_type_id ?? null,
            line.withholding_rate ?? 0,
            line.withholding_einvoice_code ?? null,
            line.withholding_kdv2_code ?? null,
            line.withholding_amount ?? 0,
          ],
        );
      }

      // Update invoice totals
      await client.query(
        `UPDATE invoices SET subtotal = $1, discount_total = $2, tax_total = $3, total = $4,
                balance = $4 - paid_amount - returned_amount, withholding_total = $6, updated_at = now()
         WHERE id = $5 AND tenant_id = current_tenant_id()`,
        [subtotal, discountTotal, taxTotal, total, invoiceId, withholdingTotal],
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
      const inv = await client.query(
        `SELECT posting_status FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE`,
        [id],
      );
      if (inv.rows[0]) {
        const hasEntry = await client.query(
          `SELECT 1 FROM journal_entries
            WHERE tenant_id = current_tenant_id() AND source_type IN ('invoice') AND source_id = $1
            LIMIT 1`,
          [id],
        );
        if (inv.rows[0].posting_status === 'posted' || (hasEntry.rowCount ?? 0) > 0) {
          throw new AppError(
            'FORBIDDEN',
            'Kesinleşmiş faturanın muhasebe kaydı vardır; silinemez, iptal edin.',
          );
        }
      }
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
        `SELECT id, number, type, status, posting_status, total, paid_amount, returned_amount, balance, currency, exchange_rate FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE`,
        [invoiceId],
      );
      if (invoiceResult.rowCount === 0) {
        throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
      }

      const invoice = invoiceResult.rows[0];
      const paymentDate = data.payment_date ?? todayIso();

      if (invoice.status === 'cancelled' || invoice.posting_status === 'cancelled') {
        throw new AppError('VALIDATION_ERROR', 'İptal edilmiş faturaya ödeme eklenemez.');
      }
      // Muhasebe aktifken ödeme, kesinleşmiş faturaya yazılır: aksi halde tahsilat fişi
      // 120/320'yi alacaklandırır ama faturanın borç kaydı henüz yoktur (SPEC §10.3).
      const postsJournal =
        ['sales', 'purchase'].includes(invoice.type) &&
        data.amount > 0 &&
        (await isAccountingActive(client));
      if (postsJournal && invoice.posting_status !== 'posted') {
        throw new AppError(
          'VALIDATION_ERROR',
          'Muhasebe aktifken ödeme yalnızca kesinleşmiş faturaya girilebilir; önce faturayı kesinleştirin.',
        );
      }

      // Çoklu para birimi + kur farkı (SPEC §9.2):
      // - paid_amount/balance, invoices.total ile aynı birimde (belge para biriminde) kalır.
      // - Otomatik fiş TRY karşılıkla kesilir. Kur farkı hesapları (646 kambiyo kârı / 656 kambiyo
      //   zararı) ve ödeme tarihi kuru çözülebiliyorsa ödeme ödeme günü kuruyla TRY'ye çevrilir;
      //   fatura kuru (-kapanış) ile fark 646/656'ya kur farkı olarak yazılır. Kur çözülemezse
      //   fatura kuru kullanılır (kur farkı doğmaz — eski davranış).
      const invoiceRate = Number(invoice.exchange_rate ?? 1);
      const invoiceCurrency = (invoice.currency || 'TRY').toUpperCase();
      const gainAccount = await this.resolveAccountByCode(client, '646');
      const lossAccount = await this.resolveAccountByCode(client, '656');
      let paymentRate = invoiceRate;
      if (gainAccount && lossAccount && invoiceCurrency !== 'TRY') {
        try {
          const resolved = await this.resolveInvoiceRate(client, invoiceCurrency, undefined, paymentDate);
          paymentRate = resolved.exchangeRate;
        } catch {
          /* kur çözülemedi → fatura kuru kullanılır */
        }
      }
      // Kuruşa yuvarlanmış TRY karşılıklar: fiş satırları numeric(18,2)'ye yazılır; kur farkı
      // yuvarlanmış değerlerden hesaplanır ki fiş kuruşu kuruşuna dengeli kalsın (SPEC §10.5).
      const baseAmount = round2(Number(data.amount) * paymentRate);
      // Faturanın kurundan kapanış payı — cari (120/320) fatura kuruyla kapatılır.
      const invoicePortion = round2(Number(data.amount) * invoiceRate);
      const newPaidAmount = Number(invoice.paid_amount) + data.amount;
      const newBalance =
        Number(invoice.total) - newPaidAmount - Number(invoice.returned_amount ?? 0);

      let newStatus = invoice.balance > 0 ? 'partial' : 'draft';
      if (newBalance <= 0) newStatus = 'paid';
      else if (newPaidAmount > 0) newStatus = 'partial';

      const paymentId = newId();

      await client.query(
        `INSERT INTO invoice_payments (id, invoice_id, amount, payment_date, payment_method, reference, notes, exchange_rate, base_amount, cash_bank_account_id, credit_card_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          paymentId,
          invoiceId,
          data.amount,
          paymentDate,
          data.payment_method,
          data.reference ?? null,
          data.notes ?? null,
          paymentRate,
          baseAmount,
          data.cash_bank_account_id ?? null,
          data.credit_card_id ?? null,
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
      // Muhasebe modülü aktif değilse fiş ve hesap planı oluşturulmaz (SPEC §10.3).
      if (postsJournal) {
        const isInflow = invoice.type === 'sales';
        await ensureChartOfAccountsOn(client);
        // Hesap seçimi (Faz 7-1): şirket kartıyla ödeme → 309.xx, belirli kasa/banka → kendi
        // alt hesabı, aksi halde ödeme yöntemine göre ana hesap (eski davranış).
        let cashBank: string | null = null;
        if (data.credit_card_id) {
          if (isInflow) {
            throw new AppError(
              'VALIDATION_ERROR',
              'Şirket kredi kartı yalnızca ödemede (alış faturası) kullanılabilir.',
            );
          }
          cashBank = await creditCardLedgerAccount(client, data.credit_card_id);
          if (!cashBank) throw new AppError('NOT_FOUND', 'Kredi kartı bulunamadı');
        } else if (data.cash_bank_account_id) {
          cashBank = await cashBankLedgerAccount(client, data.cash_bank_account_id);
          if (!cashBank) throw new AppError('NOT_FOUND', 'Kasa/banka hesabı bulunamadı');
        } else {
          cashBank = await this.resolveCashBankForMethod(client, data.payment_method, isInflow);
        }
        const control = await this.resolveAccountByCode(client, isInflow ? '120' : '320');
        if (cashBank && control) {
          const periodId = await openPeriodFor(client, paymentDate);
          const entryId = newId();
          journalEntryId = entryId;
          const description = `${isInflow ? 'Tahsilat' : 'Ödeme'} ${invoice.number}`;
          const lines = isInflow
            ? [
                { accountId: cashBank, debit: baseAmount, credit: 0 },
                { accountId: control, debit: 0, credit: invoicePortion },
              ]
            : [
                { accountId: control, debit: invoicePortion, credit: 0 },
                { accountId: cashBank, debit: 0, credit: baseAmount },
              ];
          // Kur farkı: satışta +fark kambiyo kârı (646), alışta +fark kambiyo zararı (656).
          const fxDiff = round2(baseAmount - invoicePortion);
          let fxGain = 0;
          let fxLoss = 0;
          if (Math.abs(fxDiff) >= 0.005) {
            if ((isInflow && fxDiff > 0) || (!isInflow && fxDiff < 0)) fxGain = Math.abs(fxDiff);
            else fxLoss = Math.abs(fxDiff);
          }
          if (fxGain > 0) lines.push({ accountId: gainAccount!, debit: 0, credit: fxGain });
          if (fxLoss > 0) lines.push({ accountId: lossAccount!, debit: fxLoss, credit: 0 });
          // Başlık toplamı satırlardan: kur farkı satırı varsa borç/alacak toplamı baseAmount'tan
          // farklıdır (eski kod başlığa baseAmount yazıyordu → başlık/satır uyuşmazlığı).
          const headDebit = lines.reduce((sum, l) => sum + toKurus(l.debit), 0) / 100;
          const headCredit = lines.reduce((sum, l) => sum + toKurus(l.credit), 0) / 100;
          const entryNo = await allocateEntryNo(client);
          await client.query(
            `INSERT INTO journal_entries
               (id, tenant_id, entry_no, entry_date, period_id, entry_type, status, description,
                source_type, source_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
             VALUES ($1, current_tenant_id(), $2, $3, $4, $5, 'posted', $6, 'invoice_payment', $7, $8, $9, $10, now(), $10, $10)`,
            [
              entryId,
              entryNo,
              paymentDate,
              periodId,
              isInflow ? 'tahsil' : 'tediye',
              description,
              paymentId,
              headDebit,
              headCredit,
              userId,
            ],
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
          exchange_rate: paymentRate,
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

  /** Tevkifat türleri (Faz 7-3). `activeOn` verilirse yalnızca o tarihte geçerli aktif türler. */
  async listWithholdingTypes(activeOn?: string) {
    const pool = this.getPoolInstance();
    const params: unknown[] = [];
    let where = 'tenant_id = current_tenant_id()';
    if (activeOn) {
      params.push(activeOn);
      where += ` AND is_active AND valid_from <= $1::date AND (valid_to IS NULL OR valid_to >= $1::date)`;
    }
    const result = await pool.query(
      `SELECT * FROM withholding_types WHERE ${where} ORDER BY einvoice_code, valid_from`,
      params,
    );
    return { data: result.rows };
  }

  async createWithholdingType(data: WithholdingTypeInput) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `INSERT INTO withholding_types
         (id, tenant_id, name, einvoice_code, kdv2_code, rate_numerator, valid_from, valid_to, is_active)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, COALESCE($6::date, DATE '2000-01-01'), $7, $8)
       RETURNING *`,
      [
        newId(),
        data.name,
        data.einvoice_code,
        data.kdv2_code,
        data.rate_numerator,
        data.valid_from ?? null,
        data.valid_to ?? null,
        data.is_active ?? true,
      ],
    );
    return result.rows[0];
  }

  /**
   * Tür güncellemesi kesinleşmiş belgeleri etkilemez (kodlar/oran satıra kopyalıdır).
   * Oran değişikliği için eski kaydı `valid_to` ile kapatıp yeni geçerlilikle kayıt açmak önerilir.
   */
  async updateWithholdingType(id: string, data: Partial<WithholdingTypeInput>) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `UPDATE withholding_types SET
         name = COALESCE($2, name),
         einvoice_code = COALESCE($3, einvoice_code),
         kdv2_code = COALESCE($4, kdv2_code),
         rate_numerator = COALESCE($5, rate_numerator),
         valid_from = COALESCE($6::date, valid_from),
         valid_to = CASE WHEN $9::boolean THEN $7::date ELSE valid_to END,
         is_active = COALESCE($8, is_active),
         version = version + 1, updated_at = now()
       WHERE id = $1 AND tenant_id = current_tenant_id()
       RETURNING *`,
      [
        id,
        data.name ?? null,
        data.einvoice_code ?? null,
        data.kdv2_code ?? null,
        data.rate_numerator ?? null,
        data.valid_from ?? null,
        data.valid_to ?? null,
        data.is_active ?? null,
        data.valid_to !== undefined,
      ],
    );
    if (result.rows.length === 0) throw new AppError('NOT_FOUND', 'Tevkifat türü bulunamadı');
    return result.rows[0];
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

  /**
   * Satırlardaki tevkifat türlerini çözer ve kodları/oranı satıra kopyalar (snapshot, Faz 7-3).
   * Tür: bu tenant'ın, aktif ve belge tarihinde geçerli kaydı olmalı. Tevkifat yalnızca
   * satış/alış faturasında ve KDV'li satırda uygulanır.
   */
  private async applyWithholdingTypes(
    client: PoolClient,
    lines: LineWithTax[],
    invoiceType: string,
    issueDate: string,
  ): Promise<void> {
    const ids = [...new Set(lines.map((l) => l.withholding_type_id).filter(Boolean))] as string[];
    if (ids.length === 0) return;
    if (!['sales', 'purchase'].includes(invoiceType)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'KDV tevkifatı yalnızca satış ve alış faturasında uygulanabilir.',
      );
    }
    const r = await client.query(
      `SELECT id, einvoice_code, kdv2_code, rate_numerator, rate_denominator
         FROM withholding_types
        WHERE tenant_id = current_tenant_id() AND id = ANY($1::uuid[]) AND is_active
          AND valid_from <= $2::date AND (valid_to IS NULL OR valid_to >= $2::date)`,
      [ids, issueDate],
    );
    const byId = new Map(r.rows.map((row) => [String(row.id), row]));
    lines.forEach((line, i) => {
      if (!line.withholding_type_id) return;
      const t = byId.get(line.withholding_type_id);
      if (!t) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Satır ${i + 1}: tevkifat türü bulunamadı, pasif veya belge tarihinde geçerli değil.`,
        );
      }
      if (!(Number(line.tax_rate) > 0)) {
        throw new AppError('VALIDATION_ERROR', `Satır ${i + 1}: KDV'siz satıra tevkifat uygulanamaz.`);
      }
      line.withholding_rate = (Number(t.rate_numerator) / Number(t.rate_denominator)) * 100;
      line.withholding_einvoice_code = String(t.einvoice_code);
      line.withholding_kdv2_code = String(t.kdv2_code);
    });
  }

  /**
   * Alışta tevkif edilen KDV'yi KDV-2 koduna göre 360.01.<kod> hesaplarına dağıtır
   * (Sorumlu Sıfatıyla Ödenecek KDV). Kuruş; yuvarlama farkı en büyük kaleme eklenir.
   */
  private async withholdingAllocation(
    client: PoolClient,
    invoiceId: string,
    rate: number,
    withholding: number,
  ): Promise<Array<{ accountId: string; creditK: number }>> {
    if (toKurus(withholding) === 0) return [];
    const r = await client.query(
      `SELECT il.withholding_kdv2_code AS kdv2, MAX(il.withholding_rate) AS pct,
              MAX(wt.name) AS name, SUM(il.withholding_amount) AS amount
         FROM invoice_lines il
         LEFT JOIN withholding_types wt ON wt.id = il.withholding_type_id
        WHERE il.invoice_id = $1 AND il.withholding_amount > 0
        GROUP BY il.withholding_kdv2_code
        ORDER BY il.withholding_kdv2_code`,
      [invoiceId],
    );
    await ensureAccountByCode(client, '360.01', 'Sorumlu Sıfatıyla Ödenecek KDV', '360');
    const parts: Array<{ accountId: string; creditK: number }> = [];
    for (const row of r.rows) {
      const kdv2 = String(row.kdv2 ?? '000');
      const numerator = Math.round(Number(row.pct) / 10);
      const accountId = await ensureAccountByCode(
        client,
        `360.01.${kdv2}`,
        `${row.name ?? 'Tevkifat'} (${numerator}/10) — KDV-2 ${kdv2}`,
        '360.01',
      );
      parts.push({ accountId, creditK: toKurus(Number(row.amount) * rate) });
    }
    const residual = toKurus(withholding) - parts.reduce((sum, p) => sum + p.creditK, 0);
    if (residual !== 0 && parts.length > 0) {
      parts.sort((a, b) => b.creditK - a.creditK);
      parts[0]!.creditK += residual;
    }
    return parts.filter((p) => p.creditK !== 0);
  }

  /**
   * İade faturası (credit_note/debit_note) orijinal faturaya bağlıysa (reference_type='invoice'):
   * orijinal aynı cariye ait, karşı türde (alınan iade → satış, verilen iade → alış), kesinleşmiş
   * ve aynı para biriminde olmalı; iade tutarı orijinalin kalan bakiyesini aşamaz. Tutar
   * orijinalin bakiyesinden düşülür, iadenin kendi bakiyesi kapanır.
   */
  private async applyReturnLink(
    client: PoolClient,
    note: Record<string, unknown>,
  ): Promise<void> {
    if (!['credit_note', 'debit_note'].includes(String(note.type))) return;
    if (note.reference_type !== 'invoice' || !note.reference_id) return;
    const orig = await client.query(
      `SELECT id, number, type, contact_id, currency, posting_status, status, balance
         FROM invoices WHERE id = $1 AND tenant_id = current_tenant_id() FOR UPDATE`,
      [note.reference_id],
    );
    const o = orig.rows[0];
    if (!o) throw new AppError('NOT_FOUND', 'İadenin bağlı olduğu fatura bulunamadı.');
    const expected = note.type === 'credit_note' ? 'sales' : 'purchase';
    if (o.type !== expected) {
      throw new AppError(
        'VALIDATION_ERROR',
        note.type === 'credit_note'
          ? 'Alınan iade yalnızca bir satış faturasına bağlanabilir.'
          : 'Verilen iade yalnızca bir alış faturasına bağlanabilir.',
      );
    }
    if (o.posting_status !== 'posted' || o.status === 'cancelled') {
      throw new AppError('VALIDATION_ERROR', 'İade yalnızca kesinleşmiş faturaya bağlanabilir.');
    }
    if (note.contact_id && o.contact_id && note.contact_id !== o.contact_id) {
      throw new AppError('VALIDATION_ERROR', 'İade ile orijinal fatura aynı cariye ait olmalı.');
    }
    if (String(note.currency ?? 'TRY').trim() !== String(o.currency ?? 'TRY').trim()) {
      throw new AppError('VALIDATION_ERROR', 'İade ile orijinal fatura aynı para biriminde olmalı.');
    }
    const amount = Number(note.total);
    if (toKurus(amount) > toKurus(Number(o.balance))) {
      throw new AppError(
        'VALIDATION_ERROR',
        `İade tutarı (${amount}) orijinal faturanın kalan bakiyesini (${Number(o.balance)}) aşamaz.`,
      );
    }
    await client.query(
      `UPDATE invoices
          SET returned_amount = returned_amount + $1,
              balance = balance - $1,
              status = CASE WHEN balance - $1 <= 0 THEN 'paid' ELSE status END,
              updated_at = now()
        WHERE id = $2 AND tenant_id = current_tenant_id()`,
      [amount, o.id],
    );
    await client.query(
      `UPDATE invoices SET balance = 0, status = 'paid', updated_at = now()
        WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [note.id],
    );
  }

  /**
   * Alış faturası matrahını satırlara göre borç hesaplarına dağıtır (Faz 7-2):
   *  - stok takipli ürün → stok hesabı (hesap eşleme 'purchase' | 153),
   *  - stok takipsiz ürün → satırdaki ya da ürün kartındaki varsayılan gider kategorisi,
   *  - ürünsüz satır → satırın gider kategorisi,
   *  - hiçbiri yoksa kesinleştirme reddedilir (yanlış hesaba sessiz kayıt yok).
   * Tutarlar kuruştur; yuvarlama farkı en büyük kaleme eklenir ki toplam = `net` olsun.
   */
  private async purchaseDebitAllocation(
    client: PoolClient,
    invoiceId: string,
    rate: number,
    stockAccountId: string,
    net: number,
  ): Promise<Array<{ accountId: string; debitK: number }>> {
    const r = await client.query(
      `SELECT il.description, il.product_id, il.expense_category_id,
              (il.line_total - il.tax_amount) AS taxable,
              p.track_inventory, p.default_expense_category_id
         FROM invoice_lines il
         LEFT JOIN products p ON p.id = il.product_id
        WHERE il.invoice_id = $1
        ORDER BY il.sort_order, il.id`,
      [invoiceId],
    );
    if (r.rows.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Satırı olmayan fatura kesinleştirilemez.');
    }
    const byAccount = new Map<string, number>();
    let index = 0;
    for (const row of r.rows) {
      index++;
      let accountId: string | null = null;
      if (row.product_id && row.track_inventory !== false) {
        accountId = stockAccountId;
      } else {
        const categoryId = row.expense_category_id ?? row.default_expense_category_id ?? null;
        if (categoryId) accountId = await expenseCategoryLedgerAccount(client, String(categoryId));
      }
      if (!accountId) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Satır ${index} ("${row.description}"): stok ürünü veya gider kategorisi seçin.`,
        );
      }
      byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + toKurus(Number(row.taxable) * rate));
    }
    const parts = [...byAccount.entries()].map(([accountId, debitK]) => ({ accountId, debitK }));
    const residual = toKurus(net) - parts.reduce((sum, p) => sum + p.debitK, 0);
    if (residual !== 0) {
      parts.sort((a, b) => b.debitK - a.debitK);
      parts[0]!.debitK += residual;
    }
    return parts.filter((p) => p.debitK !== 0);
  }

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
              AND source_type = 'invoice' AND source_id = $1 AND status = 'posted' AND entry_type <> 'ters'
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
      if (!['sales', 'purchase', 'credit_note', 'debit_note'].includes(invoice.type)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Bu belge türü için otomatik muhasebeleştirme desteklenmiyor.',
        );
      }

      // İade faturası orijinal faturaya bağlıysa: tutar kontrolü + orijinalin bakiyesinden düş.
      // Muhasebe modülünden bağımsız ticari etkidir (cari bakiye), bu yüzden fişten önce.
      await this.applyReturnLink(client, invoice);

      const accountingActive = await isAccountingActive(client);
      // Alış faturası: tedarikçi belge no (muhasebe aktifken zorunlu) + mükerrer belge engeli.
      if (invoice.type === 'purchase') {
        if (accountingActive && !String(invoice.supplier_document_no ?? '').trim()) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Alış faturasında tedarikçinin belge numarası (supplier_document_no) zorunludur.',
          );
        }
        await assertNoDuplicateDocument(client, {
          documentNo: invoice.supplier_document_no,
          contactId: invoice.contact_id,
          excludeInvoiceId: id,
        });
      }

      // Muhasebe modülü aktif değilse fatura yine kesinleşir (posting_status) ama yevmiye
      // fişi ve hesap planı oluşturulmaz (SPEC §10.3: "modül aktifse fiş").
      if (!accountingActive) {
        await client.query(
          `UPDATE invoices SET posting_status = 'posted', posted_at = now(), updated_at = now()
            WHERE id = $1 AND tenant_id = current_tenant_id()`,
          [id],
        );
        await this.writeAudit(client, {
          action: 'update',
          entityType: 'invoices',
          entityId: id,
          userId,
          newValues: {
            action: 'posted',
            invoice_number: invoice.number,
            posting_status: 'posted',
            journal_entry_id: null,
            accounting_active: false,
          },
        });
        await client.query('COMMIT');
        return { invoiceId: id, entryId: null, entryNo: null, alreadyPosted: false, journal: false };
      }

      // Çoklu para birimi (SPEC §9.2): fiş TRY (yerel) cinsinden üretilir — belge tutarları
      // base_total / exchange_rate ile TRY karşılığa çevrilir (dövizli faturada 120/320/600
      // gibi hesaplar her zaman TRY bazında dengelenir).
      // Kuruşa yuvarlanır; dövizli belgede net+KDV TL karşılığı ile base_total arasında
      // kalan kuruş farkı (≤ KURUS_TOLERANCE) matrah satırına eklenir — fiş tam dengeli olur.
      const KURUS_TOLERANCE = 5;
      const rate = Number(invoice.exchange_rate) || 1;
      const vat = round2(Number(invoice.tax_total) * rate);
      const withholding = round2(Number(invoice.withholding_total ?? 0) * rate);
      const total = round2(Number(invoice.base_total) || Number(invoice.total) * rate);
      let net = round2((Number(invoice.subtotal) - Number(invoice.discount_total)) * rate);
      // total (ödenecek) = matrah + KDV − tevkifat
      const roundingK = toKurus(total) - (toKurus(net) + toKurus(vat) - toKurus(withholding));
      if (roundingK !== 0 && Math.abs(roundingK) <= KURUS_TOLERANCE) {
        net = (toKurus(net) + roundingK) / 100;
      }
      // issue_date pg'den yerel gece yarısı Date gelir; toISOString() UTC+3'te bir gün
      // geri kayıyordu → yerel tarih bileşenleri (toIsoDate).
      const entryDate = invoice.issue_date ? toIsoDate(invoice.issue_date) : todayIso();

      const periodId = await openPeriodFor(client, entryDate);

      // Hesap planı yoksa otomatik kur (fallback TDHP kodları mevcut olsun).
      await ensureChartOfAccountsOn(client);

      const lines: Array<{ accountId: string; debit: number; credit: number }> = [];
      const unresolved = () =>
        new AppError('VALIDATION_ERROR', 'Muhasebe hesabı çözülemedi (TDHP/hesap eşleme).');
      if (invoice.type === 'sales') {
        // Satış: 120 B (ödenecek) / 600 A (matrah) + 391 A (KDV − alıcının tevkif ettiği KDV)
        const receivable = await this.resolveAccountByCode(client, '120');
        const salesAcc = await this.resolveMappedAccount(client, 'sales', 'credit', '600');
        const vatAcc = await this.resolveMappedAccount(client, 'vat_output', 'credit', '391');
        if (!receivable || !salesAcc) throw unresolved();
        const collectedVat = (toKurus(vat) - toKurus(withholding)) / 100;
        lines.push({ accountId: receivable, debit: total, credit: 0 });
        lines.push({ accountId: salesAcc, debit: 0, credit: net });
        if (collectedVat > 0 && vatAcc) lines.push({ accountId: vatAcc, debit: 0, credit: collectedVat });
      } else if (invoice.type === 'purchase') {
        // Alış: stok/gider B (matrah) + 191 B (tam KDV) / 320 A (ödenecek) + 360.01.<KDV-2> A (tevkifat)
        const payable = await this.resolveAccountByCode(client, '320');
        const stockAcc = await this.resolveMappedAccount(client, 'purchase', 'debit', '153');
        const vatAcc = await this.resolveMappedAccount(client, 'vat_input', 'debit', '191');
        if (!payable || !stockAcc) throw unresolved();
        // Faz 7-2: satır bazında stok (153) / gider (kategori hesabı, ör. 770.xx) ayrımı.
        for (const d of await this.purchaseDebitAllocation(client, id, rate, stockAcc, net)) {
          lines.push({ accountId: d.accountId, debit: d.debitK / 100, credit: 0 });
        }
        if (vat > 0 && vatAcc) lines.push({ accountId: vatAcc, debit: vat, credit: 0 });
        lines.push({ accountId: payable, debit: 0, credit: total });
        for (const w of await this.withholdingAllocation(client, id, rate, withholding)) {
          lines.push({ accountId: w.accountId, debit: 0, credit: w.creditK / 100 });
        }
      } else if (invoice.type === 'credit_note') {
        // Alınan iade (satıştan iade): 610 B (matrah) + 391 B (KDV) / 120 A
        const receivable = await this.resolveAccountByCode(client, '120');
        const returnsAcc = await this.resolveAccountByCode(client, '610');
        const vatAcc = await this.resolveMappedAccount(client, 'vat_output', 'credit', '391');
        if (!receivable || !returnsAcc) throw unresolved();
        lines.push({ accountId: returnsAcc, debit: net, credit: 0 });
        if (vat > 0 && vatAcc) lines.push({ accountId: vatAcc, debit: vat, credit: 0 });
        lines.push({ accountId: receivable, debit: 0, credit: total });
      } else {
        // Verilen iade (alıştan iade): 320 B / stok-gider A (matrah) + 191 A (KDV)
        const payable = await this.resolveAccountByCode(client, '320');
        const stockAcc = await this.resolveMappedAccount(client, 'purchase', 'debit', '153');
        const vatAcc = await this.resolveMappedAccount(client, 'vat_input', 'debit', '191');
        if (!payable || !stockAcc) throw unresolved();
        lines.push({ accountId: payable, debit: total, credit: 0 });
        for (const d of await this.purchaseDebitAllocation(client, id, rate, stockAcc, net)) {
          lines.push({ accountId: d.accountId, debit: 0, credit: d.debitK / 100 });
        }
        if (vat > 0 && vatAcc) lines.push({ accountId: vatAcc, debit: 0, credit: vat });
      }

      const totalDebit = lines.reduce((s, l) => s + toKurus(l.debit), 0) / 100;
      const totalCredit = lines.reduce((s, l) => s + toKurus(l.credit), 0) / 100;
      if (toKurus(totalDebit) !== toKurus(totalCredit)) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Fiş dengeli değil: borç ${totalDebit} != alacak ${totalCredit}`,
        );
      }

      const entryNo = await allocateEntryNo(client);
      const entryId = newId();
      const description = `Fatura ${invoice.number}`;

      await client.query(
        `INSERT INTO journal_entries
           (id, tenant_id, entry_no, entry_date, period_id, entry_type, status, description,
            source_type, source_id, total_debit, total_credit, posted_by, posted_at, created_by, updated_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, 'mahsup', 'posted', $5, 'invoice', $6, $7, $8, $9, now(), $9, $9)`,
        [entryId, entryNo, entryDate, periodId, description, id, totalDebit, totalCredit, userId],
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
