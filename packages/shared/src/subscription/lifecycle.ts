/**
 * Abonelik yaşam döngüsü kesinleştirme — paylaşılan kernel (SPEC §8.7/§8.8, ADR-0020).
 *
 * Dunning (yeniden deneme) işleyicisinin erişemediği, zaman-bağımlı geçişleri tek
 * adımda kapatır:
 *   1. `past_due` + ek süre (`grace_period_until`) dolmuş + açık dunning denemesi
 *      kalmamış → `suspended` (ücretsiz plana düşme).
 *   2. `active` + `cancel_at_period_end` + dönem sonu gelmiş → `cancelled`.
 * Her iki geçişte premium (core hariç) entitlement'lar kapatılır; `requireEntitlement`
 * yalnızca `status='active'`i geçirdiği için modül erişimi otomatik kapanır.
 *
 * `RowQuery` callback'i üzerinden çalışır (RLS: `app.current_tenant_id()`), `pg`'ye
 * bağımsız. API (`SubscriptionService.processLifecycle`) ve worker (`billing-lifecycle`
 * handler) bu tek kaynağı kullanır; harici I/O içermez.
 */

import type { RowQuery } from '../management/indicators.js';

/** Tek taramada yapılan kesinleştirme sayımları. */
export interface SubscriptionLifecycleResult {
  suspended: number;
  cancelled: number;
}

/**
 * Tenant'ın premium (core hariç) entitlement'larını kapatır. Bir tenant
 * `suspended`/`cancelled` olduğunda tüm ticari modül erişimi kapanır (tek
 * abonelik modeli); ücretsiz çekirdek (`core`) korunur. RLS tenant kapsamında
 * `current_tenant_id()` ile sınırlanır.
 */
export async function deactivatePremiumEntitlements(
  query: RowQuery,
  status: 'suspended' | 'cancelled',
): Promise<void> {
  await query(
    `UPDATE tenant_entitlements
        SET status = $1
      WHERE module_code <> 'core' AND status = 'active'
        AND tenant_id = current_tenant_id()`,
    [status],
  );
}

/**
 * Vadesi gelmiş yaşam döngüsü geçişlerini tek tenant kapsamında uygular.
 * Idempotent (ADR-0020): her geçiş durum koşullarına bağlı olduğundan yinelenen
 * çalışma yeni yan etki üretmez (suspended/cancelled tek kez yazılır).
 */
export async function applyLifecycleStep(query: RowQuery): Promise<SubscriptionLifecycleResult> {
  const suspended = await query(
    `UPDATE subscriptions
        SET status = 'suspended', updated_at = now()
      WHERE status = 'past_due'
        AND grace_period_until IS NOT NULL AND grace_period_until <= now()
        AND NOT EXISTS (
          SELECT 1 FROM dunning_attempts da
           WHERE da.subscription_id = subscriptions.id
             AND da.status IN ('pending', 'processing')
        )
        AND tenant_id = current_tenant_id()
      RETURNING id`,
  );
  const cancelled = await query(
    `UPDATE subscriptions
        SET status = 'cancelled',
            cancelled_at = COALESCE(cancelled_at, now()),
            updated_at = now()
      WHERE status = 'active'
        AND cancel_at_period_end = true
        AND current_period_end IS NOT NULL AND current_period_end <= now()
        AND tenant_id = current_tenant_id()
      RETURNING id`,
  );
  const suspendedCount = (suspended.rows ?? []).length;
  const cancelledCount = (cancelled.rows ?? []).length;
  if (suspendedCount > 0) await deactivatePremiumEntitlements(query, 'suspended');
  if (cancelledCount > 0) await deactivatePremiumEntitlements(query, 'cancelled');
  return { suspended: suspendedCount, cancelled: cancelledCount };
}
