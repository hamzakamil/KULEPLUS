import { getPool } from '@kuleplus/db';
import type { Pool } from 'pg';
import { SiteService } from './sites.service';
import { WeatherService, type SiteWeather } from './weather.service';
import { buildDashboardSummary, type DashboardIndicator, type RowQuery } from '@kuleplus/shared';

/**
 * Yönetici Kokpiti — tek istekte toplanan canlı yüklemesi (ROADMAP Faz 3).
 *
 * Kokpit bir iframe içinde çalışan bağımsız bir belge olduğu için tüm bölümler
 * TEK bir uçtan beslenir: iframe 14 ayrı istek atmak yerine parent
 * (`ManagementCockpitView`) bu yüklemeyi yetkili SPA istemcisiyle çeker ve
 * `window.__KOKPIT__` olarak belgeye enjekte eder — token iframe'e hiç girmez.
 *
 * Alan kararları:
 *  - Tutarlar TL karşılığıdır (hareketlerde `base_amount` esas alınır).
 *  - "Kritik stok" tanımı kural motoruyla birebir aynıdır (bakiye <= 0).
 *  - Uyarılar `buildDashboardSummary` çıktısıdır — Patron Paneli ile tek kaynak.
 *  - Altyapısı olmayan bölümler `sections.demo` ile bildirilir; arayüz başlığına
 *    "Örnek veri" etiketi koyar.
 */

/** Tek nakit hareketi — hesap kartı, banka kartı ve finans sekmelerinde ortak. */
export interface CockpitTx {
  /** ISO tarih (YYYY-MM-DD). */
  date: string;
  description: string;
  /** TL karşılığı; çıkışlar negatif. */
  amount: number;
  currency: string;
  tag: string | null;
}

export interface CockpitAccount {
  id: string;
  name: string;
  /** Yonga filtresi anahtarı (kasa / banka adı slug'ı). */
  group: string;
  groupLabel: string;
  type: 'cash' | 'bank';
  currency: string;
  balance: number;
  openingBalance: number;
  /** Bakiye açılış bakiyesinin altına düştüyse true. */
  low: boolean;
  transactions: CockpitTx[];
}

export interface CockpitContact {
  id: string;
  name: string;
  role: 'customer' | 'supplier' | 'other';
  /** Pozitif = alacak, negatif = borç. */
  balance: number;
  overdueDays: number;
  overdueInvoices: number;
  lastActivity: string | null;
  tag: string;
  tone: 'good' | 'warn' | 'bad';
  /** Açık bakiyeli faturalar — cari detay penceresinde listelenir. */
  invoices: Array<{ number: string; dueDate: string | null; amount: number }>;
}

export interface CockpitDue {
  title: string;
  dueDate: string;
  daysLeft: number;
  /** Pozitif = tahsilat, negatif = ödeme. */
  amount: number;
  source: 'invoice' | 'expense' | 'cheque';
  overdue: boolean;
}

export interface CockpitCheque {
  id: string;
  no: string;
  kind: 'cheque' | 'promissory';
  direction: 'incoming' | 'outgoing';
  party: string;
  bank: string;
  dueDate: string | null;
  daysLeft: number | null;
  amount: number;
  currency: string;
  status: string;
}

export interface CockpitStockItem {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  unit: string;
  value: number;
  critical: boolean;
}

export interface CockpitStockMove {
  date: string;
  name: string;
  where: string;
  quantity: number;
  unit: string;
}

export interface CockpitApproval {
  id: string;
  requestType: string;
  title: string;
  summary: string | null;
  amount: number;
  requestedBy: string | null;
  createdAt: string;
  dueAt: string | null;
}

export interface CockpitAlert {
  key: string;
  title: string;
  detail: string;
  tone: 'good' | 'warn' | 'bad';
  link: string;
  amount: number | null;
}

export interface CockpitWeek {
  label: string;
  inflow: number;
  outflow: number;
}

export interface CockpitSite {
  id: string;
  name: string;
  province: string;
  district: string | null;
  status: string;
  statusLabel: string;
}

