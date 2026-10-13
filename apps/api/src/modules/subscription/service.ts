import { getPool } from '@kuleplus/db';
import {
  AppError,
  MockPaymentProvider,
  compareMoney,
  newId,
  subMoney,
  type MoneyString,
  type PaymentProvider,
} from '@kuleplus/shared';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

/**
 * Subscription / faturalama servisi — ROADMAP Faz 4 Hat B (SPEC §8.2, §8.6).
 *
 * Kapsam (engellenmemiş çekirdek):
 *  - ticari sipariş → tahsilat denemesi → fatura → abonelik → entitlement
 *    aktivasyon zincirinin VERİ katmanı (tablo sürücüsü),
 *  - kupon / partner (referans + komisyon) kayıtları.
 *
 * Bilinçli sınırlar:
 *  - Gerçek sanal POS bağlantısı (K-08) ve fiyatlandırma (K-03) kararları
 *    beklediği için tahsilat, `PaymentProvider` portu üzerinden yürür; dev/test
 *    ortamında `MockPaymentProvider` kullanılır (SPEC §29.1 Liskov).
 *  - Bu dosya tablo-odaklıdır: iş akışı `checkout` (aşağıda) + webhook işleyicisi
 *    ile genişletilir, düz CRUD ise yönetim ekranları içindir.
 *
 * Tenant izolasyonu iki katmanlı (cheque/accounting deseni):
 *  - API katmanı `tenantContext` (RLS GUC),
 *  - servis kendi transaction'ında `set_config('app.tenant_id', ...)`.
 *
 * `coupons` ve `partners` platform geneli katalog tablolarıdır (tenant_id yok)
 * → `global: true` ile sorgulanır.
 */

/** Sayfalı liste sorgusu. */
export interface ListQuery {
  page?: number;
  limit?: number;
}

/** Tablo sürücüsü seçim kriterleri. */
export interface ResourceSelector {
  table: string;
  columns: string[];
  tenantId?: string;
  /** Alt kaynak: `parentColumn = parentId` filtresi. */
  parentColumn?: string;
  parentId?: string;
  /** tenant_id kolonu olmayan platform tabloları (coupons, partners). */
  global?: boolean;
}

/** Sayfalı liste sonucu. */
export interface ResourcePage<T extends QueryResultRow> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

/** Yazma (insert/update) girdisi. */
export interface ResourceWrite extends ResourceSelector {
  id?: string;
  data: Record<string, unknown>;
  userId?: string;
}

/** Kimlik sütunu (tüm subscription tabloları `id` kullanır). */
const ID_COLUMN = 'id';
/** INSERT/UPDATE sırasında dışarıdan set edilemeyecek sütunlar. */
const PROTECTED_COLUMNS = new Set(['id', 'tenant_id', 'created_at', 'updated_at']);

/** SQL tanımlı ad (tablo/sütun) doğrulaması — enjeksiyon önlemi. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
function assertIdentifier(value: string, kind: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new AppError('VALIDATION_ERROR', `Geçersiz ${kind}: ${value}`);
  }
  return value;
}

/** Checkout akışı için sipariş satırı (money sütunları string — MoneyString). */
interface CheckoutOrder {
  id: string;
  tenant_id: string;
  order_no: string;
  plan_version_id: string;
  amount: MoneyString;
  currency: string;
  status: string;
}

/** Plan fiyat bilgisi (global `plans`/`prices` kataloğundan). */
export interface PlanPricing {
  planCode: string;
  planName: string;
  amountMonthly: MoneyString;
  currency: string;
  vatIncluded: boolean;
}

/** Checkout girişi — `POST /subscription/checkout`. */
export interface CheckoutRequest {
  orderId: string;
  provider: string;
  providerCustomerRef: string;
  userId: string;
  tenantId: string;
}

/** Checkout sonucu. */
export interface CheckoutResult {
  orderId: string;
  status: 'paid' | 'failed';
  paymentAttemptId: string;
  invoiceId?: string;
  subscriptionId?: string;
  detail?: string;
}

/** Normalize edilmiş sağlayıcı webhook olayı. */
export interface WebhookRequest {
  provider: string;
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded';
  providerRef: string;
  raw?: unknown;
}

