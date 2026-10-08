import { getPool } from '@kuleplus/db';

/** MODÜL İZİNE KONTROL: tenant'in belirtili modüle erişim yetkisi olup olmadığını kontrol eder */
export async function requireModule(
  tenantId: string,
  moduleCode: string,
): Promise<{
  tenantId: string;
  moduleCode: string;
  entitled: boolean;
  status: 'active' | 'expired' | 'revoked';
  grantedAt: Date;
  expiresAt: Date | null;
  reason: string | null;
}> {
  const result = await getPool().query<{
    module_code: string;
    status: string;
    granted_at: Date;
    expires_at: Date | null;
  }>(
    `
    SELECT module_code, status, granted_at, expires_at
    FROM tenant_entitlements
    WHERE tenant_id = $1 AND module_code = $2`,
    [tenantId, moduleCode],
  );

  if (result.rows.length === 0) {
    return {
      tenantId,
      moduleCode,
      entitled: false,
      status: 'revoked',
      grantedAt: new Date(),
      expiresAt: null,
      reason: 'MODULE_NOT_ENTITLED',
    };
  }

  const row = result.rows[0];
  const entitled = row.status === 'active';

  return {
    tenantId,
    moduleCode,
    entitled,
    status: row.status as 'active' | 'expired' | 'revoked',
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    reason: entitled ? null : 'MODULE_NOT_ENTITLED',
  };
}

/** KOTA KONTROLÜ: tenant'in belirli kotayı aşmadığını kontrol eder */
export async function checkLimit(
  tenantId: string,
  limitKey: string,
): Promise<{
  tenantId: string;
  limitKey: string;
  allowed: boolean;
  current: number;
  limit: number | null;
  remaining: number | null;
  resetAt: Date;
}> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await getPool().query<{
    count: string;
    limit_value: string;
  }>(
    `SELECT COUNT(*)::bigint AS count, (SELECT value::bigint FROM plan_limits pl
     JOIN plan_versions pv ON pl.plan_version_id = pv.id
     JOIN plans p ON pv.plan_id = p.id
     WHERE pl.limit_key = $2 AND pv.version = 1
     ORDER BY pv.effective_from DESC LIMIT 1) AS limit_value
     FROM usage_counters uc
     WHERE uc.tenant_id = $1 AND uc.limit_key = $2 AND uc.period_start = $3`,
    [tenantId, limitKey, periodStart],
  );

  const count = parseInt(result.rows[0].count, 10);
  const limitValueRaw = result.rows[0].limit_value;
  const limitValue = limitValueRaw ? parseInt(limitValueRaw, 10) : null;

  const allowed = limitValue === null || count < limitValue;
  const remaining = limitValue === null ? null : Math.max(0, limitValue - count);

  return {
    tenantId,
    limitKey,
    allowed,
    current: count,
    limit: limitValue,
    remaining,
    resetAt: new Date(now.getFullYear() + 1, 0, 1),
  };
}

/** Kullanım sayacını artır (birim işlem sonrası) */
export async function incrementUsage(
  tenantId: string,
  limitKey: string,
  periodStart?: Date,
): Promise<void> {
  const now = new Date();
  const ps = periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1);

  await getPool().query(
    `INSERT INTO usage_counters (tenant_id, limit_key, period_start, count, updated_at)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (tenant_id, limit_key, period_start) DO UPDATE SET count = usage_counters.count + 1, updated_at = $4`,
    [tenantId, limitKey, ps, now],
  );
}