export interface CockpitPayload {
  generatedAt: string;
  currency: string;
  /** Hangi bölümler canlı, hangileri hâlâ örnek veri. */
  sections: { live: string[]; demo: string[] };
  kpis: {
    cash: { total: number; cash: number; bank: number; accounts: number };
    month: { revenue: number; expense: number; net: number };
    overdue: { amount: number; count: number; maxDays: number };
    approvals: { count: number; amount: number };
  };
  accounts: CockpitAccount[];
  contacts: CockpitContact[];
  cashflow: { basis: 'actual' | 'forecast' | 'none'; label: string; weeks: CockpitWeek[] };
  dues: CockpitDue[];
  cheques: CockpitCheque[];
  stock: {
    items: CockpitStockItem[];
    critical: CockpitStockItem[];
    movements: CockpitStockMove[];
    totalValue: number;
    productCount: number;
  };
  approvals: CockpitApproval[];
  /** Kullanıcı `management.approval.decide` yetkisine sahipse onay düğmeleri çalışır. */
  approvalsEditable: boolean;
  alerts: CockpitAlert[];
  finance: { cash: CockpitTx[]; current: CockpitTx[]; cheque: CockpitTx[]; expense: CockpitTx[] };
  banks: Array<{ id: string; name: string; transactions: CockpitTx[] }>;
  suppliers: Array<{ name: string; amount: number; share: number; nextDue: string | null }>;
  fx: Array<{ code: string; rate: number; date: string }>;
  /** Şantiyeler (saha kayıtları) — `sites` tablosu. */
  sites: CockpitSite[];
  /** Şantiye başına MGM tahmini (il/ilçe → istasyon). */
  weather: SiteWeather[];
}

const num = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

const isoDate = (value: unknown): string | null => {
  if (!value) return null;
  const raw = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(raw.getTime())) return null;
  return raw.toISOString().slice(0, 10);
};

const isoDay = (date: Date): string => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const dayDiff = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / 86_400_000);

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Pazartesi başlayan haftanın kısa etiketi ("12 Eki"). */
function weekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(date.getTime())) return weekStart;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

