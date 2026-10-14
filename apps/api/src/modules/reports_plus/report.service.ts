import { getPool } from '@kuleplus/db';
import type { Pool } from 'pg';
import { AppError, newId } from '@kuleplus/shared';
import { z } from 'zod';

/** Tarih aralığı sorgusu — tüm canlı rapor uçları bunu kullanır. */
export const reportRangeSchema = z.object({
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const generateReportSchema = z.object({
  reportType: z.enum([
    'profit_loss',
    'balance_sheet',
    'tax_summary',
    'cash_flow',
    'aged_payable',
    'aged_receivable',
  ]),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(['pdf', 'excel', 'csv']).optional(),
});

export type GenerateReportInput = z.infer<typeof generateReportSchema>;
export type ReportRangeInput = z.infer<typeof reportRangeSchema>;

export interface ReportResult {
  id: string;
  reportType: string;
  generatedAt: Date;
  dateFrom: Date;
  dateTo: Date;
  format?: string;
  fileUrl?: string;
  status: 'generating' | 'completed' | 'failed';
}

/** Varsayılan aralık: içinde bulunulan yılın başından bugüne. */
function resolveRange(input: ReportRangeInput): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfYear = `${today.slice(0, 4)}-01-01`;
  return { from: input.dateFrom || firstOfYear, to: input.dateTo || today };
}

const toNum = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

/** Satır sonuçlarını sayısal alanlarla normalize eder (numeric → string gelir). */
function mapNumeric(
  row: Record<string, unknown> | undefined,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(row ?? {}) };
  for (const f of fields) out[f] = toNum((row ?? {})[f]);
  return out;
}

/**
 * Canlı rapor servisi.
 *
 * Tüm raporlar istek anında gerçek tablolardan hesaplanır (reports_plus SPEC §16).
 * `report_generations` yalnızca arşiv/geçmiş kaydıdır; sayılar oradan okunmaz.
 * Bu sayede modüllerde yapılan her değişiklik rapora yansır ve "modüllerde değişiklik
 * olunca raporun otomatik güncellenmesi" ikinci bir iş kuyruğuna gerek kalmadan sağlanır.
 */
class ReportService {
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

  // ==================== Canlı Özet (Panel) ====================