/** İade edilebilir ödeme satırı (`billing_payments`). */
interface RefundablePayment {
  id: string;
  order_id: string;
  amount: MoneyString;
  currency: string;
  status: string;
  provider_ref: string | null;
}

/** `POST /subscription/payments/:paymentId/refund` girdisi. */
export interface RefundRequest {
  paymentId: string;
  /** Verilmezse iade edilebilir TAM tutar kullanılır (kısmi iade için yazılır). */
  amount?: MoneyString;
  reason?: string;
  userId: string;
  tenantId: string;
}

/** İade sonucu — ödeme durumu SPEC §8.7 sözlüğüyle güncellenir. */
export interface RefundOutcome {
  refundId: string;
  paymentId: string;
  orderId: string;
  status: 'succeeded' | 'failed';
  amount: MoneyString;
  paymentStatus: string;
  detail?: string;
}

/** Eşleştirilebilir platform faturası (`billing_invoices`). */
interface AllocationInvoice {
  id: string;
  total: MoneyString;
  currency: string;
  status: string;
}

/** `POST /subscription/payments/:paymentId/allocations` girdisi. */
export interface AllocateRequest {
  paymentId: string;
  invoiceId: string;
  /** Verilmezse faturanın eşleştirilebilir bakiyesi kadar. */
  amount?: MoneyString;
  userId: string;
  tenantId: string;
}

export class SubscriptionService {
  private pool: Pool | null = null;
  private readonly providedPool: Pool | null;
  private readonly paymentProvider: PaymentProvider;

  constructor(options?: { pool?: Pool; paymentProvider?: PaymentProvider }) {
    this.providedPool = options?.pool ?? null;
    // K-08 (sanal POS) kararı gelene dek mock-önce: gerçek sağlayıcı enjekte edilir.
    this.paymentProvider = options?.paymentProvider ?? new MockPaymentProvider();
  }

  private getPoolInstance(): Pool {
    if (this.pool) return this.pool;
    this.pool = this.providedPool ?? getPool('app');
    return this.pool;
  }