/** Hesap adından yonga anahtarı üretir: "Ziraat Bankası Vadesiz" → "ziraat-bankasi". */
function slugify(value: string): string {
  const map: Record<string, string> = {
    ç: 'c',
    Ç: 'c',
    ğ: 'g',
    Ğ: 'g',
    ı: 'i',
    İ: 'i',
    ö: 'o',
    Ö: 'o',
    ş: 's',
    Ş: 's',
    ü: 'u',
    Ü: 'u',
  };
  return value
    .split('')
    .map((char) => map[char] ?? char)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

const CHEQUE_STATUS_LABELS: Record<string, string> = {
  portfolio: 'Portföyde',
  endorsed: 'Cirolu',
  bounced: 'Karşılıksız',
  collected: 'Tahsil edildi',
  cancelled: 'İptal',
};

const APPROVAL_TYPE_LABELS: Record<string, string> = {
  expense: 'Gider onayı',
  invoice: 'Fatura onayı',
  payment: 'Ödeme onayı',
  discount: 'İskonto onayı',
  stock: 'Stok işlemi onayı',
  generic: 'Onay talebi',
};

const TONE_BY_STATUS: Record<string, CockpitAlert['tone']> = {
  green: 'good',
  amber: 'warn',
  red: 'bad',
};

function toTx(row: Record<string, unknown>): CockpitTx {
  return {
    date: String(row.date ?? ''),
    description: String(row.description ?? 'Hareket'),
    amount: num(row.amount),
    currency: String(row.currency ?? 'TRY'),
    tag: row.tag ? String(row.tag) : null,
  };
}

/**
 * Kapanmamış belge vadelerinden 8 haftalık öngörü üretir. Gerçek kasa/banka
 * hareketi olmayan tenant'larda grafik boş kalmasın diye kullanılır; grafik
 * etiketi "vade öngörüsü" der, kullanıcı yanıldığı düşünmez.
 */
function buildForecastWeeks(
  today: Date,
  items: Array<{ dueDate: string | null; amount: number; direction: 1 | -1 }>,
): CockpitWeek[] {
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weeks: CockpitWeek[] = [];
  for (let index = 0; index < 8; index++) {
    const start = addDays(weekStart, index * 7);
    const from = isoDay(start);
    const to = isoDay(addDays(start, 6));
    let inflow = 0;
    let outflow = 0;
    for (const item of items) {
      if (!item.dueDate || item.dueDate < from || item.dueDate > to) continue;
      if (item.direction > 0) inflow += item.amount;
      else outflow += item.amount;
    }
    weeks.push({ label: weekLabel(from), inflow, outflow });
  }
  return weeks.filter((week) => week.inflow !== 0 || week.outflow !== 0);
}

export class ManagementCockpitService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;
  private readonly providedSiteService: SiteService | null;
  private readonly providedWeatherService: WeatherService | null;

  constructor(options?: {
    pool?: Pool;
    /** Test/DI: şantiye ve hava durumu servisleri dışarıdan verilebilir. */
    siteService?: SiteService;
    weatherService?: WeatherService;
  }) {
    this.providedPool = options?.pool ?? null;
    this.providedSiteService = options?.siteService ?? null;
    this.providedWeatherService = options?.weatherService ?? null;
  }

  private getSiteService(): SiteService {
    return this.providedSiteService ?? new SiteService({ pool: this.getPoolInstance() });
  }

  private getWeatherService(): WeatherService {
    return this.providedWeatherService ?? new WeatherService();
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  /**
   * Kokpit yüklemesi. `tenantId` istek bağlamından gelir (RLS GUC'su
   * `tenantContext` ara yazılımıyla kurulmuştur); sorgular `current_tenant_id()`
   * ile filtrelenir — reports_plus deseni.
   */
  async payload(options: {
    tenantId: string;
    canDecideApprovals?: boolean;
  }): Promise<CockpitPayload> {
    void options.tenantId;
    const pool = this.getPoolInstance();
    const query: RowQuery = (text, params) => pool.query(text, params as never[]);
    const today = new Date();
    const todayIso = isoDay(today);
    const horizonIso = isoDay(addDays(today, 7));
    const monthStart = `${todayIso.slice(0, 7)}-01`;
    const nextDay = isoDay(addDays(today, 1));

    const [
      accountRows,
      accountTxRows,
      movementRows,
      weeklyRows,
      openInvoiceRows,
      openExpenseRows,
      contactRows,
      invoiceRows,
      expenseRows,
      chequeRows,
      stockRows,
      stockTotalRow,
      stockMoveRows,
      approvalRows,
      monthRow,
      overdueRow,
      fxRows,
      summary,
    ] = await Promise.all([
      // 1) Kasa + banka hesapları
      pool.query(
        `SELECT id::text AS id, account_type, account_name, currency::text AS currency,
                COALESCE(balance, 0)::float8 AS balance,
                COALESCE(opening_balance, 0)::float8 AS opening_balance
           FROM cash_bank_accounts
          WHERE tenant_id = current_tenant_id() AND status = 'active'
          ORDER BY account_type, account_name`,
      ),
      // 2) Hesap başına son 6 hareket (hesap detay penceresi)
      pool.query(
        `SELECT account_id, date, description, amount, currency, tag FROM (
           SELECT m.account_id::text AS account_id,
                  m.transaction_date::text AS date,
                  COALESCE(NULLIF(m.description, ''), NULLIF(m.reference, ''),
                           CASE m.movement_type WHEN 'transfer' THEN 'Havale/EFT'
                             WHEN 'withdrawal' THEN 'Nakit çıkışı' ELSE 'Nakit girişi' END) AS description,
                  (CASE WHEN m.movement_type IN ('withdrawal', 'transfer') THEN -1 ELSE 1 END)
                    * COALESCE(NULLIF(m.base_amount, 0), m.amount)::float8 AS amount,
                  m.currency::text AS currency,
                  NULLIF(m.related_document_type, '') AS tag,
                  ROW_NUMBER() OVER (
                    PARTITION BY m.account_id
                    ORDER BY m.transaction_date DESC, m.created_at DESC
                  ) AS rn
             FROM cash_bank_movements m
            WHERE m.tenant_id = current_tenant_id()
         ) t WHERE rn <= 6 ORDER BY account_id, rn`,
      ),
      // 3) Son kasa/banka hareketleri — "Finansal hareketler / Kasa-banka"
      pool.query(
        `SELECT m.transaction_date::text AS date,
                COALESCE(NULLIF(m.description, ''), NULLIF(m.reference, ''),
                         a.account_name) AS description,
                (CASE WHEN m.movement_type = 'withdrawal' THEN -1 ELSE 1 END)
                  * COALESCE(NULLIF(m.base_amount, 0), m.amount)::float8 AS amount,
                m.currency::text AS currency,
                CASE m.movement_type WHEN 'transfer' THEN 'Havale/EFT'
                     WHEN 'withdrawal' THEN 'Çıkış' ELSE 'Giriş' END AS tag
           FROM cash_bank_movements m
           LEFT JOIN cash_bank_accounts a ON a.id = m.account_id
          WHERE m.tenant_id = current_tenant_id() AND m.movement_type <> 'transfer'
          ORDER BY m.transaction_date DESC, m.created_at DESC
          LIMIT 10`,
      ),
      // 4) Son 8 haftanın GERÇEK giriş/çıkışı (transfer dahili, sayılmaz)
      pool.query(
        `SELECT (date_trunc('week', m.transaction_date)::date)::text AS week_start,
                COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'deposit'), 0)::float8 AS inflow,
                COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'withdrawal'), 0)::float8 AS outflow
           FROM cash_bank_movements m
          WHERE m.tenant_id = current_tenant_id()
            AND m.movement_type IN ('deposit', 'withdrawal')
            AND m.transaction_date >= (date_trunc('week', CURRENT_DATE) - INTERVAL '7 weeks')
          GROUP BY 1
          ORDER BY 1`,
      ),
      // 5) Kapanmamış faturalar — öngörü + 7 gün vade + cari
      pool.query(
        `SELECT i.id::text AS id, i.number, i.type, i.contact_id::text AS contact_id,
                COALESCE(i.balance, 0)::float8 AS balance,
                (COALESCE(i.due_date, i.issue_date))::text AS due_date,
                COALESCE(c.name, 'Cari seçilmemiş') AS contact_name
           FROM invoices i
           LEFT JOIN contacts c ON c.id = i.contact_id AND c.tenant_id = i.tenant_id
          WHERE i.tenant_id = current_tenant_id() AND i.status <> 'cancelled'
            AND COALESCE(i.balance, 0) > 0`,
      ),
      // 6) Ödenmemiş giderler — öngörü + 7 gün vade
      pool.query(
        `SELECT e.id::text AS id, e.description,
                COALESCE(NULLIF(e.base_amount, 0), e.amount, 0)::float8 AS amount,
                (COALESCE(e.expense_date, e.invoice_date))::text AS due_date,
                co.name AS contact_name
           FROM expenses e
           LEFT JOIN contacts co ON co.id = e.contact_id AND co.tenant_id = e.tenant_id
          WHERE e.tenant_id = current_tenant_id() AND e.status <> 'cancelled'
            AND e.payment_status <> 'paid'`,
      ),
      // 7) Cari kartlar — alacak / borç / gecikme tek sorguda
      pool.query(
        `SELECT c.id::text AS id, c.name, c.type,
                COALESCE(SUM(i.balance) FILTER (WHERE i.type = 'sales'), 0)::float8 AS receivable,
                COALESCE(SUM(i.balance) FILTER (WHERE i.type = 'purchase'), 0)::float8 AS payable,
                COUNT(*) FILTER (
                  WHERE i.type = 'sales' AND COALESCE(i.balance, 0) > 0
                    AND COALESCE(i.due_date, i.issue_date) < CURRENT_DATE)::int AS overdue_invoices,
                COALESCE(MAX(CURRENT_DATE - COALESCE(i.due_date, i.issue_date))
                  FILTER (WHERE i.type = 'sales' AND COALESCE(i.balance, 0) > 0), 0)::int AS overdue_days,
                MAX(i.issue_date)::text AS last_activity
           FROM contacts c
           JOIN invoices i ON i.contact_id = c.id AND i.tenant_id = c.tenant_id
            AND i.status <> 'cancelled'
          WHERE c.tenant_id = current_tenant_id() AND c.is_active = true
          GROUP BY c.id, c.name, c.type
          ORDER BY GREATEST(
              COALESCE(SUM(i.balance) FILTER (WHERE i.type = 'sales'), 0),
              COALESCE(SUM(i.balance) FILTER (WHERE i.type = 'purchase'), 0)) DESC
          LIMIT 12`,
      ),
      // 8) Son faturalar — "Finansal hareketler / Cari hesap"
      pool.query(
        `SELECT i.issue_date::text AS date, i.number, i.type,
                COALESCE(i.total, 0)::float8 AS amount, i.currency::text AS currency,
                COALESCE(c.name, 'Cari seçilmemiş') AS contact_name
           FROM invoices i
           LEFT JOIN contacts c ON c.id = i.contact_id AND c.tenant_id = i.tenant_id
          WHERE i.tenant_id = current_tenant_id() AND i.status <> 'cancelled'
          ORDER BY i.issue_date DESC, i.created_at DESC
          LIMIT 10`,
      ),
      // 9) Son giderler — "Finansal hareketler / Giderler"
      pool.query(
        `SELECT COALESCE(e.expense_date, e.invoice_date)::text AS date,
                COALESCE(NULLIF(e.description, ''), 'Gider') AS description,
                COALESCE(NULLIF(e.base_amount, 0), e.amount, 0)::float8 AS amount,
                e.currency::text AS currency, cat.name AS tag
           FROM expenses e
           LEFT JOIN expense_categories cat ON cat.id = e.category_id
          WHERE e.tenant_id = current_tenant_id() AND e.status <> 'cancelled'
          ORDER BY COALESCE(e.expense_date, e.invoice_date) DESC
          LIMIT 10`,
      ),
      // 10) Çek / senet portföyü (iptal ve tahsil edilmişler dışarıda)
      pool.query(
        `SELECT q.id::text AS id,
                COALESCE(NULLIF(q.cheque_no, ''), NULLIF(q.serial_no, ''), '—') AS no,
                q.cheque_type, q.direction, q.status, q.currency::text AS currency,
                COALESCE(q.amount, 0)::float8 AS amount,
                q.due_date::text AS due_date,
                COALESCE(NULLIF(q.drawer_name, ''), NULLIF(q.endorser_name, ''),
                         co.name, q.bank_name, '—') AS party,
                COALESCE(q.bank_name, '—') AS bank
           FROM cheques q
           LEFT JOIN contacts co ON co.id = q.contact_id AND co.tenant_id = q.tenant_id
          WHERE q.tenant_id = current_tenant_id()
            AND q.status IN ('portfolio', 'endorsed', 'bounced')
          ORDER BY q.due_date NULLS LAST, q.created_at DESC
          LIMIT 40`,
      ),
      // 11) Stok kartları — bakiye <= 0 olan kritik (kural motoruyla aynı tanım)
      pool.query(
        `SELECT p.id::text AS product_id, p.code, p.name,
                COALESCE(SUM(sb.quantity), 0)::float8 AS quantity,
                COALESCE(SUM(sb.total_value), 0)::float8 AS value,
                COALESCE(u.abbreviation, u.name, 'adet') AS unit,
                (p.track_inventory AND COALESCE(SUM(sb.quantity), 0) <= 0)::bool AS critical
           FROM products p
           LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.tenant_id = p.tenant_id
           LEFT JOIN units u ON u.id = p.unit_id
          WHERE p.tenant_id = current_tenant_id() AND p.is_active = true
          GROUP BY p.id, p.code, p.name, u.abbreviation, u.name, p.track_inventory
          ORDER BY COALESCE(SUM(sb.total_value), 0) DESC, p.name
          LIMIT 12`,
      ),
      // 12) Stok toplam değeri
      pool.query(
        `SELECT COUNT(*)::int AS product_count,
                COALESCE(SUM(sb.total_value), 0)::float8 AS total_value
           FROM products p
           LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.tenant_id = p.tenant_id
          WHERE p.tenant_id = current_tenant_id() AND p.is_active = true`,
      ),
      // 13) Son stok hareketleri
      pool.query(
        `SELECT m.created_at::text AS date, COALESCE(p.name, 'Ürün') AS name,
                COALESCE(w.name, 'Depo') AS warehouse,
                m.quantity::float8 AS quantity,
                COALESCE(u.abbreviation, u.name, 'adet') AS unit, m.type
           FROM stock_movements m
           LEFT JOIN products p ON p.id = m.product_id
           LEFT JOIN warehouses w ON w.id = m.warehouse_id
           LEFT JOIN units u ON u.id = p.unit_id
          WHERE m.tenant_id = current_tenant_id()
          ORDER BY m.created_at DESC
          LIMIT 5`,
      ),
      // 14) Bekleyen onaylar — "Karar bekleyenler"
      pool.query(
        `SELECT a.id::text AS id, a.request_type, a.title, a.summary,
                COALESCE(a.amount, 0)::float8 AS amount,
                a.created_at::text AS created_at, a.due_at::text AS due_at,
                req.email AS requested_by
           FROM approval_requests a
           LEFT JOIN users req ON req.id = a.requested_by
          WHERE a.tenant_id = current_tenant_id() AND a.status = 'pending'
          ORDER BY COALESCE(a.due_at, a.created_at)
          LIMIT 8`,
      ),
      // 15) Bu ayın geliri / gideri (KPI şeridi)
      pool.query(
        `SELECT
           (SELECT COALESCE(SUM(total), 0) FROM invoices
             WHERE tenant_id = current_tenant_id() AND type = 'sales'
               AND status <> 'cancelled' AND issue_date >= $1 AND issue_date < $2)::float8 AS revenue,
           (SELECT COALESCE(SUM(total), 0) FROM invoices
             WHERE tenant_id = current_tenant_id() AND type = 'purchase'
               AND status <> 'cancelled' AND issue_date >= $1 AND issue_date < $2)::float8 AS purchase,
           (SELECT COALESCE(SUM(COALESCE(NULLIF(base_amount, 0), amount, 0)), 0) FROM expenses
             WHERE tenant_id = current_tenant_id() AND status <> 'cancelled'
               AND COALESCE(expense_date, invoice_date) >= $1
               AND COALESCE(expense_date, invoice_date) < $2)::float8 AS expense`,
        [monthStart, nextDay],
      ),
      // 16) Vadesi geçen alacak özeti (KPI şeridi)
      pool.query(
        `SELECT COUNT(*)::int AS cnt,
                COALESCE(SUM(balance), 0)::float8 AS amount,
                COALESCE(MAX(CURRENT_DATE - COALESCE(due_date, issue_date)), 0)::int AS max_days
           FROM invoices
          WHERE tenant_id = current_tenant_id() AND type = 'sales' AND status <> 'cancelled'
            AND COALESCE(balance, 0) > 0
            AND COALESCE(due_date, issue_date) < CURRENT_DATE`,
      ),
      // 17) Döviz kurları (başlık şeridi) — tenant'ın son çektiği kur
      pool.query(
        `SELECT DISTINCT ON (target_currency) target_currency AS code,
                rate::float8 AS rate, rate_date::text AS date
           FROM exchange_rates
          WHERE tenant_id = current_tenant_id() AND base_currency = 'TRY'
            AND target_currency IN ('USD', 'EUR', 'GBP')
          ORDER BY target_currency, rate_date DESC`,
      ),
      // 18) Kural motoru uyarıları — Patron Paneli ile tek kaynak
      buildDashboardSummary(query),
    ]);

    // --- Hesap bakiyeleri + hesap detayındaki hareketler ---
    const accounts: CockpitAccount[] = accountRows.rows.map((row) => {
      const type: CockpitAccount['type'] = row.account_type === 'bank' ? 'bank' : 'cash';
      const name = String(row.account_name);
      return {
        id: String(row.id),
        name,
        group: type === 'cash' ? 'kasa' : slugify(name) || 'banka',
        groupLabel: type === 'cash' ? 'Kasa' : name,
        type,
        currency: String(row.currency ?? 'TRY'),
        balance: num(row.balance),
        openingBalance: num(row.opening_balance),
        low: num(row.balance) < num(row.opening_balance),
        transactions: [],
      };
    });
    const txByAccount = new Map<string, CockpitTx[]>();
    for (const row of accountTxRows.rows) {
      const key = String(row.account_id);
      txByAccount.set(key, [...(txByAccount.get(key) ?? []), toTx(row)]);
    }
    for (const account of accounts) {
      account.transactions = txByAccount.get(account.id) ?? [];
    }

    // --- Nakit akışı: gerçekleşen varsa o, yoksa vade öngörüsü ---
    const actualWeeks: CockpitWeek[] = weeklyRows.rows.map((row) => ({
      label: weekLabel(String(row.week_start)),
      inflow: num(row.inflow),
      outflow: num(row.outflow),
    }));
    const forecastWeeks = buildForecastWeeks(today, [
      ...openInvoiceRows.rows.map((row) => ({
        dueDate: isoDate(row.due_date),
        amount: num(row.balance),
        direction: (row.type === 'sales' ? 1 : -1) as 1 | -1,
      })),
      ...openExpenseRows.rows.map((row) => ({
        dueDate: isoDate(row.due_date),
        amount: num(row.amount),
        direction: -1 as const,
      })),
    ]);
    const basis: CockpitPayload['cashflow']['basis'] =
      actualWeeks.length > 0 ? 'actual' : forecastWeeks.length > 0 ? 'forecast' : 'none';
    const cashflowLabel =
      basis === 'actual'
        ? 'Son 8 hafta · gerçekleşen'
        : basis === 'forecast'
          ? 'Önümüzdeki 8 hafta · vade öngörüsü'
          : 'Hareket kaydı yok';

    // --- Önümüzdeki 7 gün (ve gecikmiş vadeler) ---
    const dues: CockpitDue[] = [];
    const pushDue = (
      title: string,
      dueDate: string | null,
      amount: number,
      source: CockpitDue['source'],
    ) => {
      if (!dueDate || dueDate > horizonIso) return;
      dues.push({
        title,
        dueDate,
        daysLeft: dayDiff(today, new Date(`${dueDate}T00:00:00`)),
        amount,
        source,
        overdue: dueDate < todayIso,
      });
    };
    for (const row of openInvoiceRows.rows) {
      const incoming = row.type === 'sales';
      pushDue(
        `${row.contact_name} · ${row.number}`,
        isoDate(row.due_date),
        (incoming ? 1 : -1) * num(row.balance),
        'invoice',
      );
    }
    for (const row of openExpenseRows.rows) {
      pushDue(
        `${row.contact_name ?? 'Gider'} · ${row.description ?? 'Gider'}`,
        isoDate(row.due_date),
        -num(row.amount),
        'expense',
      );
    }
    for (const row of chequeRows.rows) {
      pushDue(
        `${row.party} · ${row.cheque_type === 'promissory' ? 'Senet' : 'Çek'} ${row.no}`,
        isoDate(row.due_date),
        (row.direction === 'incoming' ? 1 : -1) * num(row.amount),
        'cheque',
      );
    }
    dues.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // --- Cari kartlar ---
    const invoicesByContact = new Map<string, CockpitContact['invoices']>();
    for (const row of openInvoiceRows.rows) {
      if (!row.contact_id) continue;
      const key = String(row.contact_id);
      const list = invoicesByContact.get(key) ?? [];
      if (list.length < 6) {
        list.push({
          number: String(row.number),
          dueDate: isoDate(row.due_date),
          amount: (row.type === 'sales' ? 1 : -1) * num(row.balance),
        });
      }
      invoicesByContact.set(key, list);
    }
    const contacts: CockpitContact[] = contactRows.rows.map((row) => {
      const receivable = num(row.receivable);
      const payable = num(row.payable);
      const overdueDays = num(row.overdue_days);
      const overdueInvoices = num(row.overdue_invoices);
      const tone: CockpitContact['tone'] =
        overdueInvoices > 0 ? (overdueDays > 30 ? 'bad' : 'warn') : 'good';
      const tag =
        overdueInvoices > 0
          ? `${overdueDays} gün vadesi geçti · ${overdueInvoices} fatura`
          : receivable > 0
            ? 'Açık alacak var'
            : payable > 0
              ? 'Borç bakiyesi'
              : 'Güncel';
      return {
        id: String(row.id),
        name: String(row.name),
        role: row.type === 'supplier' ? 'supplier' : row.type === 'customer' ? 'customer' : 'other',
        balance: receivable - payable,
        overdueDays,
        overdueInvoices,
        lastActivity: isoDate(row.last_activity),
        tag,
        tone,
        invoices: invoicesByContact.get(String(row.id)) ?? [],
      };
    });

    // --- Çek / senet portföyü ---
    const cheques: CockpitCheque[] = chequeRows.rows.map((row) => {
      const due = isoDate(row.due_date);
      return {
        id: String(row.id),
        no: String(row.no),
        kind: row.cheque_type === 'promissory' ? 'promissory' : 'cheque',
        direction: row.direction === 'outgoing' ? 'outgoing' : 'incoming',
        party: String(row.party),
        bank: String(row.bank),
        dueDate: due,
        daysLeft: due ? dayDiff(today, new Date(`${due}T00:00:00`)) : null,
        amount: num(row.amount),
        currency: String(row.currency ?? 'TRY'),
        status: CHEQUE_STATUS_LABELS[String(row.status)] ?? String(row.status),
      };
    });

    // --- Stok ---
    const stockItems: CockpitStockItem[] = stockRows.rows.map((row) => ({
      productId: String(row.product_id),
      code: String(row.code ?? '—'),
      name: String(row.name),
      quantity: num(row.quantity),
      unit: String(row.unit ?? 'adet'),
      value: num(row.value),
      critical: Boolean(row.critical),
    }));
    const stockMoves: CockpitStockMove[] = stockMoveRows.rows.map((row) => ({
      date: String(row.date ?? ''),
      name: String(row.name),
      where: String(row.warehouse),
      quantity: num(row.quantity),
      unit: String(row.unit ?? 'adet'),
    }));

    // --- Onay kuyruğu ---
    const approvals: CockpitApproval[] = approvalRows.rows.map((row) => ({
      id: String(row.id),
      requestType: String(row.request_type),
      title: APPROVAL_TYPE_LABELS[String(row.request_type)] ?? String(row.title),
      summary: row.summary ? String(row.summary) : null,
      amount: num(row.amount),
      requestedBy: row.requested_by ? String(row.requested_by) : null,
      createdAt: String(row.created_at ?? ''),
      dueAt: row.due_at ? String(row.due_at) : null,
    }));

    // --- Uyarılar (kural motoru; yeşiller liste dışı) ---
    const alerts: CockpitAlert[] = summary.indicators
      .filter((indicator: DashboardIndicator) => indicator.status !== 'green')
      .map((indicator: DashboardIndicator) => ({
        key: indicator.key,
        title: indicator.label,
        detail: indicator.hint,
        tone: TONE_BY_STATUS[indicator.status] ?? 'warn',
        link: indicator.link,
        amount: indicator.amount ?? null,
      }));

    // --- Finans sekmeleri ---
    const finance: CockpitPayload['finance'] = {
      cash: movementRows.rows.map((row) => toTx(row)),
      current: invoiceRows.rows.map((row) => ({
        date: String(row.date ?? ''),
        description: `${row.contact_name} · ${row.number}`,
        amount: (row.type === 'sales' ? 1 : -1) * num(row.amount),
        currency: String(row.currency ?? 'TRY'),
        tag: row.type === 'sales' ? 'Alacak' : 'Borç',
      })),
      cheque: cheques.slice(0, 10).map((cheque) => ({
        date: cheque.dueDate ?? '',
        description: `${cheque.party} · ${cheque.kind === 'promissory' ? 'Senet' : 'Çek'} ${cheque.no}`,
        amount: (cheque.direction === 'incoming' ? 1 : -1) * cheque.amount,
        currency: cheque.currency,
        tag: cheque.status,
      })),
      expense: expenseRows.rows.map((row) => ({
        date: String(row.date ?? ''),
        description: String(row.description ?? 'Gider'),
        amount: -num(row.amount),
        currency: String(row.currency ?? 'TRY'),
        tag: row.tag ? String(row.tag) : null,
      })),
    };

    // --- Banka kartları: bakiyesi en yüksek 3 banka hesabı ---
    const banks = accounts
      .filter((account) => account.type === 'bank')
      .slice(0, 3)
      .map((account) => ({
        id: account.id,
        name: account.name,
        transactions: account.transactions,
      }));

    // --- Tedarikçi ödemeleri: borç payı ---
    const payableTotal = contacts.reduce((total, contact) => total + Math.max(0, -contact.balance), 0);
    const suppliers = contacts
      .filter((contact) => contact.balance < 0)
      .map((contact) => ({
        name: contact.name,
        amount: -contact.balance,
        share: payableTotal > 0 ? Math.round((-contact.balance / payableTotal) * 100) : 0,
        nextDue: contact.lastActivity,
      }))
      .slice(0, 6);

    const cashBalance = accounts
      .filter((account) => account.type === 'cash')
      .reduce((total, account) => total + account.balance, 0);
    const bankBalance = accounts
      .filter((account) => account.type === 'bank')
      .reduce((total, account) => total + account.balance, 0);
    const monthRevenue = num(monthRow.rows[0]?.revenue);
    const monthExpense = num(monthRow.rows[0]?.purchase) + num(monthRow.rows[0]?.expense);

    // --- Şantiyeler + MGM hava durumu (şantiyenin il/ilçesine göre tahmin) ---
    // Şantiye ya da MGM kaynaklı hata kokpiti düşürmez: ilgili kart örnek veriye
    // düşer ve `sections.demo` bunu açıkça bildirir.
    let cockpitSites: CockpitSite[] = [];
    let weather: SiteWeather[] = [];
    try {
      cockpitSites = await this.getSiteService().listSitesForCockpit(options.tenantId);
      if (cockpitSites.length > 0) {
        weather = await this.getWeatherService().forecastForSites(cockpitSites);
      }
    } catch {
      cockpitSites = [];
      weather = [];
    }

    // Canlı beslenen bölümler ile örnek veri kalan bölümler (arayüz etiketler).
    const live = [
      'kpi',
      'hesap-bakiyeleri',
      'cari-durum',
      'nakit-akisi',
      'vadeler',
      'cek-senet',
      'stok',
      'onay-kuyrugu',
      'uyarilar',
      'finans-hareketleri',
      'banka-hareketleri',
      'tedarikci-odemeleri',
      'gunun-ozeti',
    ];
    const demo = ['guvenlik-kamerasi', 'arac-filosu', 'personel', 'belge-beyan'];
    if (fxRows.rows.length > 0) live.push('doviz-kuru');
    else demo.push('doviz-kuru');
    if (cockpitSites.length > 0) live.push('santiye');
    else demo.push('santiye');
    if (weather.some((item) => item.status === 'ok')) live.push('hava-durumu');
    else demo.push('hava-durumu');

    return {
      generatedAt: new Date().toISOString(),
      currency: 'TRY',
      sections: { live, demo },
      kpis: {
        cash: {
          total: cashBalance + bankBalance,
          cash: cashBalance,
          bank: bankBalance,
          accounts: accounts.length,
        },
        month: { revenue: monthRevenue, expense: monthExpense, net: monthRevenue - monthExpense },
        overdue: {
          amount: num(overdueRow.rows[0]?.amount),
          count: num(overdueRow.rows[0]?.cnt),
          maxDays: num(overdueRow.rows[0]?.max_days),
        },
        approvals: {
          count: approvals.length,
          amount: approvals.reduce((total, approval) => total + approval.amount, 0),
        },
      },
      accounts,
      contacts,
      cashflow: {
        basis,
        label: cashflowLabel,
        weeks: basis === 'actual' ? actualWeeks : forecastWeeks,
      },
      dues: dues.slice(0, 12),
      cheques,
      stock: {
        items: stockItems,
        critical: stockItems.filter((item) => item.critical).slice(0, 6),
        movements: stockMoves,
        totalValue: num(stockTotalRow.rows[0]?.total_value),
        productCount: num(stockTotalRow.rows[0]?.product_count),
      },
      approvals,
      approvalsEditable: options.canDecideApprovals ?? false,
      alerts,
      finance,
      banks,
      suppliers,
      fx: fxRows.rows.map((row) => ({
        code: String(row.code),
        rate: num(row.rate),
        date: String(row.date),
      })),
      sites: cockpitSites,
      weather,
    };
  }
}








