import { getPool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';

/**
 * Ortak (SMMM) programı — platform tarafı (ROADMAP Faz 4 "Ortak programı v1").
 *
 * `partner_referrals` / `partner_commissions` tenant tablolarıdır (RLS); bir ortağın
 * tüm müşterilerini görmek çapraz tenant okumadır. Bu yüzden — `metrics.service`
 * ile aynı gerekçeyle — okuma/yazma `app_migrator` (tablo sahibi, RLS'e tabi değil)
 * havuzuyla yapılır; kapı route katmanındadır (`platform_finance` rolü).
 *
 * Komisyon üretimi burada DEĞİL, ödeme başarıyla kaydedilirken
 * (`SubscriptionService.recordCheckout`) aynı transaction'da yapılır.
 */

export const COMMISSION_STATUSES = ['pending', 'approved', 'paid', 'cancelled'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/** Geçerli durum geçişleri — `paid` ve `cancelled` sondur (geri dönüş yok). */
const TRANSITIONS: Record<CommissionStatus, readonly CommissionStatus[]> = {
  pending: ['approved', 'cancelled'],
  approved: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

export interface PartnerSummary {
  id: string;
  code: string;
  name: string;
  /** Yüzde (örn. "20.00"). */
  commissionRate: string;
  isActive: boolean;
  createdAt: string;
  referralCount: number;
  /** Para alanları NUMERIC string (float yok — SPEC §22.1). */
  pendingAmount: string;
  approvedAmount: string;
  paidAmount: string;
}

export interface CommissionRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  orderId: string;
  orderNo: string | null;
  amount: string;
  status: CommissionStatus;
  createdAt: string;
}

export interface ReferralRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  referredAt: string;
}

const iso = (value: string | Date): string => new Date(value).toISOString();

const UNIQUE_VIOLATION = '23505';

export async function listPartners(): Promise<PartnerSummary[]> {
  const { rows } = await getPool('migrator').query<{
    id: string;
    code: string;
    name: string;
    commission_rate: string;
    is_active: boolean;
    created_at: string | Date;
    referral_count: number;
    pending_amount: string;
    approved_amount: string;
    paid_amount: string;
  }>(
    `SELECT p.id, p.code, p.name, p.commission_rate::text AS commission_rate, p.is_active, p.created_at,
            (SELECT COUNT(*)::int FROM partner_referrals r WHERE r.partner_id = p.id) AS referral_count,
            COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'pending'), 0)::text AS pending_amount,
            COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'approved'), 0)::text AS approved_amount,
            COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'paid'), 0)::text AS paid_amount
       FROM partners p
       LEFT JOIN partner_commissions c ON c.partner_id = p.id
      GROUP BY p.id
      ORDER BY p.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    commissionRate: r.commission_rate,
    isActive: r.is_active,
    createdAt: iso(r.created_at),
    referralCount: Number(r.referral_count),
    pendingAmount: r.pending_amount,
    approvedAmount: r.approved_amount,
    paidAmount: r.paid_amount,
  }));
}

export async function createPartner(input: {
  code: string;
  name: string;
  commissionRate: number;
}): Promise<{ id: string }> {
  const id = newId();
  try {
    await getPool('migrator').query(
      `INSERT INTO partners (id, code, name, commission_rate, is_active, created_at)
       VALUES ($1, $2, $3, $4, true, now())`,
      [id, input.code, input.name, input.commissionRate],
    );
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new AppError('CONFLICT', 'Bu ortak kodu zaten kullanılıyor');
    }
    throw error;
  }
  return { id };
}

export async function updatePartner(
  partnerId: string,
  patch: { name?: string; commissionRate?: number; isActive?: boolean },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [partnerId];
  const add = (column: string, value: unknown): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.commissionRate !== undefined) add('commission_rate', patch.commissionRate);
  if (patch.isActive !== undefined) add('is_active', patch.isActive);
  if (sets.length === 0) throw new AppError('VALIDATION_ERROR', 'Güncellenecek alan yok');

  const result = await getPool('migrator').query(
    `UPDATE partners SET ${sets.join(', ')} WHERE id = $1`,
    params,
  );
  if (result.rowCount === 0) throw new AppError('NOT_FOUND', 'Ortak bulunamadı');
}

export async function listCommissions(
  partnerId: string,
  status?: CommissionStatus,
): Promise<CommissionRow[]> {
  const params: unknown[] = [partnerId];
  let statusFilter = '';
  if (status) {
    params.push(status);
    statusFilter = `AND c.status = $2`;
  }
  const { rows } = await getPool('migrator').query<{
    id: string;
    tenant_id: string;
    tenant_name: string | null;
    order_id: string;
    order_no: string | null;
    amount: string;
    status: CommissionStatus;
    created_at: string | Date;
  }>(
    `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.order_id, o.order_no,
            c.amount::text AS amount, c.status, c.created_at
       FROM partner_commissions c
       LEFT JOIN tenants t ON t.id = c.tenant_id
       LEFT JOIN commercial_orders o ON o.id = c.order_id
      WHERE c.partner_id = $1 ${statusFilter}
      ORDER BY c.created_at DESC
      LIMIT 500`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    orderId: r.order_id,
    orderNo: r.order_no,
    amount: r.amount,
    status: r.status,
    createdAt: iso(r.created_at),
  }));
}

/**
 * Komisyon durumunu ilerletir (pending → approved → paid; pending/approved → cancelled).
 * Koşullu UPDATE geçişi ve yarışı tek ifadede korur; denetim izi hemen ardından yazılır.
 */
export async function setCommissionStatus(
  commissionId: string,
  to: CommissionStatus,
  actorUserId: string,
): Promise<void> {
  const allowedFrom = COMMISSION_STATUSES.filter((from) => TRANSITIONS[from].includes(to));
  if (allowedFrom.length === 0) {
    throw new AppError('VALIDATION_ERROR', `Komisyon '${to}' durumuna alınamaz`);
  }

  const pool = getPool('migrator');
  const updated = await pool.query<{ tenant_id: string; status: CommissionStatus }>(
    `UPDATE partner_commissions SET status = $2
      WHERE id = $1 AND status = ANY($3::text[])
      RETURNING tenant_id, status`,
    [commissionId, to, allowedFrom],
  );
  if (updated.rows.length === 0) {
    const exists = await pool.query<{ status: CommissionStatus }>(
      `SELECT status FROM partner_commissions WHERE id = $1`,
      [commissionId],
    );
    if (exists.rows.length === 0) throw new AppError('NOT_FOUND', 'Komisyon kaydı bulunamadı');
    throw new AppError(
      'VALIDATION_ERROR',
      `Komisyon '${exists.rows[0].status}' durumundan '${to}' durumuna geçemez`,
    );
  }

  await pool.query(
    `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, new_values, created_at)
     VALUES ($1, $2, $3, 'partner_commission.status_changed', 'partner_commission', $4, $5, now())`,
    [newId(), updated.rows[0].tenant_id, actorUserId, commissionId, JSON.stringify({ status: to })],
  );
}

export async function listReferrals(partnerId: string): Promise<ReferralRow[]> {
  const { rows } = await getPool('migrator').query<{
    id: string;
    tenant_id: string;
    tenant_name: string | null;
    referred_at: string | Date;
  }>(
    `SELECT r.id, r.tenant_id, t.name AS tenant_name, r.referred_at
       FROM partner_referrals r
       LEFT JOIN tenants t ON t.id = r.tenant_id
      WHERE r.partner_id = $1
      ORDER BY r.referred_at DESC`,
    [partnerId],
  );
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    referredAt: iso(r.referred_at),
  }));
}

/**
 * Şirketi bir ortağa bağlar (atıf). Bir şirket tek ortağa bağlıdır: komisyon
 * `ORDER BY referred_at ASC LIMIT 1` ile ilk atfedilen ortağa yazılır, bu yüzden
 * ikinci atıf reddedilir (çifte komisyon belirsizliği olmaz).
 */
export async function addReferral(partnerId: string, tenantId: string): Promise<{ id: string }> {
  const pool = getPool('migrator');
  const partner = await pool.query(`SELECT 1 FROM partners WHERE id = $1`, [partnerId]);
  if (partner.rows.length === 0) throw new AppError('NOT_FOUND', 'Ortak bulunamadı');
  const tenant = await pool.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
  if (tenant.rows.length === 0) throw new AppError('NOT_FOUND', 'Şirket bulunamadı');

  const id = newId();
  const inserted = await pool.query(
    `INSERT INTO partner_referrals (id, tenant_id, partner_id, referred_at)
     SELECT $1, $2, $3, now()
      WHERE NOT EXISTS (SELECT 1 FROM partner_referrals WHERE tenant_id = $2)`,
    [id, tenantId, partnerId],
  );
  if (inserted.rowCount === 0) {
    throw new AppError('CONFLICT', 'Bu şirket zaten bir ortağa bağlı');
  }
  return { id };
}
