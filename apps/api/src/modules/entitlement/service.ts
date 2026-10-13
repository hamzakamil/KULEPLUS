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
  // Aylık dönem başı (K-02: import limiti "aylık" — usage_counters.period_start = ayın 1'i).
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Not: SUM(count) şart — COUNT(*) usage_counters SATIR sayısını sayar (her dönem
  // en fazla 1 satır), kotası değil. Plan seçimi: tenant'ın entitlement'ındaki
  // plan_version_id varsa o; yoksa free plan (varsayılan paket — SPEC §8.1).
  const result = await getPool().query<{
    count: string;
    plan_version_id: string | null;
  }>(
    `SELECT COALESCE(SUM(uc.count), 0)::bigint AS count,
            COALESCE((SELECT te.plan_version_id FROM tenant_entitlements te
              WHERE te.tenant_id = $1 AND te.plan_version_id IS NOT NULL
              ORDER BY te.granted_at DESC LIMIT 1),
             (SELECT pv.id FROM plan_versions pv JOIN plans p ON pv.plan_id = p.id
              WHERE p.code = 'free' AND pv.version = 1)) AS plan_version_id
     FROM usage_counters uc
     WHERE uc.tenant_id = $1 AND uc.limit_key = $2 AND uc.period_start = $3`,
    [tenantId, limitKey, periodStart],
  );

  const count = parseInt(result.rows[0]?.count ?? '0', 10);
  const planVersionId = result.rows[0]?.plan_version_id as string | null;

  let limitValue: number | null = null;
  if (planVersionId) {
    const limitResult = await getPool().query<{ value: string | null }>(
      `SELECT value #>> '{}' AS value FROM plan_limits
       WHERE plan_version_id = $1 AND limit_key = $2`,
      [planVersionId, limitKey],
    );
    const raw = limitResult.rows[0]?.value ?? null;
    // jsonb 'null' (sınırsız) → null; sayısal değer → integer.
    limitValue = raw !== null && raw !== 'null' ? parseInt(raw, 10) : null;
  }

  const allowed = limitValue === null || count < limitValue;
  const remaining = limitValue === null ? null : Math.max(0, limitValue - count);

  return {
    tenantId,
    limitKey,
    allowed,
    current: count,
    limit: limitValue,
    remaining,
    // Aylık kota: dönem sonu gelecek ayın 1'i.
    resetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

/** Kullanım sayacını artır (birim işlem sonrası) */
export async function incrementUsage(
  tenantId: string,
  limitKey: string,
  periodStart?: Date,
  by = 1,
): Promise<void> {
  const now = new Date();
  const ps = periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1);

  await getPool().query(
    `INSERT INTO usage_counters (tenant_id, limit_key, period_start, count, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, limit_key, period_start) DO UPDATE SET count = usage_counters.count + $4, updated_at = $5`,
    [tenantId, limitKey, ps, by, now],
  );
}
