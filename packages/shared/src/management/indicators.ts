/**
 * Patron Görünümü kural değerlendirmesi — paylaşılan kernel (ADR-0020, SPEC §26).
 *
 * Göstergeler ana iş tablolarından (invoices, products, cheques, expenses) istek
 * anında sorgulanır; ayrı özet tablosu tutulmaz. Hem API (`ManagementDashboardService`)
 * hem worker (günlük/haftalık özet e-postası) bu tek kaynağı kullanır; böylece
 * dashboard tutarı ile özet e-postası aynı kuralları/eşikleri paylaşır.
 *
 * Veritabanı erişimi `RowQuery` callback'i ile enjekte edilir — paylaşılan paket
 * `pg`'ye bağımlı değildir. Çağıran, tenant kapsamlı bir transaction içinde geçerli
 * bir query fonksiyonu verir (RLS: `app.current_tenant_id()`).
 */

import { RULE_KEYS, mergeRuleParams, type RuleKey } from './rules';

export type TrafficStatus = 'green' | 'amber' | 'red';

export interface DashboardIndicator {
  key: string;
  label: string;
  status: TrafficStatus;
  /** Para birimi (TRY) tutarı (varsa). */
  amount?: number;
  /** Adet / sayı (varsa). */
  count?: number;
  /** Kısa açıklama — kural sonucunu sade dille anlatır. */
  hint: string;
  /** Kullanıcıyı ilgili listeye götüren rota. */
  link: string;
}

export interface DashboardSummary {
  generatedAt: string;
  overall: TrafficStatus;
  indicators: DashboardIndicator[];
}

export interface RuleState {
  enabled: boolean;
  params: Record<string, number>;
}

/** Tenant kapsamlı SQL yürütücü — `pg` PoolClient.query ile yapısal uyumlu. */
export type RowQuery = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

const STATUS_RANK: Record<TrafficStatus, number> = { green: 0, amber: 1, red: 2 };

export function worstOf(statuses: TrafficStatus[]): TrafficStatus {
  return statuses.reduce<TrafficStatus>(
    (worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst),
    'green',
  );
}

/** `management_rule_settings` override'larını okur, varsayılanlarla birleştirir. */
export async function loadRuleStates(query: RowQuery): Promise<Record<RuleKey, RuleState>> {
  const rows = await query(
    `SELECT rule_key, enabled, params FROM management_rule_settings
      WHERE tenant_id = app.current_tenant_id()`,
  );
  const override = new Map<string, { enabled: boolean; params: unknown }>();
  for (const r of rows.rows) {
    override.set(String(r.rule_key), { enabled: Boolean(r.enabled), params: r.params });
  }
  const states = {} as Record<RuleKey, RuleState>;
  for (const key of RULE_KEYS) {
    const row = override.get(key);
    const rawParams =
      row && row.params && typeof row.params === 'object'
        ? (row.params as Record<string, unknown>)
        : null;
    states[key] = {
      enabled: row ? row.enabled : true,
      params: mergeRuleParams(key, rawParams),
    };
  }
  return states;
}

/** Tüm etkin kuralları değerlendirip güncel özeti üretir. */
export async function buildDashboardSummary(query: RowQuery): Promise<DashboardSummary> {
  const states = await loadRuleStates(query);
  const indicators: DashboardIndicator[] = [];
  for (const key of RULE_KEYS) {
    const state = states[key];
    if (!state.enabled) continue;
    indicators.push(await evaluateIndicator(query, key, state.params));
  }
  return {
    generatedAt: new Date().toISOString(),
    overall: worstOf(indicators.map((i) => i.status)),
    indicators,
  };
}

export async function evaluateIndicator(
  query: RowQuery,
  key: RuleKey,
  params: Record<string, number>,
): Promise<DashboardIndicator> {
  switch (key) {
    case 'overdue_receivable':
      return overdueReceivable(query, params);
    case 'critical_stock':
      return criticalStock(query, params);
    case 'due_cheque':
      return dueCheque(query, params);
    case 'unusual_expense':
      return unusualExpense(query, params);
  }
}