  private async withTenantClient<T>(
    tenantId: string | undefined,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = this.getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Sütunları whitelist'ler ve SQL parçası üretir. */
  private columnsOf(columns: string[]): string {
    return columns.map((c) => `"${assertIdentifier(c, 'sütun')}"`).join(', ');
  }

  /** Tenant (veya global) kapsamındaki WHERE cümlesi + parametreleri. */
  private scopeClause(
    sel: ResourceSelector,
    startIndex: number,
  ): { sql: string; values: unknown[] } {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (!sel.global) {
      clauses.push('tenant_id = current_tenant_id()');
    }
    if (sel.parentColumn && sel.parentId) {
      clauses.push(
        `"${assertIdentifier(sel.parentColumn, 'sütun')}" = $${startIndex + values.length}`,
      );
      values.push(sel.parentId);
    }
    return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', values };
  }

  // ======================= Tablo sürücüsü CRUD =======================

  /** Listele (sayfalı; alt kaynak `parentColumn`/`parentId` ile daraltılabilir). */
  async listResource<T extends QueryResultRow>(
    sel: ResourceSelector,
    query: ListQuery,
  ): Promise<ResourcePage<T>> {
    return this.withTenantClient(sel.tenantId, async (client) => {
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
      const offset = (page - 1) * limit;
      const scope = this.scopeClause(sel, 1);
      const sort = sel.columns.includes('created_at') ? ' ORDER BY created_at DESC' : '';
      const sql =
        `SELECT ${this.columnsOf(sel.columns)} FROM "${assertIdentifier(sel.table, 'tablo')}"` +
        `${scope.sql}${sort} OFFSET $${scope.values.length + 1} LIMIT $${scope.values.length + 2}`;
      const { rows } = await client.query<T>(sql, [...scope.values, offset, limit]);
      return { data: rows, page, limit, total: rows.length };
    });
  }

  /** Tek kayıt (tenant kapsamında). */
  async getResource<T extends QueryResultRow>(
    sel: ResourceSelector & { id: string },
  ): Promise<T | null> {
    return this.withTenantClient(sel.tenantId, (client) => this.getResourceImpl<T>(client, sel));
  }

  private async getResourceImpl<T extends QueryResultRow>(
    client: PoolClient,
    sel: ResourceSelector & { id: string; tenantId?: string },
  ): Promise<T | null> {
    const scope = this.scopeClause(sel, 1);
    const where = scope.sql === '' ? ' WHERE' : `${scope.sql} AND`;
    const { rows } = await client.query<T>(
      `SELECT ${this.columnsOf(sel.columns)} FROM "${assertIdentifier(sel.table, 'tablo')}"` +
        `${where} "${ID_COLUMN}" = $${scope.values.length + 1}`,
      [...scope.values, sel.id],
    );
    return rows[0] ?? null;
  }

  /** Yeni kayıt (tenant_id + id üretilir; sütun whitelist'i uygulanır). */
  async createResource<T extends QueryResultRow>(sel: ResourceWrite): Promise<T> {
    return this.withTenantClient(sel.tenantId, async (client) => {
      const row: Record<string, unknown> = { id: newId() };
      if (!sel.global) row.tenant_id = sel.tenantId ?? null;
      for (const col of sel.columns) {
        if (PROTECTED_COLUMNS.has(col)) continue;
        if (sel.data[col] !== undefined) row[col] = sel.data[col];
      }
      const cols = Object.keys(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await client.query<T>(
        `INSERT INTO "${assertIdentifier(sel.table, 'tablo')}" ` +
          `(${cols.map((c) => `"${assertIdentifier(c, 'sütun')}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`,
        Object.values(row),
      );
      const created = rows[0];
      await this.audit(client, sel, 'create', created, undefined, sel.userId);
      return created;
    });
  }

  /** Güncelle (yalnızca whitelist sütunlar; yoksa NOT_FOUND). */
  async updateResource<T extends QueryResultRow>(sel: ResourceWrite & { id: string }): Promise<T> {
    return this.withTenantClient(sel.tenantId, async (client) => {
      const current = await this.getResourceImpl<T>(client, sel);
      if (!current) throw new AppError('NOT_FOUND', 'Kayıt bulunamadı');
      const updates: string[] = [];
      const values: unknown[] = [];
      for (const col of sel.columns) {
        if (PROTECTED_COLUMNS.has(col)) continue;
        if (sel.data[col] !== undefined) {
          values.push(sel.data[col]);
          updates.push(`"${assertIdentifier(col, 'sütun')}" = $${values.length}`);
        }
      }
      if (updates.length === 0) throw new AppError('VALIDATION_ERROR', 'Güncellenecek alan yok');
      values.push(sel.id);
      const scope = this.scopeClause(sel, 1);
      const where = scope.sql === '' ? ' WHERE' : `${scope.sql} AND`;
      const { rows } = await client.query<T>(
        `UPDATE "${assertIdentifier(sel.table, 'tablo')}" SET ${updates.join(', ')}` +
          `${where} "${ID_COLUMN}" = $${values.length} RETURNING *`,
        [...scope.values, ...values],
      );
      const updated = rows[0];
      await this.audit(client, sel, 'update', updated, current, sel.userId);
      return updated;
    });
  }

  /** Sil (soft yok — kalıcı; yoksa NOT_FOUND). */
  async deleteResource(
    sel: ResourceSelector & { id: string; userId?: string },
  ): Promise<{ deleted: boolean }> {
    return this.withTenantClient(sel.tenantId, async (client) => {
      const current = await this.getResourceImpl<QueryResultRow>(client, sel);
      if (!current) throw new AppError('NOT_FOUND', 'Kayıt bulunamadı');
      const scope = this.scopeClause(sel, 1);
      const where = scope.sql === '' ? ' WHERE' : `${scope.sql} AND`;
      await client.query(
        `DELETE FROM "${assertIdentifier(sel.table, 'tablo')}"` +
          `${where} "${ID_COLUMN}" = $${scope.values.length + 1}`,
        [...scope.values, sel.id],
      );
      await this.audit(client, sel, 'delete', undefined, current, sel.userId);
      return { deleted: true };
    });
  }

  /** Denetim kaydı — yazma işlemleriyle AYNI transaction'da (SPEC §6.1). */
  private async audit(
    client: PoolClient,
    sel: ResourceSelector,
    action: 'create' | 'update' | 'delete',
    current: QueryResultRow | undefined,
    previous: QueryResultRow | undefined,
    userId?: string,
  ): Promise<void> {
    if (!sel.tenantId || !userId) return; // servis-izolasyon testlerinde audit isteğe bağlı
    const entityId = (current?.[ID_COLUMN] ?? previous?.[ID_COLUMN]) as string | null;
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        newId(),
        sel.tenantId,
        userId,
        `${sel.table}.${action}`,
        sel.table,
        entityId,
        previous ? JSON.stringify(previous) : null,
        current ? JSON.stringify(current) : null,
      ],
    );
  }

