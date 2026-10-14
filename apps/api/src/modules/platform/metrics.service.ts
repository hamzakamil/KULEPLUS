import { getPool } from '@kuleplus/db';

/**
 * Platform gelir metrikleri — SPEC §8.9 (Faz 4 ticari altyapı).
 *
 * Metrikler AYRI kavramlardır: Tahsilat ≠ Net nakit girişi ≠ Faturalanan tutar
 * ≠ MRR ≠ ARR. Bu modül yalnızca **taahhüt bazlı** MRR/ARR ve abonelik
 * hareketlerini üretir; tahsilat verisine dokunmaz.
 *
 * RLS notu: `subscriptions` (ve `commercial_orders`) tenant tablosudur ve
 * RLS'lidir. Bu yüzden okuma `app_migrator` (tablo sahibi) havuzuyla yapılır —
 * tablo sahibi RLS politikalarına tabi değildir. Sonuç, RLS'siz
 * `platform_metrics_daily` tablosuna yazılır; platform uçları yalnızca orayı
 * (ve canlı hesabı) okur.
 */

/** Plan bazlı dağılım satırı: aktif abonelik sayısı + o planın aylık geliri. */
export interface PlanMetrics {
  activeCount: number;
  mrr: number;
}

export interface PlatformMetricsSnapshot {
  metricDate: string;
  currency: string;
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  newSubscriptions: number;
  churnedSubscriptions: number;
  planBreakdown: Record<string, PlanMetrics>;
  computedAt: string;
}

export interface PlatformMetricsSummary {
  /** Canlı (anlık) hesap — snapshot yazılmaz. */
  current: PlatformMetricsSnapshot;
  /** Geçmiş günlük snapshot'lar (en yeni önce). */
  series: PlatformMetricsSnapshot[];
}

/**
 * Aktif aboneliklerin aylık normalize MRR'ı (T-4.8 taahhüt bazlı).
 *
 * Kural: `prices.amount_monthly` esastır; aylık fiyat yoksa `amount_yearly / 12`
 * ile aylığa normalize edilir. Abonelik periyodu (aylık/yıllık) veri modelinde
 * ayrı kolon olmadığından taahhüt bazlı yaklaşım uygulanır (SPEC §8.8 proration
 * yok kararı ile uyumlu).
 */
const ACTIVE_SUBSCRIPTIONS_SQL = `
  SELECT p.code AS plan_code,
         COUNT(*)::int AS active_count,
         COALESCE(SUM(COALESCE(pr.amount_monthly, pr.amount_yearly / 12.0, 0)), 0) AS mrr,
         COALESCE(MAX(pr.currency), 'TRY') AS currency
    FROM subscriptions s
    JOIN plan_versions pv ON pv.id = s.plan_version_id
    JOIN plans p ON p.id = pv.plan_id
    LEFT JOIN LATERAL (
      SELECT pr2.amount_monthly, pr2.amount_yearly, pr2.currency
        FROM prices pr2
       WHERE pr2.plan_version_id = pv.id
         AND (pr2.effective_from IS NULL OR pr2.effective_from <= now())
         AND (pr2.effective_until IS NULL OR pr2.effective_until > now())
       ORDER BY pr2.effective_from DESC NULLS LAST
       LIMIT 1
    ) pr ON true
   WHERE s.status = 'active'
   GROUP BY p.code
   ORDER BY p.code
`;

/** Gün içi abonelik hareketleri: yeni başlayan + iptal edilen (SPEC §8.9). */
const SUBSCRIPTION_MOVEMENTS_SQL = `
  SELECT
    (SELECT COUNT(*)::int FROM subscriptions WHERE started_at::date = $1) AS new_count,
    (SELECT COUNT(*)::int FROM subscriptions WHERE cancelled_at::date = $1) AS churned_count
`;