/** Vadesi geçen alacak — satış faturalarında bakiyesi kalan ve vadesi geçmiş tutar. */
async function overdueReceivable(
  query: RowQuery,
  params: Record<string, number>,
): Promise<DashboardIndicator> {
  const criticalDays = params.critical_days ?? 30;
  const result = await query(
    `SELECT COUNT(*) AS cnt,
            COALESCE(SUM(balance), 0) AS amount,
            COALESCE(MAX(CURRENT_DATE - COALESCE(due_date, issue_date)), 0) AS max_days
       FROM invoices
      WHERE tenant_id = app.current_tenant_id() AND type = 'sales' AND status <> 'cancelled'
        AND COALESCE(balance, 0) > 0
        AND COALESCE(due_date, issue_date) < CURRENT_DATE`,
  );
  const count = Number(result.rows[0].cnt);
  const amount = Number(result.rows[0].amount);
  const maxDays = Number(result.rows[0].max_days);

  let status: TrafficStatus = 'green';
  let hint = 'Vadesi geçen alacak yok.';
  if (count > 0) {
    status = maxDays > criticalDays ? 'red' : 'amber';
    hint = `${count} faturada ${maxDays} güne kadar gecikme var.`;
  }
  return {
    key: 'overdue_receivable',
    label: 'Vadesi geçen alacak',
    status,
    amount,
    count,
    hint,
    link: '/invoices',
  };
}

/** Kritik stok — stoğu sıfır veya altına inmiş aktif ürün sayısı. */
async function criticalStock(
  query: RowQuery,
  params: Record<string, number>,
): Promise<DashboardIndicator> {
  const redCount = params.red_count ?? 5;
  const result = await query(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT p.id
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.tenant_id = p.tenant_id
        WHERE p.tenant_id = app.current_tenant_id() AND p.is_active = true AND p.track_inventory = true
        GROUP BY p.id
       HAVING COALESCE(SUM(sb.quantity), 0) <= 0
     ) t`,
  );
  const count = Number(result.rows[0].cnt);

  let status: TrafficStatus = 'green';
  let hint = 'Stok seviyeleri yeterli.';
  if (count > 0) {
    status = count >= redCount ? 'red' : 'amber';
    hint = `${count} ürün tükendi veya kritik seviyede.`;
  }
  return {
    key: 'critical_stock',
    label: 'Kritik stok',
    status,
    count,
    hint,
    link: '/stock',
  };
}

/** Çek vadesi — portföydeki verilen çeklerden vadesi yaklaşan/geçen. */
async function dueCheque(
  query: RowQuery,
  params: Record<string, number>,
): Promise<DashboardIndicator> {
  const windowDays = params.window_days ?? 7;
  const result = await query(
    `SELECT COUNT(*) AS cnt,
            COUNT(*) FILTER (WHERE due_date < CURRENT_DATE) AS overdue_cnt,
            COALESCE(SUM(amount), 0) AS amount
       FROM cheques
      WHERE tenant_id = app.current_tenant_id() AND direction = 'outgoing'
        AND status = 'portfolio'
        AND due_date <= CURRENT_DATE + ($1 || ' days')::interval`,
    [windowDays],
  );
  const count = Number(result.rows[0].cnt);
  const overdueCount = Number(result.rows[0].overdue_cnt);
  const amount = Number(result.rows[0].amount);

  let status: TrafficStatus = 'green';
  let hint = 'Yaklaşan çek vadesi yok.';
  if (count > 0) {
    status = overdueCount > 0 ? 'red' : 'amber';
    hint =
      overdueCount > 0
        ? `${overdueCount} çekin vadesi geçmiş.`
        : `${count} çekin vadesi ${windowDays} gün içinde.`;
  }
  return {
    key: 'due_cheque',
    label: 'Çek vadesi',
    status,
    amount,
    count,
    hint,
    link: '/reports',
  };
}

/** Olağandışı gider — son dönemde ortalamanın belirgin üzerinde giderler. */
async function unusualExpense(
  query: RowQuery,
  params: Record<string, number>,
): Promise<DashboardIndicator> {
  const lookbackDays = params.lookback_days ?? 90;
  const recentDays = params.recent_days ?? 7;
  const multiplier = params.multiplier ?? 3;
  const result = await query(
    `WITH base AS (
       SELECT AVG(base_amount) AS avg_amount
         FROM expenses
        WHERE tenant_id = app.current_tenant_id() AND status <> 'cancelled'
          AND expense_date >= CURRENT_DATE - ($1 || ' days')::interval
     )
     SELECT COUNT(*) AS cnt, COALESCE(SUM(e.base_amount), 0) AS amount
       FROM expenses e, base
      WHERE e.tenant_id = app.current_tenant_id() AND e.status <> 'cancelled'
        AND e.expense_date >= CURRENT_DATE - ($2 || ' days')::interval
        AND base.avg_amount > 0 AND e.base_amount > base.avg_amount * $3`,
    [lookbackDays, recentDays, multiplier],
  );
  const count = Number(result.rows[0].cnt);
  const amount = Number(result.rows[0].amount);

  return {
    key: 'unusual_expense',
    label: 'Olağandışı gider',
    status: count > 0 ? 'amber' : 'green',
    amount,
    count,
    hint: count > 0 ? `${count} gider normal ortalamanın çok üzerinde.` : 'Olağandışı gider yok.',
    link: '/expenses',
  };
}