  // ======================= Plan fiyatı (global katalog) =======================

  /**
   * Plan sürümünün etkin aylık fiyatı (K-03 kararı gelene dek `prices` tablosu
   * esas alınır). Fiyat tanımsızsa `null` — çağıran "fiyat yok" hatası verir.
   */
  async getPlanPricing(planVersionId: string): Promise<PlanPricing | null> {
    return this.withTenantClient(undefined, async (client) => {
      const { rows } = await client.query(
        `SELECT p.code AS plan_code, p.name AS plan_name, pr.amount_monthly, pr.currency, pr.vat_included
           FROM plans p
           JOIN plan_versions pv ON pv.plan_id = p.id
           LEFT JOIN prices pr ON pr.plan_version_id = pv.id
          WHERE pv.id = $1 AND p.is_active = true AND pr.amount_monthly IS NOT NULL
          ORDER BY pr.effective_from DESC NULLS LAST
          LIMIT 1`,
        [planVersionId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        planCode: String(row.plan_code),
        planName: String(row.plan_name),
        amountMonthly: String(row.amount_monthly),
        currency: String(row.currency ?? 'TRY'),
        vatIncluded: Boolean(row.vat_included),
      };
    });
  }

  // ======================= Checkout (SPEC §8.6 aktivasyon zinciri) =======================

  /**
   * Sipariş → tahsilat → fatura → abonelik → entitlement aktivasyonu.
   *
   * Sıra bilinçli: tahsilat (harici I/O) transaction DIŞINDA yapılır; sonuç tek
   * transaction'da kalıcılaşır. Böylece çekirdek zincir ya tamamdır ya hiç.
   */
  async checkout(input: CheckoutRequest): Promise<CheckoutResult> {
    const order = await this.getResource<CheckoutOrder>({
      table: 'commercial_orders',
      columns: ['id', 'tenant_id', 'order_no', 'plan_version_id', 'amount', 'currency', 'status'],
      id: input.orderId,
      tenantId: input.tenantId,
    });
    if (!order) throw new AppError('NOT_FOUND', 'Ticari sipariş bulunamadı');
    if (order.status !== 'pending') {
      throw new AppError(
        'VALIDATION_ERROR',
        `Sipariş '${order.status}' durumunda; yalnızca 'pending' işlenebilir`,
      );
    }
    const pricing = await this.getPlanPricing(order.plan_version_id);
    if (!pricing) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Plan için fiyat tanımlı değil (K-03 kararı bekleniyor)',
      );
    }

    const charge = await this.paymentProvider.charge({
      providerCustomerRef: input.providerCustomerRef,
      idempotencyKey: `${input.orderId}:${input.provider}`,
      amount: order.amount,
      currency: order.currency,
      description: `${pricing.planName} abonelik — sipariş ${order.order_no}`,
    });