/** Bugünün tarihi (YYYY-MM-DD) — işletmeci saat dilimi (Europe/Istanbul, T-7.3). */
function todayIso(): string {
  // `sv-SE` yerel biçimi tam olarak YYYY-MM-DD üretir; UTC'ye çevirme yapılmaz
  // (aksi halde TR 00:00–03:00 arası metrik günü bir gün geriye kayar).
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

/** Para alanlarını 2 haneye yuvarlar (kayan nokta birikimini engeller). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * `date`/`timestamptz` → YYYY-MM-DD (işletmeci saat dilimi).
 * NOT: pg `date` kolonu JS `Date` olarak dönerse UTC'ye çevrilirken gün kayar
 * (ör. 2026-10-14 TR → 2026-10-13Z). Bu yüzden sorgu `metric_date::text` ile
 * okunur; bu fonksiyon yalnız güvenlik ağı olarak yerel biçimi kullanır.
 */
function toDateIso(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(value);
}

/**
 * Metrikleri hesaplar ama YAZMAZ — canlı özet ile snapshot aynı hesabı kullanır.
 */
export async function buildSnapshot(metricDate?: string): Promise<PlatformMetricsSnapshot> {
  const date = metricDate ?? todayIso();
  const migrator = getPool('migrator');

  const { rows } = await migrator.query<{
    plan_code: string;
    active_count: number;
    mrr: string | number;
    currency: string | null;
  }>(ACTIVE_SUBSCRIPTIONS_SQL);

  const planBreakdown: Record<string, PlanMetrics> = {};
  let mrr = 0;
  let activeSubscriptions = 0;
  let currency = 'TRY';

  for (const row of rows) {
    const planMrr = Number(row.mrr ?? 0);
    planBreakdown[row.plan_code] = {
      activeCount: Number(row.active_count ?? 0),
      mrr: round2(planMrr),
    };
    mrr += planMrr;
    activeSubscriptions += Number(row.active_count ?? 0);
    if (row.currency) currency = row.currency;
  }

  const { rows: movements } = await migrator.query<{
    new_count: number;
    churned_count: number;
  }>(SUBSCRIPTION_MOVEMENTS_SQL, [date]);

  return {
    metricDate: date,
    currency,
    mrr: round2(mrr),
    arr: round2(mrr * 12),
    activeSubscriptions,
    newSubscriptions: Number(movements[0]?.new_count ?? 0),
    churnedSubscriptions: Number(movements[0]?.churned_count ?? 0),
    planBreakdown,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Günlük snapshot'ı hesaplar ve `platform_metrics_daily`'ye yazar (idempotent upsert).
 * Aynı gün için tekrar çağrılırsa satır GÜNCELLENİR (worker günlük işi + elle tetikleme).
 */
export async function computeDailySnapshot(metricDate?: string): Promise<PlatformMetricsSnapshot> {
  const snapshot = await buildSnapshot(metricDate);

  await getPool('app').query(
    `INSERT INTO platform_metrics_daily (
       metric_date, currency, mrr, arr, active_subscriptions,
       new_subscriptions, churned_subscriptions, plan_breakdown, computed_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now(), now())
     ON CONFLICT (metric_date) DO UPDATE SET
       currency = EXCLUDED.currency,
       mrr = EXCLUDED.mrr,
       arr = EXCLUDED.arr,
       active_subscriptions = EXCLUDED.active_subscriptions,
       new_subscriptions = EXCLUDED.new_subscriptions,
       churned_subscriptions = EXCLUDED.churned_subscriptions,
       plan_breakdown = EXCLUDED.plan_breakdown,
       computed_at = now(),
       updated_at = now()`,
    [
      snapshot.metricDate,
      snapshot.currency,
      snapshot.mrr,
      snapshot.arr,
      snapshot.activeSubscriptions,
      snapshot.newSubscriptions,
      snapshot.churnedSubscriptions,
      JSON.stringify(snapshot.planBreakdown),
    ],
  );

  return snapshot;
}

/** Geçmiş snapshot'lar (en yeni önce) — RLS'siz platform tablosundan okunur. */
export async function listSnapshots(days = 30): Promise<PlatformMetricsSnapshot[]> {
  const limit = Math.min(365, Math.max(1, days));
  const { rows } = await getPool('app').query<{
    metric_date: string | Date;
    currency: string;
    mrr: string | number;
    arr: string | number;
    active_subscriptions: number;
    new_subscriptions: number;
    churned_subscriptions: number;
    plan_breakdown: Record<string, PlanMetrics> | null;
    computed_at: string | Date;
  }>(
    `SELECT metric_date::text AS metric_date, currency, mrr, arr, active_subscriptions, new_subscriptions,
            churned_subscriptions, plan_breakdown, computed_at
       FROM platform_metrics_daily
      ORDER BY metric_date DESC
      LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    metricDate: toDateIso(row.metric_date),
    currency: row.currency,
    mrr: Number(row.mrr ?? 0),
    arr: Number(row.arr ?? 0),
    activeSubscriptions: Number(row.active_subscriptions ?? 0),
    newSubscriptions: Number(row.new_subscriptions ?? 0),
    churnedSubscriptions: Number(row.churned_subscriptions ?? 0),
    planBreakdown: row.plan_breakdown ?? {},
    computedAt: new Date(row.computed_at).toISOString(),
  }));
}

/** Gelir paneli ana çağrısı: canlı hesap + geçmiş seri. */
export async function getMetricsSummary(days = 30): Promise<PlatformMetricsSummary> {
  const [current, series] = await Promise.all([buildSnapshot(), listSnapshots(days)]);
  return { current, series };
}
