/**
 * Dunning iş mantığı — paylaşılan kernel (SPEC §8.7/§8.8, ADR-0020).
 *
 * Başarısız tahsilatta yeniden deneme: 1/3/7. gün → ek süre dolduktan sonra
 * askıya alma. `claimDueDunningRow` (kilitli seçim, SKIP LOCKED) ve
 * `applyDunningOutcome` (sonucu tek transaction'da uygular) SAF fonksiyonlardır:
 * `pg`'ye bağımsız, `RowQuery` callback'i üzerinden çalışır (RLS:
 * `app.current_tenant_id()` çağıranın tenant kapsamlı transaction'ında geçerli).
 *
 * Hem API (`SubscriptionService.processDueDunning`) hem worker
 * (`billing-dunning` handler) bu tek kaynağı kullanır; harici `provider.charge`
 * I/O'su her iki çağıranın kendi sorumluluğundadır (transaction DIŞINDA —
 * kilitli bağlantı uzun süre tutulmaz).
 */

import type { MoneyString } from '../integrations/ports.js';
import type { RowQuery } from '../management/indicators.js';

/** Kilitli dunning denemesi (claim) — işlenecek tek kayıt. */
export interface DunningClaimRow {
  id: string;
  subscription_id: string;
  order_id: string;
  attempt_no: number;
  amount: MoneyString;
  currency: string;
}

/** Dunning işleme sonucu. */
export interface ProcessDunningResult {
  processed: number;
  succeeded: number;
  suspended: number;
}

/**
 * Vadesi gelmiş ilk dunning denemesini kilitler (`FOR UPDATE … SKIP LOCKED` —
 * eşzamanlı worker güvenli) ve `processing` işaretler. İşlenecek kayıt yoksa
 * `null`. Tenant kapsamı RLS ile `current_tenant_id()` üzerinden zorunur.
 */
export async function claimDueDunningRow(query: RowQuery): Promise<DunningClaimRow | null> {
  const r = await query(
    `SELECT da.id, da.subscription_id, da.order_id, da.attempt_no,
            co.amount::text AS amount, co.currency
       FROM dunning_attempts da
       JOIN commercial_orders co ON co.id = da.order_id
      WHERE da.status = 'pending' AND da.scheduled_at <= now()
        AND da.tenant_id = current_tenant_id()
      ORDER BY da.attempt_no
      FOR UPDATE OF da SKIP LOCKED
      LIMIT 1`,
  );
  const row = r.rows[0] as unknown as DunningClaimRow | undefined;
  if (!row) return null;
  await query(
    `UPDATE dunning_attempts SET status = 'processing', processed_at = now() WHERE id = $1`,
    [row.id],
  );
  return row;
}

/** `applyDunningOutcome` girdisi — tahsilat sonucu + ilgili deneme. */
export interface ApplyDunningInput {
  attempt: DunningClaimRow;
  succeeded: boolean;
  providerRef: string | null;
  detail?: string | null;
}

/**
 * Tahsilat sonucunu tek transaction'da uygular:
 *  - succeeded → kalan denemeler `skipped`, abonelik `active` + periyot ilerler,
 *    sipariş `paid`.
 *  - failed → attempt `failed`; tüm denemeler tükendiyse ve ek süre dolduysa
 *    abonelik `suspended` (ücretsiz plana düşürme Faz 5 UI'ı).
 */
export async function applyDunningOutcome(
  query: RowQuery,
  input: ApplyDunningInput,
): Promise<ProcessDunningResult> {
  const { attempt, succeeded } = input;
  await query(
    `UPDATE dunning_attempts
        SET status = $2, provider_ref = $3, detail = $4, processed_at = now()
      WHERE id = $1 AND tenant_id = current_tenant_id()`,
    [attempt.id, succeeded ? 'succeeded' : 'failed', input.providerRef, input.detail ?? null],
  );

  if (succeeded) {
    await query(
      `UPDATE dunning_attempts SET status = 'skipped', processed_at = now()
        WHERE subscription_id = $1 AND status = 'pending' AND tenant_id = current_tenant_id()`,
      [attempt.subscription_id],
    );
    await query(
      `UPDATE subscriptions
          SET status = 'active', grace_period_until = NULL,
              current_period_start = now(), current_period_end = now() + interval '1 month',
              updated_at = now()
        WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [attempt.subscription_id],
    );
    await query(
      `UPDATE commercial_orders SET status = 'paid', updated_at = now()
        WHERE id = $1 AND tenant_id = current_tenant_id() AND status <> 'paid'`,
      [attempt.order_id],
    );
    return { processed: 1, succeeded: 1, suspended: 0 };
  }

  const r = await query(
    `SELECT
       (SELECT count(*)::int FROM dunning_attempts
         WHERE subscription_id = $1 AND status = 'pending') AS remaining,
       (SELECT grace_period_until FROM subscriptions WHERE id = $1) AS grace`,
    [attempt.subscription_id],
  );
  const remaining = Number(r.rows[0]?.remaining ?? 0);
  const grace = r.rows[0]?.grace as Date | string | null;
  const gracePassed = grace ? new Date(grace).getTime() <= Date.now() : false;
  if (remaining === 0 && gracePassed) {
    await query(
      `UPDATE subscriptions SET status = 'suspended', updated_at = now()
        WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [attempt.subscription_id],
    );
    return { processed: 1, succeeded: 0, suspended: 1 };
  }
  return { processed: 1, succeeded: 0, suspended: 0 };
}