    return this.recordCheckout({
      order,
      provider: input.provider,
      providerRef: charge.providerRef,
      succeeded: charge.status === 'succeeded',
      detail: charge.detail ?? charge.status,
      userId: input.userId,
      tenantId: input.tenantId,
    });
  }

  /** Tahsilat sonucunu TEK transaction'da kalıcılaştırır. */
  private async recordCheckout(args: {
    order: CheckoutOrder;
    provider: string;
    providerRef: string;
    succeeded: boolean;
    detail?: string;
    userId: string;
    tenantId: string;
  }): Promise<CheckoutResult> {
    const { order, provider, providerRef, succeeded, userId, tenantId } = args;
    const attemptId = newId();

    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO payment_attempts
           (id, tenant_id, order_id, provider, provider_ref, idempotency_key, amount, currency, status, detail, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
        [
          attemptId,
          tenantId,
          order.id,
          provider,
          succeeded ? providerRef : null,
          `${order.id}:${provider}`,
          order.amount,
          order.currency,
          succeeded ? 'succeeded' : 'failed',
          args.detail ?? null,
        ],
      );

      if (!succeeded) {
        await client.query(
          `UPDATE commercial_orders SET status = 'failed', updated_at = now()
            WHERE id = $1 AND tenant_id = current_tenant_id()`,
          [order.id],
        );
        await this.audit(
          client,
          { table: 'commercial_orders', columns: ['id'], tenantId },
          'update',
          undefined,
          order,
          userId,
        );
        return {
          orderId: order.id,
          status: 'failed',
          paymentAttemptId: attemptId,
          detail: args.detail,
        };
      }

      // --- Fatura (K-03 gelene dek fiyatın KDV dahil olduğu varsayılır) ---
      const invoiceId = newId();
      await client.query(
        `INSERT INTO billing_invoices
           (id, tenant_id, order_id, number, subtotal, vat_total, total, currency, status, issued_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 0, $5, $6, 'issued', now(), now())`,
        [invoiceId, tenantId, order.id, `FAT-${order.order_no}`, order.amount, order.currency],
      );
      await client.query(
        `INSERT INTO billing_invoice_lines
           (id, tenant_id, invoice_id, description, amount, vat_rate, vat_amount, total, created_at)
         VALUES ($1, $2, $3, $4, $5, 0, 0, $5, now())`,
        [
          newId(),
          tenantId,
          invoiceId,
          `Abonelik tahsilatı — sipariş ${order.order_no}`,
          order.amount,
        ],
      );
      const paymentId = newId();
      await client.query(
        `INSERT INTO billing_payments
           (id, tenant_id, order_id, amount, currency, status, provider_ref, paid_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, now(), now())`,
        [paymentId, tenantId, order.id, order.amount, order.currency, providerRef],
      );
      // SPEC §8.6 "Fatura/alacak eşleştirme": tahsilat, kestiğimiz faturaya bağlanır.
      await client.query(
        `INSERT INTO billing_allocations
           (id, tenant_id, payment_id, invoice_id, amount, allocated_at, created_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
        [newId(), tenantId, paymentId, invoiceId, order.amount],
      );

      // --- Abonelik (aktif kayıt varsa yenilenir, yoksa açılır) ---
      const existing = await client.query(
        `SELECT id FROM subscriptions
          WHERE tenant_id = current_tenant_id() AND status IN ('active','past_due','pending_activation')
          ORDER BY created_at DESC LIMIT 1`,
      );
      const subscriptionId: string = existing.rows[0]?.id ?? newId();
      if (existing.rows[0]?.id) {
        await client.query(
          `UPDATE subscriptions
              SET plan_version_id = $2, status = 'active',
                  current_period_start = now(), current_period_end = now() + interval '1 month',
                  updated_at = now()
            WHERE id = $1 AND tenant_id = current_tenant_id()`,
          [subscriptionId, order.plan_version_id],
        );
      } else {
        await client.query(
          `INSERT INTO subscriptions
             (id, tenant_id, plan_version_id, status, started_at, current_period_start, current_period_end, created_at, updated_at)
           VALUES ($1, $2, $3, 'active', now(), now(), now() + interval '1 month', now(), now())`,
          [subscriptionId, tenantId, order.plan_version_id],
        );
      }

      // --- Plan modülleri → kalem + entitlement (modül kapıları açılır) ---
      const modules = await client.query(
        `SELECT DISTINCT f.module_code
           FROM plan_features pf
           JOIN features f ON f.id = pf.feature_id
          WHERE pf.plan_version_id = $1 AND pf.included = true`,
        [order.plan_version_id],
      );
      for (const row of modules.rows as { module_code: string }[]) {
        await client.query(
          `INSERT INTO subscription_items (id, tenant_id, subscription_id, module_code, quantity, created_at)
           VALUES ($1, $2, $3, $4, 1, now())
           ON CONFLICT (subscription_id, module_code) DO UPDATE SET quantity = 1`,
          [newId(), tenantId, subscriptionId, row.module_code],
        );
        await client.query(
          `INSERT INTO tenant_entitlements (tenant_id, module_code, plan_version_id, status, granted_at)
           VALUES ($1, $2, $3, 'active', now())
           ON CONFLICT (tenant_id, module_code)
             DO UPDATE SET plan_version_id = EXCLUDED.plan_version_id, status = 'active'`,
          [tenantId, row.module_code, order.plan_version_id],
        );
      }

      // --- Değişiklik geçmişi + sipariş durumu ---
      await client.query(
        `INSERT INTO subscription_changes
           (id, tenant_id, subscription_id, change_type, to_plan_version_id, effective_at, status, created_at)
         VALUES ($1, $2, $3, 'create', $4, now(), 'applied', now())`,
        [newId(), tenantId, subscriptionId, order.plan_version_id],
      );
      await client.query(
        `UPDATE commercial_orders SET status = 'paid', updated_at = now()
          WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [order.id],
      );
      await this.audit(
        client,
        { table: 'commercial_orders', columns: ['id'], tenantId },
        'update',
        { id: order.id, status: 'paid' },
        order,
        userId,
      );

      return {
        orderId: order.id,
        status: 'paid',
        paymentAttemptId: attemptId,
        invoiceId,
        subscriptionId,
      };
    });
  }

  // ======================= İade (SPEC §8.7: part_refunded/refunded) =======================

  /**
   * Kalıcı ödemeyi kısmen veya tamamen iade eder.
   *
   * Checkout deseniyle aynı ilke: sağlayıcı iadesi (harici I/O) transaction
   * DIŞINDA yapılır; iade kaydı + ödeme/sipariş durumu TEK transaction'da
   * kalıcılaşır. `billing_refunds` üzerinden kalan tutar hesaplanır (çift iade
   * engeli). Para `MoneyString` (SPEC §0.3).
   */
  async refundPayment(input: RefundRequest): Promise<RefundOutcome> {
    const payment = await this.getResource<RefundablePayment>({
      table: 'billing_payments',
      columns: ['id', 'order_id', 'amount', 'currency', 'status', 'provider_ref'],
      id: input.paymentId,
      tenantId: input.tenantId,
    });
    if (!payment) throw new AppError('NOT_FOUND', 'Ödeme bulunamadı');
    if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
      throw new AppError(
        'VALIDATION_ERROR',
        `Yalnızca 'succeeded' veya 'partially_refunded' ödeme iade edilir (mevcut: ${payment.status})`,
      );
    }

    const alreadyRefunded = await this.sumSuccessfulRefunds(payment.id, input.tenantId);
    const refundable = subMoney(payment.amount, alreadyRefunded);
    if (compareMoney(refundable, '0') <= 0) {
      throw new AppError('VALIDATION_ERROR', 'Bu ödemenin iade edilebilir tutarı kalmamış');
    }
    const amount = input.amount ?? refundable;
    if (compareMoney(amount, refundable) > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        `İade tutarı iade edilebilir tutarı aşıyor (en fazla ${refundable})`,
      );
    }

    // Harici I/O transaction dışında (checkout ile aynı ilke).
    const result = await this.paymentProvider.refund(payment.provider_ref ?? '', amount);
    return this.recordRefund({
      payment,
      amount,
      succeeded: result.status === 'refunded',
      providerRef: result.providerRef || null,
      detail: result.detail ?? result.status,
      reason: input.reason,
      userId: input.userId,
      tenantId: input.tenantId,
    });
  }

  /** Ödemenin BAŞARILI iade toplamı (kayıt yoksa '0'). */
  private async sumSuccessfulRefunds(paymentId: string, tenantId?: string): Promise<MoneyString> {
    return this.withTenantClient(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::text AS refunded
           FROM billing_refunds
          WHERE payment_id = $1 AND tenant_id = current_tenant_id() AND status = 'succeeded'`,
        [paymentId],
      );
      return String(rows[0]?.refunded ?? '0');
    });
  }

  /** İade sonucunu TEK transaction'da kalıcılaştırır (ödeme + sipariş durumu). */
  private async recordRefund(args: {
    payment: RefundablePayment;
    amount: MoneyString;
    succeeded: boolean;
    providerRef: string | null;
    detail?: string;
    reason?: string;
    userId: string;
    tenantId: string;
  }): Promise<RefundOutcome> {
    const { payment, amount, succeeded, tenantId, userId } = args;
    const refundId = newId();

    return this.withTenantClient(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO billing_refunds
           (id, tenant_id, payment_id, order_id, provider_ref, amount, currency, status, reason, refunded_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()) RETURNING *`,
        [
          refundId,
          tenantId,
          payment.id,
          payment.order_id,
          args.providerRef,
          amount,
          payment.currency,
          succeeded ? 'succeeded' : 'failed',
          args.reason ?? args.detail ?? null,
          succeeded ? new Date() : null,
        ],
      );
      const refundRow = rows[0] as QueryResultRow | undefined;
      await this.audit(
        client,
        { table: 'billing_refunds', columns: ['id'], tenantId },
        'create',
        refundRow,
        undefined,
        userId,
      );

      if (!succeeded) {
        return {
          refundId,
          paymentId: payment.id,
          orderId: payment.order_id,
          status: 'failed',
          amount,
          paymentStatus: payment.status,
          detail: args.detail,
        };
      }

      // Ödeme durumu SPEC §8.7: toplam iade ödemeyi yakaladıysa 'refunded'.
      const total = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::text AS refunded
           FROM billing_refunds
          WHERE payment_id = $1 AND tenant_id = current_tenant_id() AND status = 'succeeded'`,
        [payment.id],
      );
      const refundedTotal = String(total.rows[0]?.refunded ?? '0');
      const fullyRefunded = compareMoney(refundedTotal, payment.amount) >= 0;
      const paymentStatus = fullyRefunded ? 'refunded' : 'partially_refunded';
      await client.query(
        `UPDATE billing_payments SET status = $2 WHERE id = $1 AND tenant_id = current_tenant_id()`,
        [payment.id, paymentStatus],
      );
      await this.audit(
        client,
        { table: 'billing_payments', columns: ['id'], tenantId },
        'update',
        { id: payment.id, status: paymentStatus },
        payment,
        userId,
      );
      if (fullyRefunded) {
        await client.query(
          `UPDATE commercial_orders SET status = 'refunded', updated_at = now()
            WHERE id = $1 AND tenant_id = current_tenant_id()`,
          [payment.order_id],
        );
      }

      return {
        refundId,
        paymentId: payment.id,
        orderId: payment.order_id,
        status: 'succeeded',
        amount,
        paymentStatus,
        detail: args.detail,
      };
    });
  }

  // ======================= Fatura ↔ ödeme eşleştirme (SPEC §8.6 alacak) ======================

  /**
   * Kalıcı ödemeyi bir platform faturasıyla eşleştirir (alacak kapatma).
   *
   * Yalnızca `issued` fatura ve `succeeded`/`partially_refunded` ödeme eşleşir;
   * toplam eşleştirme fatura bakiyesini aşamaz (kısmi eşleştirme serbest). Para
   * `MoneyString` (SPEC §0.3); kayıt + denetim TEK transaction'da.
   */
  async allocatePayment(
    input: AllocateRequest,
  ): Promise<{ allocationId: string; remaining: MoneyString }> {
    const payment = await this.getResource<RefundablePayment>({
      table: 'billing_payments',
      columns: ['id', 'order_id', 'amount', 'currency', 'status', 'provider_ref'],
      id: input.paymentId,
      tenantId: input.tenantId,
    });
    if (!payment) throw new AppError('NOT_FOUND', 'Ödeme bulunamadı');
    if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
      throw new AppError(
        'VALIDATION_ERROR',
        `Yalnızca 'succeeded' veya 'partially_refunded' ödeme eşleştirilir (mevcut: ${payment.status})`,
      );
    }

    const invoice = await this.getResource<AllocationInvoice>({
      table: 'billing_invoices',
      columns: ['id', 'total', 'currency', 'status'],
      id: input.invoiceId,
      tenantId: input.tenantId,
    });
    if (!invoice) throw new AppError('NOT_FOUND', 'Fatura bulunamadı');
    if (invoice.status !== 'issued') {
      throw new AppError(
        'VALIDATION_ERROR',
        `Yalnızca 'issued' fatura eşleştirilir (mevcut: ${invoice.status})`,
      );
    }
    if (invoice.currency !== payment.currency) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Para birimi uyuşmuyor (fatura ${invoice.currency} / ödeme ${payment.currency})`,
      );
    }

    const allocated = await this.sumAllocations(invoice.id, input.tenantId);
    const openInvoice = subMoney(invoice.total, allocated);
    if (compareMoney(openInvoice, '0') <= 0) {
      throw new AppError('VALIDATION_ERROR', 'Bu faturanın eşleştirilebilir bakiyesi kalmamış');
    }
    const amount = input.amount ?? openInvoice;
    if (compareMoney(amount, openInvoice) > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Eşleştirme tutarı fatura bakiyesini aşıyor (en fazla ${openInvoice})`,
      );
    }

    const allocationId = newId();
    await this.withTenantClient(input.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO billing_allocations
           (id, tenant_id, payment_id, invoice_id, amount, allocated_at, created_at)
         VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING *`,
        [allocationId, input.tenantId, payment.id, invoice.id, amount],
      );
      await this.audit(
        client,
        { table: 'billing_allocations', columns: ['id'], tenantId: input.tenantId },
        'create',
        rows[0] as QueryResultRow | undefined,
        undefined,
        input.userId,
      );
    });
    return { allocationId, remaining: subMoney(openInvoice, amount) };
  }

  /** Faturanın eşleştirilmiş (kapalı) toplamı (kayıt yoksa '0'). */
  private async sumAllocations(invoiceId: string, tenantId?: string): Promise<MoneyString> {
    return this.withTenantClient(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::text AS allocated
           FROM billing_allocations
          WHERE invoice_id = $1 AND tenant_id = current_tenant_id()`,
        [invoiceId],
      );
      return String(rows[0]?.allocated ?? '0');
    });
  }

  // ======================= Webhook (elle replay — K-08 ile imzalı olur) =======================

  /**
   * Sağlayıcı olayını kaydeder; `payment.succeeded` ise ilgili tahsilat denemesini
   * ve siparişi ileri alır. Gerçek imza doğrulaması K-08 (sanal POS) kararıyla gelir.
   */
  async handleWebhook(
    input: WebhookRequest,
    tenantId?: string,
  ): Promise<{ recorded: boolean; applied: boolean }> {
    return this.withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO provider_webhook_events (id, provider, external_event_id, event_type, payload, processed_at, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())
         ON CONFLICT (provider, external_event_id) DO NOTHING`,
        [newId(), input.provider, input.eventId, input.type, JSON.stringify(input.raw ?? {})],
      );
      if (input.type === 'refund.succeeded') {
        // Async iade onayı (K-08 sonrası): bekleyen iadeyi başarılıya çeker.
        const { rows } = await client.query(
          `UPDATE billing_refunds SET status = 'succeeded', refunded_at = now()
            WHERE provider_ref = $1 AND tenant_id = current_tenant_id() AND status = 'pending'
            RETURNING id`,
          [input.providerRef],
        );
        return { recorded: true, applied: rows.length > 0 };
      }
      if (input.type !== 'payment.succeeded') return { recorded: true, applied: false };

      const { rows } = await client.query(
        `UPDATE payment_attempts SET status = 'succeeded'
          WHERE provider_ref = $1 AND tenant_id = current_tenant_id()
          RETURNING order_id`,
        [input.providerRef],
      );
      const orderId = rows[0]?.order_id as string | undefined;
      if (!orderId) return { recorded: true, applied: false };

      await client.query(
        `UPDATE commercial_orders SET status = 'paid', updated_at = now()
          WHERE id = $1 AND tenant_id = current_tenant_id() AND status <> 'paid'`,
        [orderId],
      );
      return { recorded: true, applied: true };
    });
  }
}