  /** Tüm modüllerin dönemsel KPI özeti — rapor ekranı için tek çağrı. */
  async overview(input: ReportRangeInput) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);

    const [sales, purchases, expenses, stock, cashBank, counts, freshness] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(subtotal), 0) AS net,
                COALESCE(SUM(tax_total), 0) AS tax, COALESCE(SUM(paid_amount), 0) AS paid,
                COALESCE(SUM(balance), 0) AS balance, COUNT(*) AS document_count
         FROM invoices
         WHERE tenant_id = current_tenant_id() AND type = 'sales' AND status <> 'cancelled'
           AND issue_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(subtotal), 0) AS net,
                COALESCE(SUM(tax_total), 0) AS tax, COALESCE(SUM(paid_amount), 0) AS paid,
                COALESCE(SUM(balance), 0) AS balance, COUNT(*) AS document_count
         FROM invoices
         WHERE tenant_id = current_tenant_id() AND type = 'purchase' AND status <> 'cancelled'
           AND issue_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(base_amount), 0) AS base_total,
                COUNT(*) AS document_count,
                COUNT(*) FILTER (WHERE payment_status <> 'paid') AS unpaid_count
         FROM expenses
         WHERE tenant_id = current_tenant_id() AND status <> 'cancelled'
           AND expense_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COUNT(DISTINCT p.id) AS product_count,
                COALESCE(SUM(sb.quantity), 0) AS total_quantity,
                COALESCE(SUM(sb.total_value), 0) AS total_value,
                COUNT(DISTINCT p.id) FILTER (WHERE COALESCE(sb.quantity, 0) <= 0) AS out_of_stock
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.tenant_id = p.tenant_id
         WHERE p.tenant_id = current_tenant_id() AND p.is_active = true`,
        [],
      ),
      pool.query(
        `SELECT account_type, COUNT(*) AS account_count, COALESCE(SUM(balance), 0) AS total_balance
         FROM cash_bank_accounts
         WHERE tenant_id = current_tenant_id() AND status = 'active'
         GROUP BY account_type`,
        [],
      ),
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM sales_quotes WHERE tenant_id = current_tenant_id() AND issue_date BETWEEN $1 AND $2) AS quotes,
           (SELECT COUNT(*) FROM sales_orders WHERE tenant_id = current_tenant_id() AND issue_date BETWEEN $1 AND $2) AS orders,
           (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = current_tenant_id() AND issue_date BETWEEN $1 AND $2) AS purchase_orders,
           (SELECT COUNT(*) FROM deliveries WHERE tenant_id = current_tenant_id() AND issue_date BETWEEN $1 AND $2) AS deliveries,
           (SELECT COUNT(*) FROM contacts WHERE tenant_id = current_tenant_id() AND is_active = true) AS contacts`,
        [from, to],
      ),
      this.moduleFreshness(),
    ]);

    const salesRow = mapNumeric(sales.rows[0], [
      'total',
      'net',
      'tax',
      'paid',
      'balance',
      'document_count',
    ]);
    const purchaseRow = mapNumeric(purchases.rows[0], [
      'total',
      'net',
      'tax',
      'paid',
      'balance',
      'document_count',
    ]);
    const expenseRow = mapNumeric(expenses.rows[0], [
      'total',
      'base_total',
      'document_count',
      'unpaid_count',
    ]);
    const stockRow = mapNumeric(stock.rows[0], [
      'product_count',
      'total_quantity',
      'total_value',
      'out_of_stock',
    ]);

    const cash = cashBank.rows.find((r) => r.account_type === 'cash');
    const bank = cashBank.rows.find((r) => r.account_type === 'bank');

    const revenue = toNum(salesRow.total);
    const cost = toNum(purchaseRow.total);
    const expenseTotal = toNum(expenseRow.base_total);

    return {
      range: { from, to },
      sales: salesRow,
      purchases: purchaseRow,
      expenses: expenseRow,
      stock: stockRow,
      cashBank: {
        cash: { accounts: toNum(cash?.account_count), balance: toNum(cash?.total_balance) },
        bank: { accounts: toNum(bank?.account_count), balance: toNum(bank?.total_balance) },
      },
      counts: mapNumeric(counts.rows[0], [
        'quotes',
        'orders',
        'purchase_orders',
        'deliveries',
        'contacts',
      ]),
      profit: {
        revenue,
        cost,
        grossProfit: revenue - cost,
        expenses: expenseTotal,
        netProfit: revenue - cost - expenseTotal,
      },
      /** Modül verisinin son değişim zamanları — istemci otomatik yenileme için kullanır. */
      freshness,
    };
  }

  /** Modül bazında son değişiklik zamanı (otomatik güncelleme tetikleyicisi). */
  async moduleFreshness(): Promise<Record<string, string>> {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT 'invoices' AS module, COALESCE(MAX(updated_at), now()) AS last_change
         FROM invoices WHERE tenant_id = current_tenant_id()
       UNION ALL
       SELECT 'expenses', COALESCE(MAX(updated_at), now())
         FROM expenses WHERE tenant_id = current_tenant_id()
       UNION ALL
       SELECT 'stock', COALESCE(MAX(updated_at), now())
         FROM products WHERE tenant_id = current_tenant_id()
       UNION ALL
       SELECT 'cash_bank', COALESCE(MAX(updated_at), now())
         FROM cash_bank_accounts WHERE tenant_id = current_tenant_id()
       UNION ALL
       SELECT 'quotes', COALESCE(MAX(updated_at), now())
         FROM sales_quotes WHERE tenant_id = current_tenant_id()
       UNION ALL
       SELECT 'orders', COALESCE(MAX(updated_at), now())
         FROM sales_orders WHERE tenant_id = current_tenant_id()
       UNION ALL
       SELECT 'purchase_orders', COALESCE(MAX(updated_at), now())
         FROM purchase_orders WHERE tenant_id = current_tenant_id()
       UNION ALL
       SELECT 'deliveries', COALESCE(MAX(updated_at), now())
         FROM deliveries WHERE tenant_id = current_tenant_id()
       UNION ALL
       SELECT 'contacts', COALESCE(MAX(updated_at), now())
         FROM contacts WHERE tenant_id = current_tenant_id()`,
    );
    const out: Record<string, string> = {};
    for (const row of result.rows) {
      out[row.module as string] = new Date(row.last_change as string | Date).toISOString();
    }
    return out;
  }

  // ==================== Satış Raporu ====================

  async salesReport(input: ReportRangeInput) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);
    const [summary, byContact, byMonth, topProducts] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(subtotal),0) AS net,
                COALESCE(SUM(discount_total),0) AS discount, COALESCE(SUM(tax_total),0) AS tax,
                COALESCE(SUM(paid_amount),0) AS paid, COALESCE(SUM(balance),0) AS balance,
                COUNT(*) AS document_count
         FROM invoices
         WHERE tenant_id = current_tenant_id() AND type = 'sales' AND status <> 'cancelled'
           AND issue_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(c.name, 'Cari seçilmemiş') AS name, COUNT(*) AS document_count,
                COALESCE(SUM(i.total),0) AS total
         FROM invoices i LEFT JOIN contacts c ON c.id = i.contact_id AND c.tenant_id = i.tenant_id
         WHERE i.tenant_id = current_tenant_id() AND i.type = 'sales' AND i.status <> 'cancelled'
           AND i.issue_date BETWEEN $1 AND $2
         GROUP BY c.name ORDER BY total DESC LIMIT 50`,
        [from, to],
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS period,
                COALESCE(SUM(total),0) AS total, COUNT(*) AS document_count
         FROM invoices
         WHERE tenant_id = current_tenant_id() AND type = 'sales' AND status <> 'cancelled'
           AND issue_date BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(p.name, il.description) AS name, SUM(il.quantity) AS quantity,
                COALESCE(SUM(il.line_total),0) AS total
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = current_tenant_id()
         LEFT JOIN products p ON p.id = il.product_id AND p.tenant_id = i.tenant_id
         WHERE i.type = 'sales' AND i.status <> 'cancelled' AND i.issue_date BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY total DESC LIMIT 20`,
        [from, to],
      ),
    ]);
    return {
      range: { from, to },
      summary: mapNumeric(summary.rows[0], [
        'total',
        'net',
        'discount',
        'tax',
        'paid',
        'balance',
        'document_count',
      ]),
      byContact: byContact.rows.map((r) => mapNumeric(r, ['document_count', 'total'])),
      byMonth: byMonth.rows.map((r) => mapNumeric(r, ['total', 'document_count'])),
      topProducts: topProducts.rows.map((r) => mapNumeric(r, ['quantity', 'total'])),
    };
  }

  // ==================== Satın Alma Raporu ====================

  async purchaseReport(input: ReportRangeInput) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);
    const [summary, byContact, byMonth] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(subtotal),0) AS net,
                COALESCE(SUM(tax_total),0) AS tax, COALESCE(SUM(paid_amount),0) AS paid,
                COALESCE(SUM(balance),0) AS balance, COUNT(*) AS document_count
         FROM invoices
         WHERE tenant_id = current_tenant_id() AND type = 'purchase' AND status <> 'cancelled'
           AND issue_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(c.name, 'Cari seçilmemiş') AS name, COUNT(*) AS document_count,
                COALESCE(SUM(i.total),0) AS total
         FROM invoices i LEFT JOIN contacts c ON c.id = i.contact_id AND c.tenant_id = i.tenant_id
         WHERE i.tenant_id = current_tenant_id() AND i.type = 'purchase' AND i.status <> 'cancelled'
           AND i.issue_date BETWEEN $1 AND $2
         GROUP BY c.name ORDER BY total DESC LIMIT 50`,
        [from, to],
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS period,
                COALESCE(SUM(total),0) AS total, COUNT(*) AS document_count
         FROM invoices
         WHERE tenant_id = current_tenant_id() AND type = 'purchase' AND status <> 'cancelled'
           AND issue_date BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`,
        [from, to],
      ),
    ]);
    return {
      range: { from, to },
      summary: mapNumeric(summary.rows[0], [
        'total',
        'net',
        'tax',
        'paid',
        'balance',
        'document_count',
      ]),
      byContact: byContact.rows.map((r) => mapNumeric(r, ['document_count', 'total'])),
      byMonth: byMonth.rows.map((r) => mapNumeric(r, ['total', 'document_count'])),
    };
  }

  // ==================== Gider Raporu ====================

  async expenseReport(input: ReportRangeInput) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);
    const [summary, byCategory, byGroup, byMonth] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(base_amount),0) AS total, COUNT(*) AS document_count,
                COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_count,
                COUNT(*) FILTER (WHERE payment_status = 'unpaid') AS unpaid_count,
                COUNT(*) FILTER (WHERE payment_status = 'partial') AS partial_count
         FROM expenses
         WHERE tenant_id = current_tenant_id() AND status <> 'cancelled'
           AND expense_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(c.name, 'Kategorisiz') AS name, c.grup,
                COUNT(*) AS document_count, COALESCE(SUM(e.base_amount),0) AS total
         FROM expenses e
         LEFT JOIN expense_categories c ON c.id = e.category_id AND c.tenant_id = e.tenant_id
         WHERE e.tenant_id = current_tenant_id() AND e.status <> 'cancelled'
           AND e.expense_date BETWEEN $1 AND $2
         GROUP BY c.name, c.grup ORDER BY total DESC`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(c.grup, 'grupsuz') AS grup, COUNT(*) AS document_count,
                COALESCE(SUM(e.base_amount),0) AS total
         FROM expenses e
         LEFT JOIN expense_categories c ON c.id = e.category_id AND c.tenant_id = e.tenant_id
         WHERE e.tenant_id = current_tenant_id() AND e.status <> 'cancelled'
           AND e.expense_date BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY total DESC`,
        [from, to],
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', expense_date), 'YYYY-MM') AS period,
                COALESCE(SUM(base_amount),0) AS total, COUNT(*) AS document_count
         FROM expenses
         WHERE tenant_id = current_tenant_id() AND status <> 'cancelled'
           AND expense_date BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`,
        [from, to],
      ),
    ]);
    return {
      range: { from, to },
      summary: mapNumeric(summary.rows[0], [
        'total',
        'document_count',
        'paid_count',
        'unpaid_count',
        'partial_count',
      ]),
      byCategory: byCategory.rows.map((r) => mapNumeric(r, ['document_count', 'total'])),
      byGroup: byGroup.rows.map((r) => mapNumeric(r, ['document_count', 'total'])),
      byMonth: byMonth.rows.map((r) => mapNumeric(r, ['total', 'document_count'])),
    };
  }

  // ==================== Stok Raporu ====================

  async stockReport() {
    const pool = this.getPoolInstance();
    const [summary, byWarehouse, critical, movements] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT p.id) AS product_count,
                COALESCE(SUM(sb.quantity),0) AS total_quantity,
                COALESCE(SUM(sb.total_value),0) AS total_value
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.tenant_id = p.tenant_id
         WHERE p.tenant_id = current_tenant_id() AND p.is_active = true`,
        [],
      ),
      pool.query(
        `SELECT COALESCE(w.name, 'Depo seçilmemiş') AS name,
                COUNT(DISTINCT sb.product_id) AS product_count,
                COALESCE(SUM(sb.quantity),0) AS quantity,
                COALESCE(SUM(sb.total_value),0) AS total_value
         FROM stock_balances sb
         LEFT JOIN warehouses w ON w.id = sb.warehouse_id AND w.tenant_id = sb.tenant_id
         WHERE sb.tenant_id = current_tenant_id()
         GROUP BY w.name ORDER BY total_value DESC`,
        [],
      ),
      pool.query(
        `SELECT p.code, p.name, COALESCE(SUM(sb.quantity),0) AS quantity,
                COALESCE(p.cost_price,0) AS cost_price,
                COALESCE(SUM(sb.total_value),0) AS total_value
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.tenant_id = p.tenant_id
         WHERE p.tenant_id = current_tenant_id() AND p.is_active = true
         GROUP BY p.id, p.code, p.name, p.cost_price
         HAVING COALESCE(SUM(sb.quantity),0) <= 0
         ORDER BY p.name LIMIT 100`,
        [],
      ),
      pool.query(
        `SELECT sm.type, COUNT(*) AS movement_count,
                COALESCE(SUM(sm.total_value),0) AS total_value
         FROM stock_movements sm
         WHERE sm.tenant_id = current_tenant_id()
         GROUP BY sm.type ORDER BY sm.type`,
        [],
      ),
    ]);
    return {
      summary: mapNumeric(summary.rows[0], ['product_count', 'total_quantity', 'total_value']),
      byWarehouse: byWarehouse.rows.map((r) =>
        mapNumeric(r, ['product_count', 'quantity', 'total_value']),
      ),
      critical: critical.rows.map((r) => mapNumeric(r, ['quantity', 'cost_price', 'total_value'])),
      movements: movements.rows.map((r) => mapNumeric(r, ['movement_count', 'total_value'])),
    };
  }

  // ==================== Kasa / Banka Raporu ====================

  async cashBankReport(input: ReportRangeInput) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);
    const [accounts, flows, loans, cards, pos] = await Promise.all([
      pool.query(
        `SELECT account_type, account_name, currency, COALESCE(balance,0) AS balance, status
         FROM cash_bank_accounts
         WHERE tenant_id = current_tenant_id() AND status <> 'deleted'
         ORDER BY account_type, account_name`,
        [],
      ),
      pool.query(
        `SELECT movement_type, COALESCE(SUM(amount),0) AS total, COUNT(*) AS movement_count
         FROM cash_bank_movements
         WHERE tenant_id = current_tenant_id() AND transaction_date BETWEEN $1 AND $2
         GROUP BY movement_type`,
        [from, to],
      ),
      pool.query(
        `SELECT COUNT(*) AS loan_count, COALESCE(SUM(principal),0) AS principal,
                COALESCE(SUM(remaining_balance),0) AS remaining,
                COALESCE(SUM(paid_installments),0) AS paid_installments
         FROM bank_loans WHERE tenant_id = current_tenant_id() AND status = 'active'`,
        [],
      ),
      pool.query(
        `SELECT COUNT(*) AS card_count, COALESCE(SUM(credit_limit),0) AS credit_limit,
                COALESCE(SUM(current_debt),0) AS current_debt,
                COALESCE(SUM(available_limit),0) AS available_limit
         FROM credit_cards WHERE tenant_id = current_tenant_id() AND status = 'active'`,
        [],
      ),
      pool.query(
        `SELECT COUNT(*) AS pos_count FROM pos_accounts
         WHERE tenant_id = current_tenant_id() AND status = 'active'`,
        [],
      ),
    ]);
    const cash = accounts.rows.filter((r) => r.account_type === 'cash');
    const banks = accounts.rows.filter((r) => r.account_type === 'bank');
    const sum = (rows: Record<string, unknown>[]) =>
      rows.reduce((acc, r) => acc + toNum(r.balance), 0);
    return {
      range: { from, to },
      accounts: accounts.rows.map((r) => mapNumeric(r, ['balance'])),
      totals: {
        cash: { accounts: cash.length, balance: sum(cash) },
        bank: { accounts: banks.length, balance: sum(banks) },
        grand: sum(accounts.rows),
      },
      flows: flows.rows.map((r) => mapNumeric(r, ['total', 'movement_count'])),
      loans: mapNumeric(loans.rows[0], [
        'loan_count',
        'principal',
        'remaining',
        'paid_installments',
      ]),
      cards: mapNumeric(cards.rows[0], [
        'card_count',
        'credit_limit',
        'current_debt',
        'available_limit',
      ]),
      pos: mapNumeric(pos.rows[0], ['pos_count']),
    };
  }

  // ==================== Kâr / Zarar ====================

  async profitLoss(input: ReportRangeInput) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);
    const [sales, purchases, expenses, expenseByGroup] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(subtotal),0) AS net, COALESCE(SUM(total),0) AS gross
         FROM invoices WHERE tenant_id = current_tenant_id() AND type = 'sales'
           AND status <> 'cancelled' AND issue_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(subtotal),0) AS net, COALESCE(SUM(total),0) AS gross
         FROM invoices WHERE tenant_id = current_tenant_id() AND type = 'purchase'
           AND status <> 'cancelled' AND issue_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(base_amount),0) AS total FROM expenses
         WHERE tenant_id = current_tenant_id() AND status <> 'cancelled'
           AND expense_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(c.grup, 'grupsuz') AS grup, COALESCE(SUM(e.base_amount),0) AS total
         FROM expenses e
         LEFT JOIN expense_categories c ON c.id = e.category_id AND c.tenant_id = e.tenant_id
         WHERE e.tenant_id = current_tenant_id() AND e.status <> 'cancelled'
           AND e.expense_date BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY total DESC`,
        [from, to],
      ),
    ]);

    const revenue = toNum(sales.rows[0].net);
    const cogs = toNum(purchases.rows[0].net);
    const operating = toNum(expenses.rows[0].total);
    return {
      range: { from, to },
      revenue,
      cogs,
      grossProfit: revenue - cogs,
      operatingExpenses: operating,
      netProfit: revenue - cogs - operating,
      salesGross: toNum(sales.rows[0].gross),
      purchaseGross: toNum(purchases.rows[0].gross),
      expenseByGroup: expenseByGroup.rows.map((r) => mapNumeric(r, ['total'])),
    };
  }

  // ==================== Vergi Özeti ====================

  async taxSummary(input: ReportRangeInput) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);
    const [output, inputVat, rates] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(tax_total),0) AS tax, COALESCE(SUM(subtotal),0) AS base
         FROM invoices WHERE tenant_id = current_tenant_id() AND type = 'sales'
           AND status <> 'cancelled' AND issue_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(tax_total),0) AS tax, COALESCE(SUM(subtotal),0) AS base
         FROM invoices WHERE tenant_id = current_tenant_id() AND type = 'purchase'
           AND status <> 'cancelled' AND issue_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT il.tax_rate, COALESCE(SUM(il.tax_amount),0) AS tax,
                COALESCE(SUM(il.line_total),0) AS base
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = current_tenant_id()
         WHERE i.type = 'sales' AND i.status <> 'cancelled' AND i.issue_date BETWEEN $1 AND $2
         GROUP BY il.tax_rate ORDER BY il.tax_rate`,
        [from, to],
      ),
    ]);
    const payable = toNum(output.rows[0].tax) - toNum(inputVat.rows[0].tax);
    return {
      range: { from, to },
      outputVat: toNum(output.rows[0].tax),
      outputBase: toNum(output.rows[0].base),
      inputVat: toNum(inputVat.rows[0].tax),
      inputBase: toNum(inputVat.rows[0].base),
      vatPayable: payable,
      byRate: rates.rows.map((r) => mapNumeric(r, ['tax_rate', 'tax', 'base'])),
    };
  }

  // ==================== Faz 6.4: KDV Hazırlık Raporu ====================

  /**
   * KDV hazırlık raporu (ROADMAP Faz 6.4 — SPEC §9): hesaplanan/indirilecek/devreden
   * KDV, tevkifat/stopaj kırılımı. Beyanname öncesi kontrol listesi.
   */
  async vatReport(input: ReportRangeInput) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);

    const [salesRates, purchaseRates, salesWh, purchaseWh, devreden] = await Promise.all([
      pool.query(
        `SELECT il.tax_rate, COALESCE(SUM(il.tax_amount),0) AS tax,
                COALESCE(SUM(il.line_total),0) AS base, COUNT(DISTINCT i.id) AS doc_count
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = current_tenant_id()
         WHERE i.type = 'sales' AND i.status <> 'cancelled'
           AND i.issue_date BETWEEN $1 AND $2
         GROUP BY il.tax_rate ORDER BY il.tax_rate`,
        [from, to],
      ),
      pool.query(
        `SELECT il.tax_rate, COALESCE(SUM(il.tax_amount),0) AS tax,
                COALESCE(SUM(il.line_total),0) AS base, COUNT(DISTINCT i.id) AS doc_count
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = current_tenant_id()
         WHERE i.type = 'purchase' AND i.status <> 'cancelled'
           AND i.issue_date BETWEEN $1 AND $2
         GROUP BY il.tax_rate ORDER BY il.tax_rate`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(il.tax_amount * COALESCE(il.withholding_rate,0) / 100.0),0) AS tax,
                COUNT(DISTINCT i.id) AS doc_count
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = current_tenant_id()
         WHERE i.type = 'sales' AND i.status <> 'cancelled'
           AND i.issue_date BETWEEN $1 AND $2
           AND COALESCE(il.withholding_rate,0) > 0`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(il.tax_amount * COALESCE(il.withholding_rate,0) / 100.0),0) AS tax,
                COUNT(DISTINCT i.id) AS doc_count
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = current_tenant_id()
         WHERE i.type = 'purchase' AND i.status <> 'cancelled'
           AND i.issue_date BETWEEN $1 AND $2
           AND COALESCE(il.withholding_rate,0) > 0`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(
           CASE WHEN i.type = 'sales' THEN il.tax_amount ELSE -il.tax_amount END),0) AS devreden
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id AND i.tenant_id = current_tenant_id()
         WHERE i.status <> 'cancelled' AND i.issue_date < $1`,
        [from],
      ),
    ]);

    const calculated = toNum(salesRates.rows.reduce((a, r) => a + toNum(r.tax), 0));
    const deductible = toNum(purchaseRates.rows.reduce((a, r) => a + toNum(r.tax), 0));
    const carried = toNum(devreden.rows[0]?.devreden);
    const calcWh = toNum(salesWh.rows[0]?.tax);
    const dedWh = toNum(purchaseWh.rows[0]?.tax);

    const netCalculated = calculated - calcWh;
    const netDeductible = deductible - dedWh;

    return {
      range: { from, to },
      calculatedVat: calculated,
      calculatedVatAfterWithholding: netCalculated,
      deductibleVat: deductible,
      deductibleVatAfterWithholding: netDeductible,
      carriedForwardVat: carried,
      vatPayable: calculated - deductible,
      /** Pozitif = ödenecek KDV, negatif = devredecek. */
      finalBalance: netCalculated - netDeductible + carried,
      withholding: {
        sales: { tax: calcWh, docCount: toNum(salesWh.rows[0]?.doc_count) },
        purchases: { tax: dedWh, docCount: toNum(purchaseWh.rows[0]?.doc_count) },
      },
      salesByRate: salesRates.rows.map((r) =>
        mapNumeric(r, ['tax_rate', 'tax', 'base', 'doc_count']),
      ),
      purchaseByRate: purchaseRates.rows.map((r) =>
        mapNumeric(r, ['tax_rate', 'tax', 'base', 'doc_count']),
      ),
    };
  }

  // ==================== Faz 6.4: Belge–Defter Mutabakatı ====================

  /**
   * Belge–defter mutabakatı (ROADMAP Faz 6.4): fatura/gider belge toplamları ile
   * yevmiye defteri toplamlarını karşılaştırır; farklı kayıtları listeler.
   */
  async ledgerReconciliation(input: ReportRangeInput) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);

    const [documents, ledger, journalCount] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(i.subtotal),0) AS net, COALESCE(SUM(i.tax_total),0) AS tax,
                COALESCE(SUM(i.total),0) AS total, COUNT(*) AS doc_count
         FROM invoices i
         WHERE i.tenant_id = current_tenant_id() AND i.status <> 'cancelled'
           AND i.issue_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
         WHERE jl.tenant_id = current_tenant_id() AND je.status = 'posted'
           AND je.entry_date BETWEEN $1 AND $2`,
        [from, to],
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM journal_entries
         WHERE tenant_id = current_tenant_id() AND status = 'posted'
           AND entry_date BETWEEN $1 AND $2`,
        [from, to],
      ),
    ]);

    const docRow = mapNumeric(documents.rows[0], ['net', 'tax', 'total', 'doc_count']);
    const ledgerDebit = toNum(ledger.rows[0].debit);
    const ledgerCredit = toNum(ledger.rows[0].credit);

    const differences = await pool.query(
      // Kontrol hesabı (satış→120 Alıcılar / alış→320 Satıcılar) üzerinden mutabakat.
      // Önceki sürüm tüm satırları topluyordu → dengeli fişte debit-credit=0 çıkıp
      // her fatura "işlenmemiş" görünüyordu (her zaman fark > 0). Doğrusu: belgenin
      // kontrol hesabına yazılan tutar = fatura toplamı olmalı.
      `SELECT i.number, i.type, i.issue_date, i.total,
              COALESCE(SUM(CASE WHEN i.type = 'sales' THEN jl.debit ELSE jl.credit END), 0) AS booked,
              i.total - COALESCE(SUM(CASE WHEN i.type = 'sales' THEN jl.debit ELSE jl.credit END), 0) AS unbooked
       FROM invoices i
       LEFT JOIN journal_entries je
         ON je.tenant_id = i.tenant_id AND je.source_type = 'invoice'
         AND je.source_id = i.id AND je.status = 'posted'
       LEFT JOIN journal_lines jl
         ON jl.entry_id = je.id AND jl.tenant_id = i.tenant_id
        AND jl.account_id IN (
            SELECT aa.id FROM accounting_accounts aa
             WHERE aa.tenant_id = i.tenant_id
               AND aa.code = CASE WHEN i.type = 'sales' THEN '120' ELSE '320' END)
       WHERE i.tenant_id = current_tenant_id() AND i.status <> 'cancelled'
         AND i.issue_date BETWEEN $1 AND $2
       GROUP BY i.id, i.number, i.type, i.issue_date, i.total
       HAVING ABS(i.total - COALESCE(SUM(CASE WHEN i.type = 'sales' THEN jl.debit ELSE jl.credit END), 0)) > 0.01
       ORDER BY i.issue_date DESC
       LIMIT 100`,
      [from, to],
    );

    return {
      range: { from, to },
      documents: docRow,
      ledger: {
        debit: ledgerDebit,
        credit: ledgerCredit,
        balanced: ledgerDebit === ledgerCredit,
        entryCount: toNum(journalCount.rows[0].total),
      },
      differences: differences.rows.map((r) => mapNumeric(r, ['total', 'booked', 'unbooked'])),
      differenceCount: differences.rowCount ?? 0,
    };
  }

  // ==================== Faz 6.5: Ba-Bs Raporu ====================

  /**
   * Ba-Bs raporu (ROADMAP Faz 6.5 — T-6.4: mevzuat eşiği 5000 TL, `threshold`
   * ile geçersiz kılınabilir). Banka (100) ve cari (120) hesap dökümü.
   */
  async babsReport(input: ReportRangeInput & { threshold?: number }) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);
    const threshold = input.threshold ?? 5000;

    const [banks, clients] = await Promise.all([
      pool.query(
        `SELECT p.id, p.code, p.name,
                COALESCE(SUM(jl.credit - jl.debit),0) AS movement,
                COUNT(DISTINCT je.id) AS entry_count
         FROM accounting_accounts p
         LEFT JOIN journal_lines jl ON jl.account_id = p.id AND jl.tenant_id = current_tenant_id()
         LEFT JOIN journal_entries je
           ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id AND je.status = 'posted'
           AND je.entry_date BETWEEN $1 AND $2
         WHERE p.tenant_id = current_tenant_id() AND p.code LIKE '10%'
         GROUP BY p.id, p.code, p.name
         ORDER BY p.code`,
        [from, to],
      ),
      pool.query(
        `SELECT p.id, p.code, p.name,
                COALESCE(SUM(jl.debit - jl.credit),0) AS movement,
                COUNT(DISTINCT je.id) AS entry_count
         FROM accounting_accounts p
         LEFT JOIN journal_lines jl ON jl.account_id = p.id AND jl.tenant_id = current_tenant_id()
         LEFT JOIN journal_entries je
           ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id AND je.status = 'posted'
           AND je.entry_date BETWEEN $1 AND $2
         WHERE p.tenant_id = current_tenant_id() AND p.code = '120'
         GROUP BY p.id, p.code, p.name
         ORDER BY p.code`,
        [from, to],
      ),
    ]);

    const bankRows = banks.rows.map((r) => mapNumeric(r, ['movement', 'entry_count']));
    const clientRows = clients.rows.map((r) => mapNumeric(r, ['movement', 'entry_count']));

    const bankLines = await pool.query(
      `SELECT p.code, p.name, je.entry_date, je.entry_no, jl.description,
              jl.credit - jl.debit AS amount
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
       JOIN accounting_accounts p ON p.id = jl.account_id AND p.tenant_id = jl.tenant_id
       WHERE jl.tenant_id = current_tenant_id() AND je.status = 'posted'
         AND je.entry_date BETWEEN $1 AND $2
         AND ABS(jl.credit - jl.debit) >= $3
       ORDER BY je.entry_date DESC, je.entry_no DESC
       LIMIT 500`,
      [from, to, threshold],
    );

    return {
      range: { from, to },
      threshold,
      banks: {
        closing: bankRows.reduce((a, r) => a + toNum(r.movement), 0),
        accounts: bankRows,
      },
      clients: {
        closing: clientRows.reduce((a, r) => a + toNum(r.movement), 0),
        accounts: clientRows,
      },
      lines: bankLines.rows.map((r) => mapNumeric(r, ['amount'])),
      lineCount: bankLines.rowCount ?? 0,
    };
  }

  // ==================== Faz 6.5: Cari Mutabakat Mektubu ====================

  /** Cari mutabakat mektubu verisi (ROADMAP Faz 6.5): tarihsel hareket dökümü. */
  async contactReconciliationLetter(input: ReportRangeInput & { contactId?: string }) {
    const pool = this.getPoolInstance();
    const { from, to } = resolveRange(input);

    if (!input.contactId) {
      throw new AppError('VALIDATION_ERROR', 'contactId zorunludur');
    }

    const [contact, invoices, payments, ageing] = await Promise.all([
      pool.query(
        `SELECT id, code, name, tax_no, tax_office, email, phone, address FROM contacts
         WHERE id = $3 AND tenant_id = current_tenant_id()`,
        [from, to, input.contactId],
      ),
      pool.query(
        `SELECT number, issue_date, due_date, COALESCE(total,0) AS total,
                COALESCE(paid_amount,0) AS paid, COALESCE(balance,0) AS balance, type
         FROM invoices
         WHERE tenant_id = current_tenant_id() AND contact_id = $3
           AND status <> 'cancelled' AND issue_date BETWEEN $1 AND $2
         ORDER BY issue_date ASC`,
        [from, to, input.contactId],
      ),
      pool.query(
        `SELECT ip.amount, ip.payment_date, ip.payment_method, ip.reference
         FROM invoice_payments ip
         JOIN invoices i ON i.id = ip.invoice_id AND i.tenant_id = current_tenant_id()
         WHERE i.tenant_id = current_tenant_id() AND i.contact_id = $3
           AND ip.payment_date BETWEEN $1 AND $2
         ORDER BY ip.payment_date ASC`,
        [from, to, input.contactId],
      ),
      pool.query(
        `SELECT COUNT(*) AS overdue_count, COALESCE(SUM(balance),0) AS overdue_amount
         FROM invoices
         WHERE tenant_id = current_tenant_id() AND contact_id = $3
           AND status <> 'cancelled' AND COALESCE(balance,0) > 0
           AND COALESCE(due_date, issue_date) < CURRENT_DATE`,
        [input.contactId],
      ),
    ]);

    if (contact.rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Cari bulunamadı');
    }

    const movements: Array<{
      date: string;
      type: string;
      document: string;
      debit: number;
      credit: number;
      balance: number;
    }> = [];
    let running = 0;

    for (const inv of invoices.rows) {
      const amount = toNum(inv.total);
      running += amount;
      movements.push({
        date: inv.issue_date as string,
        type: inv.type === 'purchase' ? 'Borç (Alış)' : 'Alacak (Satış)',
        document: String(inv.number),
        debit: inv.type === 'purchase' ? amount : 0,
        credit: inv.type === 'purchase' ? amount : 0,
        balance: running,
      });
    }
    for (const pay of payments.rows) {
      const amount = toNum(pay.amount);
      running -= amount;
      movements.push({
        date: pay.payment_date as string,
        type: 'Ödeme',
        document: String(pay.reference ?? '-'),
        debit: 0,
        credit: amount,
        balance: running,
      });
    }
    movements.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return {
      range: { from, to },
      contact: contact.rows[0],
      movements,
      closingBalance: running,
      overdue: mapNumeric(ageing.rows[0], ['overdue_count', 'overdue_amount']),
    };
  }

  // ==================== Faz 6.10: Vade Bazlı Nakit Akış Tahmini ====================

  /**
   * Vade bazlı nakit akış tahmini (ROADMAP Faz 6.10): tahsilat/ödeme planını
   * haftalık kovalara ayırır (kapanmamış alacak/borç + yaklaşan giderler).
   */
  async cashFlowForecast(input: ReportRangeInput & { buckets?: number }) {
    const pool = this.getPoolInstance();
    const { to } = resolveRange(input);
    const weekCount = Math.min(input.buckets ?? 8, 26);

    const [receivable, payable, expenses] = await Promise.all([
      pool.query(
        `SELECT COALESCE(i.balance,0) AS balance, COALESCE(i.due_date, i.issue_date) AS due_date,
                i.number, c.name AS contact_name
         FROM invoices i
         LEFT JOIN contacts c ON c.id = i.contact_id AND c.tenant_id = i.tenant_id
         WHERE i.tenant_id = current_tenant_id() AND i.type = 'sales'
           AND i.status <> 'cancelled' AND COALESCE(i.balance,0) > 0
         ORDER BY COALESCE(i.due_date, i.issue_date)`,
        [to],
      ),
      pool.query(
        `SELECT COALESCE(i.balance,0) AS balance, COALESCE(i.due_date, i.issue_date) AS due_date,
                i.number, c.name AS contact_name
         FROM invoices i
         LEFT JOIN contacts c ON c.id = i.contact_id AND c.tenant_id = i.tenant_id
         WHERE i.tenant_id = current_tenant_id() AND i.type = 'purchase'
           AND i.status <> 'cancelled' AND COALESCE(i.balance,0) > 0
         ORDER BY COALESCE(i.due_date, i.issue_date)`,
        [to],
      ),
      pool.query(
        `SELECT COALESCE(e.amount,0) AS balance, e.expense_date AS due_date,
                e.description AS number, co.name AS contact_name
         FROM expenses e
         LEFT JOIN contacts co ON co.id = e.contact_id AND co.tenant_id = e.tenant_id
         WHERE e.tenant_id = current_tenant_id() AND e.status <> 'cancelled'
           AND e.payment_status <> 'paid'
         ORDER BY e.expense_date`,
        [to],
      ),
    ]);

    const end = new Date(to);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const buckets: Array<{ label: string; inflow: number; outflow: number; net: number }> = [];

    for (let i = 0; i < weekCount; i++) {
      const start = new Date(end);
      start.setDate(end.getDate() + i * 7);
      const stop = new Date(start);
      stop.setDate(start.getDate() + 6);
      const inWindow = (rows: Array<Record<string, unknown>>) => {
        return rows.filter((r) => {
          const d = iso(new Date(r.due_date as string));
          return d >= iso(start) && d <= iso(stop);
        });
      };

      const inflow = inWindow(receivable.rows).reduce((a, r) => a + toNum(r.balance), 0);
      const outflow =
        inWindow(payable.rows).reduce((a, r) => a + toNum(r.balance), 0) +
        inWindow(expenses.rows).reduce((a, r) => a + toNum(r.balance), 0);

      buckets.push({
        label: `${iso(start)} → ${iso(stop)}`,
        inflow,
        outflow,
        net: inflow - outflow,
      });
    }

    return {
      range: { from: to, to },
      buckets,
      totals: {
        inflow: buckets.reduce((a, b) => a + b.inflow, 0),
        outflow: buckets.reduce((a, b) => a + b.outflow, 0),
        net: buckets.reduce((a, b) => a + b.net, 0),
      },
      detail: {
        receivable: receivable.rows.map((r) => mapNumeric(r, ['balance'])),
        payable: payable.rows.map((r) => mapNumeric(r, ['balance'])),
        expenses: expenses.rows.map((r) => mapNumeric(r, ['balance'])),
      },
    };
  }

  // ==================== Yaşlandırılmış Alacak / Borç ====================

  async agedReport(input: ReportRangeInput & { type?: 'receivable' | 'payable' }) {
    const pool = this.getPoolInstance();
    const { to } = resolveRange(input);
    const invoiceType = input.type === 'payable' ? 'purchase' : 'sales';
    const result = await pool.query(
      `SELECT i.number, i.issue_date, i.due_date, i.currency,
              COALESCE(i.total,0) AS total, COALESCE(i.paid_amount,0) AS paid,
              COALESCE(i.balance,0) AS balance,
              COALESCE(c.name, 'Cari seçilmemiş') AS contact_name,
              GREATEST(0, ($1::date - COALESCE(i.due_date, i.issue_date))) AS days_overdue
       FROM invoices i
       LEFT JOIN contacts c ON c.id = i.contact_id AND c.tenant_id = i.tenant_id
       WHERE i.tenant_id = current_tenant_id() AND i.type = $2 AND i.status <> 'cancelled'
         AND COALESCE(i.balance,0) > 0
       ORDER BY days_overdue DESC, i.issue_date`,
      [to, invoiceType],
    );
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const row of result.rows) {
      const amount = toNum(row.balance);
      const days = toNum(row.days_overdue);
      if (days <= 0) buckets.current += amount;
      else if (days <= 30) buckets.d1_30 += amount;
      else if (days <= 60) buckets.d31_60 += amount;
      else if (days <= 90) buckets.d61_90 += amount;
      else buckets.d90_plus += amount;
    }
    return {
      range: { to },
      type: input.type === 'payable' ? 'payable' : 'receivable',
      total: Object.values(buckets).reduce((a, b) => a + b, 0),
      buckets,
      items: result.rows.map((r) => mapNumeric(r, ['total', 'paid', 'balance', 'days_overdue'])),
    };
  }

  // ==================== Arşiv (report_generations) ====================

  async generateReport(input: GenerateReportInput, userId: string) {
    const pool = this.getPoolInstance();
    const reportId = newId();

    // Rapor istek anında hesaplandığı için arşiv kaydı doğrudan 'completed' yazılır.
    await pool.query(
      `INSERT INTO report_generations (id, tenant_id, report_type, date_from, date_to, format, status, generated_by, created_at, updated_at)
       VALUES ($1, current_tenant_id(), $2, $3, $4, $5, 'completed', $6, now(), now())`,
      [reportId, input.reportType, input.dateFrom, input.dateTo, input.format || null, userId],
    );

    return {
      id: reportId,
      reportType: input.reportType,
      generatedAt: new Date(),
      dateFrom: new Date(input.dateFrom),
      dateTo: new Date(input.dateTo),
      format: input.format,
      status: 'completed' as const,
    };
  }

  async listReports() {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT * FROM report_generations WHERE tenant_id = current_tenant_id()
       ORDER BY created_at DESC LIMIT 100`,
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      ...r,
      generatedAt: new Date(r.generated_at as string | Date),
      dateFrom: new Date(r.date_from as string | Date),
      dateTo: new Date(r.date_to as string | Date),
      updatedAt: new Date(r.updated_at as string | Date),
    }));
  }

  async getReportById(id: string) {
    const pool = this.getPoolInstance();
    const result = await pool.query(
      `SELECT * FROM report_generations WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      generatedAt: new Date(row.generated_at),
      dateFrom: new Date(row.date_from),
      dateTo: new Date(row.date_to),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const reportService = new ReportService();

export async function generateReport(input: GenerateReportInput, userId: string) {
  return reportService.generateReport(input, userId);
}
export async function listReports() {
  return reportService.listReports();
}
export async function getReportById(id: string) {
  return reportService.getReportById(id);
}
